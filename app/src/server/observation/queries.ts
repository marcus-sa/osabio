import { randomUUID } from "node:crypto";
import { RecordId, Surreal } from "surrealdb";
import type { embed } from "ai";
import type { EntityCategory, ObservationSeverity, ObservationStatus, ObservationSummary, ObservationType } from "../../shared/contracts";
import { createEmbeddingVector } from "../graph/embeddings";

type ObservationRecord = RecordId<"observation", string>;
export type ObserveTargetRecord = RecordId<"project" | "feature" | "task" | "decision" | "question" | "observation" | "intent" | "git_commit" | "objective" | "trace", string>;

type EmbeddingModel = Parameters<typeof embed>[0]["model"];

const SEVERITY_PRIORITY: Record<ObservationSeverity, number> = {
  conflict: 0,
  warning: 1,
  info: 2,
};

const DEDUP_SIMILARITY_THRESHOLD = 0.95;

// ---------------------------------------------------------------------------
// Dedup: find semantically similar open observation (two-step KNN pattern)
// ---------------------------------------------------------------------------

type SimilarObservationRow = {
  id: RecordId<"observation", string>;
  occurrence_count: number;
  similarity: number;
};

async function findSimilarOpenObservation(input: {
  surreal: Surreal;
  workspaceRecord: RecordId<"workspace", string>;
  sourceAgent: string;
  sourceSessionRecord: RecordId<"agent_session", string>;
  embedding: number[];
}): Promise<SimilarObservationRow | undefined> {
  // Two-step KNN pattern: avoids SurrealDB v3.0 HNSW + WHERE index conflict
  // Dedup scope: same agent + same session + same workspace
  const sql = `
    LET $candidates = SELECT id, occurrence_count, workspace, source_agent, source_session, status,
      vector::similarity::cosine(embedding, $vec) AS similarity
      FROM observation WHERE embedding <|10, COSINE|> $vec;
    SELECT id, occurrence_count, similarity FROM $candidates
      WHERE workspace = $ws AND source_agent = $agent AND source_session = $sess
      AND status IN ['open', 'acknowledged']
      AND similarity > ${DEDUP_SIMILARITY_THRESHOLD}
      ORDER BY similarity DESC LIMIT 1;
  `;

  const results = await input.surreal.query<[null, SimilarObservationRow[]]>(sql, {
    vec: input.embedding,
    ws: input.workspaceRecord,
    agent: input.sourceAgent,
    sess: input.sourceSessionRecord,
  });

  return results[1]?.[0];
}

// ---------------------------------------------------------------------------
// Create or deduplicate observation
// ---------------------------------------------------------------------------

export type EmbeddingDeps = {
  embeddingModel: EmbeddingModel;
  embeddingDimension: number;
};

