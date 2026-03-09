import { randomUUID } from "node:crypto";
import { embed } from "ai";
import { RecordId, Surreal } from "surrealdb";
import type { SuggestionCategory, SuggestionStatus, SuggestionSummary } from "../../shared/contracts";
import { createEmbeddingVector } from "../graph/embeddings";
import { createProjectRecord } from "../graph/queries";
import { ensureProjectFeatureEdge } from "../workspace/workspace-scope";
import { seedDescriptionEntry } from "../descriptions/persist";

type EmbeddingModel = Parameters<typeof embed>[0]["model"];

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

type ConvertTargetKind = "task" | "feature" | "decision" | "project";

export async function convertSuggestion(input: {
  surreal: Surreal;
  workspaceRecord: RecordId<"workspace", string>;
  suggestionRecord: SuggestionRecord;
  targetKind: ConvertTargetKind;
  title?: string;
  embeddingModel: EmbeddingModel;
  embeddingDimension: number;
  now: Date;
}): Promise<{ entityId: string; table: ConvertTargetKind }> {
  // 1. Validate suggestion exists + workspace scope + convertible status
  const row = await input.surreal.select<{
    workspace: RecordId<"workspace", string>;
    text: string;
    rationale: string;
    category: string;
    status: string;
  }>(input.suggestionRecord);
  if (!row) {
    throw new Error(`suggestion not found: ${input.suggestionRecord.id as string}`);
  }
  if ((row.workspace.id as string) !== (input.workspaceRecord.id as string)) {
    throw new Error("suggestion is outside the current workspace scope");
  }
  if (!["pending", "accepted", "deferred"].includes(row.status)) {
    throw new Error(`suggestion cannot be converted from status '${row.status}'`);
  }

  const entityName = input.title ?? row.text;

  // 2. Create embedding
  const embedding = await createEmbeddingVector(input.embeddingModel, entityName, input.embeddingDimension);

  // 3. Resolve suggests_for target to find linked project
  const [suggestsForRows] = await input.surreal
    .query<[Array<{ out: RecordId<string, string> }>]>(
      "SELECT out FROM suggests_for WHERE in = $suggestion;",
      { suggestion: input.suggestionRecord },
    )
    .collect<[Array<{ out: RecordId<string, string> }>]>();
  const linkedProject = suggestsForRows.find((r) => r.out.table.name === "project");

  // 4. Create target entity
  let targetRecord: RecordId<string, string>;

  if (input.targetKind === "task") {
    const taskId = randomUUID();
    targetRecord = new RecordId("task", taskId);
    await input.surreal.create(targetRecord as RecordId<"task", string>).content({
      title: entityName,
      status: "open",
      workspace: input.workspaceRecord,
      ...(embedding ? { embedding } : {}),
      created_at: input.now,
      updated_at: input.now,
    });
    if (linkedProject) {
      try {
        await input.surreal
          .relate(targetRecord, new RecordId("belongs_to", randomUUID()), linkedProject.out, { added_at: input.now })
          .output("after");
      } catch { /* best-effort project linking */ }
    }
  } else if (input.targetKind === "feature") {
    const featureId = randomUUID();
    targetRecord = new RecordId("feature", featureId);
    await input.surreal.create(targetRecord as RecordId<"feature", string>).content({
      name: entityName,
      status: "active",
      ...(embedding ? { embedding } : {}),
      created_at: input.now,
      updated_at: input.now,
    });
    if (linkedProject) {
      try {
        await ensureProjectFeatureEdge(
          input.surreal,
          linkedProject.out as RecordId<"project", string>,
          targetRecord as RecordId<"feature", string>,
          input.now,
        );
      } catch { /* best-effort project linking */ }
    }
  } else if (input.targetKind === "decision") {
    const decisionId = randomUUID();
    targetRecord = new RecordId("decision", decisionId);
    await input.surreal.create(targetRecord as RecordId<"decision", string>).content({
      summary: entityName,
      status: "proposed",
      workspace: input.workspaceRecord,
      ...(embedding ? { embedding } : {}),
      created_at: input.now,
      updated_at: input.now,
    });
    if (linkedProject) {
      try {
        await input.surreal
          .relate(targetRecord, new RecordId("belongs_to", randomUUID()), linkedProject.out, { added_at: input.now })
          .output("after");
      } catch { /* best-effort project linking */ }
    }
  } else {
    // project
    const projectRecord = await createProjectRecord({
      surreal: input.surreal,
      name: entityName,
      status: "active",
      now: input.now,
      workspaceRecord: input.workspaceRecord,
    });
    if (embedding) {
      await input.surreal.update(projectRecord).merge({ embedding });
    }
    targetRecord = projectRecord;
  }

  // 5. Update suggestion to converted
  await input.surreal.update(input.suggestionRecord).merge({
    status: "converted" satisfies SuggestionStatus,
    converted_to: targetRecord,
    converted_at: input.now,
    updated_at: input.now,
  });

  // 6. Create converted_from edge: target -> suggestion
  await input.surreal
    .relate(targetRecord, new RecordId("converted_from", randomUUID()), input.suggestionRecord, {
      converted_at: input.now,
    })
    .output("after");

  // 7. Seed description with rationale
  await seedDescriptionEntry({
    surreal: input.surreal,
    targetRecord,
    text: row.rationale,
  }).catch(() => undefined);

  return {
    entityId: `${input.targetKind}:${targetRecord.id as string}`,
    table: input.targetKind,
  };
}
