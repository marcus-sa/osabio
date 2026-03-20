import { randomUUID } from "node:crypto";
import { RecordId, Surreal } from "surrealdb";
import type { EntityCategory, ObservationSeverity, ObservationStatus, ObservationSummary, ObservationType } from "../../shared/contracts";

type ObservationRecord = RecordId<"observation", string>;
export type ObserveTargetRecord = RecordId<"project" | "feature" | "task" | "decision" | "question" | "observation" | "intent" | "git_commit" | "objective" | "trace", string>;

const SEVERITY_PRIORITY: Record<ObservationSeverity, number> = {
  conflict: 0,
  warning: 1,
  info: 2,
};

// ---------------------------------------------------------------------------
// Create or deduplicate observation
// ---------------------------------------------------------------------------

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
  confidence?: number;
  evidenceRefs?: RecordId[];
  verified?: boolean;
  source?: string;
  reasoning?: string;
}): Promise<ObservationRecord> {
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
    ...(input.confidence !== undefined ? { confidence: input.confidence } : {}),
    ...(input.evidenceRefs && input.evidenceRefs.length > 0 ? { evidence_refs: input.evidenceRefs } : {}),
    ...(input.verified !== undefined ? { verified: input.verified } : {}),
    ...(input.source ? { source: input.source } : {}),
    ...(input.reasoning !== undefined ? { reasoning: input.reasoning } : {}),
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
        "SELECT id, text, severity, status, category, source_agent, created_at",
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
    }));
}