export async function createObservation(input: {
  surreal: Surreal;
  workspaceRecord: RecordId<"workspace", string>;
  text: string;
  severity: ObservationSeverity;
  category?: EntityCategory;
  observationType?: ObservationType;
  sourceAgent: string;
  now: Date;
  sourceMessageRecord?: RecordId<"message", string>;
  sourceSessionRecord?: RecordId<"agent_session", string>;
  relatedRecords?: ObserveTargetRecord[];
  embedding?: number[];
  confidence?: number;
  evidenceRefs?: RecordId[];
  verified?: boolean;
  source?: string;
  reasoning?: string;
  embeddingDeps?: EmbeddingDeps;
}): Promise<ObservationRecord> {
  // Step 1: Resolve embedding — use provided or generate from text
  let embedding = input.embedding;
  if (!embedding && input.embeddingDeps) {
    embedding = await createEmbeddingVector(
      input.embeddingDeps.embeddingModel,
      input.text,
      input.embeddingDeps.embeddingDimension,
    );
  }

  // Step 2: Check for similar open observation (dedup)
  // Dedup requires both an embedding and a session — no session means each observation is distinct
  if (embedding && input.sourceSessionRecord) {
    const existing = await findSimilarOpenObservation({
      surreal: input.surreal,
      workspaceRecord: input.workspaceRecord,
      sourceAgent: input.sourceAgent,
      sourceSessionRecord: input.sourceSessionRecord,
      embedding,
    });

    if (existing) {
      // Merge: increment occurrence count and update timestamp
      await input.surreal.query(
        `UPDATE $obs SET occurrence_count = occurrence_count + 1, last_seen_at = $now, updated_at = $now;`,
        { obs: existing.id, now: input.now },
      );
      return existing.id;
    }
  }

  // Step 3: Create new observation
  const observationRecord = new RecordId("observation", randomUUID());

  await input.surreal.create(observationRecord).content({
    text: input.text,
    severity: input.severity,
    status: "open",
    ...(input.category ? { category: input.category } : {}),
    ...(input.observationType ? { observation_type: input.observationType } : {}),
    source_agent: input.sourceAgent,
    workspace: input.workspaceRecord,
    ...(input.sourceMessageRecord ? { source_message: input.sourceMessageRecord } : {}),
    ...(input.sourceSessionRecord ? { source_session: input.sourceSessionRecord } : {}),
    ...(embedding ? { embedding } : {}),
    ...(input.confidence !== undefined ? { confidence: input.confidence } : {}),
    ...(input.evidenceRefs && input.evidenceRefs.length > 0 ? { evidence_refs: input.evidenceRefs } : {}),
    ...(input.verified !== undefined ? { verified: input.verified } : {}),
    ...(input.source ? { source: input.source } : {}),
    ...(input.reasoning !== undefined ? { reasoning: input.reasoning } : {}),
    occurrence_count: 1,
    last_seen_at: input.now,
    created_at: input.now,
    updated_at: input.now,
  });

  // Create observes edges to related entities
  const targets: ObserveTargetRecord[] = input.relatedRecords ?? [];

  for (const target of targets) {
    await input.surreal
      .relate(observationRecord, new RecordId("observes", randomUUID()), target, {
        added_at: input.now,
      })
      .output("after");
  }

  return observationRecord;
}

export async function acknowledgeObservation(input: {
  surreal: Surreal;
  workspaceRecord: RecordId<"workspace", string>;
  observationRecord: ObservationRecord;
  now: Date;
}): Promise<void> {
  const row = await input.surreal.select<{ workspace: RecordId<"workspace", string> }>(input.observationRecord);
  if (!row) {
    throw new Error(`observation not found: ${input.observationRecord.id as string}`);
  }

  if ((row.workspace.id as string) !== (input.workspaceRecord.id as string)) {
    throw new Error("observation is outside the current workspace scope");
  }

  await input.surreal.update(input.observationRecord).merge({
    status: "acknowledged" satisfies ObservationStatus,
    updated_at: input.now,
  });
}

export async function resolveObservation(input: {
  surreal: Surreal;
  workspaceRecord: RecordId<"workspace", string>;
  observationRecord: ObservationRecord;
  now: Date;
  resolvedByRecord?: RecordId<"identity", string>;
}): Promise<void> {
  const row = await input.surreal.select<{ workspace: RecordId<"workspace", string> }>(input.observationRecord);
  if (!row) {
    throw new Error(`observation not found: ${input.observationRecord.id as string}`);
  }

  if ((row.workspace.id as string) !== (input.workspaceRecord.id as string)) {
    throw new Error("observation is outside the current workspace scope");
  }

  await input.surreal.update(input.observationRecord).merge({
    status: "resolved" satisfies ObservationStatus,
    resolved_at: input.now,
    ...(input.resolvedByRecord ? { resolved_by: input.resolvedByRecord } : {}),
    updated_at: input.now,
  });
}

type OpenObservationRow = {
  id: ObservationRecord;
  text: string;
  severity: ObservationSeverity;
  status: ObservationStatus;
  category?: EntityCategory;
  source_agent: string;
  created_at: string | Date;
  occurrence_count?: number;
  last_seen_at?: string | Date;
};

// ---------------------------------------------------------------------------
// Reasoning-aware observation queries
// ---------------------------------------------------------------------------

type ReasoningObservationRow = {
  id: ObservationRecord;
  text: string;
  reasoning?: string;
  severity: ObservationSeverity;
  confidence?: number;
  source_agent: string;
  observation_type?: ObservationType;
  evidence_refs?: RecordId[];
  created_at: string | Date;
};

export type ReasoningObservationResult = {
  id: string;
  text: string;
  reasoning?: string;
  severity: ObservationSeverity;
  confidence?: number;
  sourceAgent: string;
  observationType?: ObservationType;
  evidenceRefs?: string[];
  createdAt: string;
};

const DEFAULT_REASONING_LIMIT = 50;

