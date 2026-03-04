import { randomUUID } from "node:crypto";
import { RecordId, Surreal } from "surrealdb";
import type { SuggestionCategory, SuggestionStatus, SuggestionSummary } from "../../shared/contracts";

type SuggestionRecord = RecordId<"suggestion", string>;
type SuggestsForTarget = RecordId<"project" | "feature" | "task" | "question" | "decision", string>;
type EvidenceTarget = RecordId<string, string>;

export async function createSuggestion(input: {
  surreal: Surreal;
  workspaceRecord: RecordId<"workspace", string>;
  text: string;
  category: SuggestionCategory;
  rationale: string;
  suggestedBy: string;
  confidence: number;
  now: Date;
  sourceMessageRecord?: RecordId<"message", string>;
  sourceSessionRecord?: RecordId<"agent_session", string>;
  targetRecord?: SuggestsForTarget;
  evidenceRecords?: EvidenceTarget[];
  embedding?: number[];
}): Promise<SuggestionRecord> {
  const suggestionRecord = new RecordId("suggestion", randomUUID());

  await input.surreal.create(suggestionRecord).content({
    text: input.text,
    category: input.category,
    rationale: input.rationale,
    suggested_by: input.suggestedBy,
    confidence: input.confidence,
    status: "pending",
    workspace: input.workspaceRecord,
    ...(input.sourceMessageRecord ? { source_message: input.sourceMessageRecord } : {}),
    ...(input.sourceSessionRecord ? { source_session: input.sourceSessionRecord } : {}),
    ...(input.embedding ? { embedding: input.embedding } : {}),
    created_at: input.now,
    updated_at: input.now,
  });

  if (input.targetRecord) {
    await input.surreal
      .relate(suggestionRecord, new RecordId("suggests_for", randomUUID()), input.targetRecord, {
        added_at: input.now,
      })
      .output("after");
  }

  if (input.evidenceRecords) {
    for (const evidenceRecord of input.evidenceRecords) {
      await input.surreal
        .relate(suggestionRecord, new RecordId("suggestion_evidence", randomUUID()), evidenceRecord, {
          added_at: input.now,
        })
        .output("after");
    }
  }

  return suggestionRecord;
}

export async function acceptSuggestion(input: {
  surreal: Surreal;
  workspaceRecord: RecordId<"workspace", string>;
  suggestionRecord: SuggestionRecord;
  now: Date;
}): Promise<void> {
  const row = await input.surreal.select<{ workspace: RecordId<"workspace", string> }>(input.suggestionRecord);
  if (!row) {
    throw new Error(`suggestion not found: ${input.suggestionRecord.id as string}`);
  }

  if ((row.workspace.id as string) !== (input.workspaceRecord.id as string)) {
    throw new Error("suggestion is outside the current workspace scope");
  }

  await input.surreal.update(input.suggestionRecord).merge({
    status: "accepted" satisfies SuggestionStatus,
    accepted_at: input.now,
    updated_at: input.now,
  });
}

export async function dismissSuggestion(input: {
  surreal: Surreal;
  workspaceRecord: RecordId<"workspace", string>;
  suggestionRecord: SuggestionRecord;
  now: Date;
}): Promise<void> {
  const row = await input.surreal.select<{ workspace: RecordId<"workspace", string> }>(input.suggestionRecord);
  if (!row) {
    throw new Error(`suggestion not found: ${input.suggestionRecord.id as string}`);
  }

  if ((row.workspace.id as string) !== (input.workspaceRecord.id as string)) {
    throw new Error("suggestion is outside the current workspace scope");
  }

  await input.surreal.update(input.suggestionRecord).merge({
    status: "dismissed" satisfies SuggestionStatus,
    dismissed_at: input.now,
    updated_at: input.now,
  });
}

export async function deferSuggestion(input: {
  surreal: Surreal;
  workspaceRecord: RecordId<"workspace", string>;
  suggestionRecord: SuggestionRecord;
  now: Date;
}): Promise<void> {
  const row = await input.surreal.select<{ workspace: RecordId<"workspace", string> }>(input.suggestionRecord);
  if (!row) {
    throw new Error(`suggestion not found: ${input.suggestionRecord.id as string}`);
  }

  if ((row.workspace.id as string) !== (input.workspaceRecord.id as string)) {
    throw new Error("suggestion is outside the current workspace scope");
  }

  await input.surreal.update(input.suggestionRecord).merge({
    status: "deferred" satisfies SuggestionStatus,
    deferred_at: input.now,
    updated_at: input.now,
  });
}

export async function listWorkspacePendingSuggestions(input: {
  surreal: Surreal;
  workspaceRecord: RecordId<"workspace", string>;
  limit: number;
}): Promise<SuggestionSummary[]> {
  const [rows] = await input.surreal
    .query<[
      Array<{
        id: SuggestionRecord;
        text: string;
        category: SuggestionCategory;
        rationale: string;
        suggested_by: string;
        confidence: number;
        status: SuggestionStatus;
        created_at: string | Date;
      }>,
    ]>(
      [
        "SELECT id, text, category, rationale, suggested_by, confidence, status, created_at",
        "FROM suggestion",
        "WHERE workspace = $workspace",
        "AND status IN ['pending', 'deferred']",
        "ORDER BY confidence DESC, created_at DESC",
        "LIMIT $limit;",
      ].join(" "),
      {
        workspace: input.workspaceRecord,
        limit: input.limit,
      },
    )
    .collect<[
      Array<{
        id: SuggestionRecord;
        text: string;
        category: SuggestionCategory;
        rationale: string;
        suggested_by: string;
        confidence: number;
        status: SuggestionStatus;
        created_at: string | Date;
      }>,
    ]>();

  return rows.map((row) => ({
    id: row.id.id as string,
    text: row.text,
    category: row.category,
    rationale: row.rationale,
    suggestedBy: row.suggested_by,
    confidence: row.confidence,
    status: row.status,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : new Date(row.created_at).toISOString(),
  }));
}