function formatReasoningRow(row: ReasoningObservationRow): ReasoningObservationResult {
  return {
    id: row.id.id as string,
    text: row.text,
    ...(row.reasoning !== undefined ? { reasoning: row.reasoning } : {}),
    severity: row.severity,
    ...(row.confidence !== undefined ? { confidence: row.confidence } : {}),
    sourceAgent: row.source_agent,
    ...(row.observation_type ? { observationType: row.observation_type } : {}),
    ...(row.evidence_refs && row.evidence_refs.length > 0
      ? { evidenceRefs: row.evidence_refs.map((ref) => ref.id as string) }
      : {}),
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : new Date(row.created_at).toISOString(),
  };
}

/**
 * Returns observations that have LLM reasoning attached, scoped to a workspace.
 * Ordered by creation date descending (most recent first).
 */
export async function listObservationsWithReasoning(input: {
  surreal: Surreal;
  workspaceRecord: RecordId<"workspace", string>;
  limit?: number;
  since?: Date;
}): Promise<ReasoningObservationResult[]> {
  const limit = input.limit ?? DEFAULT_REASONING_LIMIT;

  const sinceClause = input.since ? "AND created_at >= $since" : "";
  const query = [
    "SELECT id, text, reasoning, severity, confidence, source_agent, observation_type, evidence_refs, created_at",
    "FROM observation",
    `WHERE workspace = $workspace AND reasoning IS NOT NONE ${sinceClause}`,
    "ORDER BY created_at DESC",
    "LIMIT $limit;",
  ].join(" ");

  const params: Record<string, unknown> = {
    workspace: input.workspaceRecord,
    limit,
  };
  if (input.since) {
    params.since = input.since;
  }

  const [rows] = await input.surreal
    .query<[ReasoningObservationRow[]]>(query, params)
    .collect<[ReasoningObservationRow[]]>();

  return rows.map(formatReasoningRow);
}

/**
 * Returns observations that have no reasoning (deterministic/rule-based findings).
 * Ordered by creation date descending.
 */
export async function listObservationsWithoutReasoning(input: {
  surreal: Surreal;
  workspaceRecord: RecordId<"workspace", string>;
  limit?: number;
}): Promise<ReasoningObservationResult[]> {
  const limit = input.limit ?? DEFAULT_REASONING_LIMIT;

  const [rows] = await input.surreal
    .query<[ReasoningObservationRow[]]>(
      [
        "SELECT id, text, reasoning, severity, confidence, source_agent, observation_type, evidence_refs, created_at",
        "FROM observation",
        "WHERE workspace = $workspace AND reasoning IS NONE",
        "ORDER BY created_at DESC",
        "LIMIT $limit;",
      ].join(" "),
      { workspace: input.workspaceRecord, limit },
    )
    .collect<[ReasoningObservationRow[]]>();

  return rows.map(formatReasoningRow);
}

export async function listWorkspaceOpenObservations(input: {
  surreal: Surreal;
  workspaceRecord: RecordId<"workspace", string>;
  limit: number;
}): Promise<ObservationSummary[]> {
  const [rows] = await input.surreal
    .query<[OpenObservationRow[]]>(
      [
        "SELECT id, text, severity, status, category, source_agent, created_at, occurrence_count, last_seen_at",
        "FROM observation",
        "WHERE workspace = $workspace",
        "AND status IN ['open', 'acknowledged']",
        "ORDER BY created_at DESC",
        "LIMIT $limit;",
      ].join(" "),
      {
        workspace: input.workspaceRecord,
        limit: input.limit,
      },
    )
    .collect<[OpenObservationRow[]]>();

  return rows
    .slice()
    .sort((a, b) => {
      const severityDelta = SEVERITY_PRIORITY[a.severity] - SEVERITY_PRIORITY[b.severity];
      if (severityDelta !== 0) {
        return severityDelta;
      }

      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    })
    .map((row) => ({
      id: row.id.id as string,
      text: row.text,
      severity: row.severity,
      status: row.status,
      ...(row.category ? { category: row.category } : {}),
      sourceAgent: row.source_agent,
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : new Date(row.created_at).toISOString(),
      ...(row.occurrence_count !== undefined ? { occurrenceCount: row.occurrence_count } : {}),
      ...(row.last_seen_at ? {
        lastSeenAt: row.last_seen_at instanceof Date ? row.last_seen_at.toISOString() : new Date(row.last_seen_at).toISOString(),
      } : {}),
    }));
}
