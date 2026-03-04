import { randomUUID } from "node:crypto";
import { RecordId, Surreal } from "surrealdb";
import { cosineSimilarity } from "./embeddings";

export type GraphEntityTable = "workspace" | "project" | "person" | "feature" | "task" | "decision" | "question" | "observation" | "suggestion";

export type GraphEntityRecord = RecordId<GraphEntityTable, string>;

export type SearchEntityKind = "project" | "feature" | "task" | "decision" | "question" | "suggestion";

export type ConversationEntity = {
  id: string;
  kind: GraphEntityTable;
  name: string;
  confidence: number;
  sourceMessageId?: string;
};

export type WorkspaceProjectSummary = {
  id: string;
  name: string;
  activeTaskCount: number;
};

export type WorkspaceDecisionSummary = {
  id: string;
  name: string;
  status: string;
  priority?: string;
  project?: string;
};

export type WorkspaceQuestionSummary = {
  id: string;
  name: string;
  priority?: string;
  project?: string;
};

export type RankedEntity = {
  id: string;
  kind: SearchEntityKind;
  name: string;
  score: number;
  status?: string;
  project?: string;
};

export type EntityNeighbor = {
  id: string;
  kind: GraphEntityTable;
  name: string;
  relationKind: string;
  direction: "incoming" | "outgoing";
  confidence: number;
};

export type EntityProvenance = {
  sourceId: string;
  sourceKind: "message" | "document_chunk" | "git_commit";
  confidence: number;
  extractedAt: string;
  conversationId?: string;
  evidence?: string;
  evidenceSource?: string;
  resolvedFrom?: string;
  fromText?: string;
};

export type EntityDetail = {
  entity: {
    id: string;
    kind: GraphEntityTable;
    name: string;
    data: Record<string, unknown>;
  };
  relationships: EntityNeighbor[];
  provenance: EntityProvenance[];
};

export type ProjectStatus = {
  project: {
    id: string;
    name: string;
  };
  tasks: {
    active: number;
    completed: number;
    blocked: number;
    recent: Array<{ id: string; name: string; status: string; priority?: string }>;
  };
  decisions: Array<{ id: string; name: string; status: string; priority?: string }>;
  questions: Array<{ id: string; name: string; status: string; priority?: string }>;
  features: Array<{ id: string; name: string; status: string }>;
};

export type RankedMessage = {
  id: string;
  conversationId: string;
  text: string;
  score: number;
  createdAt: string;
};

export type GraphViewRawEntity = {
  id: string;
  kind: GraphEntityTable;
  name: string;
};

export type GraphViewRawEdge = {
  id: string;
  kind: string;
  fromId: string;
  toId: string;
  confidence: number;
};

export type GraphViewRawResult = {
  entities: GraphViewRawEntity[];
  edges: GraphViewRawEdge[];
};

type EntitySearchCandidate = {
  id: GraphEntityRecord;
  kind: SearchEntityKind;
  name: string;
  status?: string;
  embedding?: number[];
};

const SEARCH_KINDS: SearchEntityKind[] = ["project", "feature", "task", "decision", "question", "suggestion"];

function toRecordIdString(record: RecordId<string, string>): string {
  return record.id as string;
}

function toIsoString(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function normalizeSearchValue(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ");
}

export function parseRecordIdString<T extends string>(
  value: string,
  allowedTables: T[],
  fallbackTable?: T,
): RecordId<T, string> {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error("record id is required");
  }

  const separatorIndex = normalized.indexOf(":");
  if (separatorIndex === -1) {
    if (!fallbackTable) {
      throw new Error(`record id must be prefixed with one of: ${allowedTables.join(", ")}`);
    }

    return new RecordId(fallbackTable, normalized) as RecordId<T, string>;
  }

  const table = normalized.slice(0, separatorIndex) as T;
  const id = normalized.slice(separatorIndex + 1);
  if (!allowedTables.includes(table)) {
    throw new Error(`record id table must be one of: ${allowedTables.join(", ")}`);
  }

  if (id.length === 0) {
    throw new Error("record id is missing its identifier component");
  }

  return new RecordId(table, id) as RecordId<T, string>;
}

export async function readEntityName(
  surreal: Surreal,
  record: GraphEntityRecord,
): Promise<string | undefined> {
  const table = record.table.name;

  if (table === "workspace" || table === "project" || table === "person" || table === "feature") {
    const row = await surreal.select<{ name: string }>(record as RecordId<typeof table, string>);
    return row?.name;
  }

  if (table === "task") {
    const row = await surreal.select<{ title: string }>(record as RecordId<"task", string>);
    return row?.title;
  }

  if (table === "decision") {
    const row = await surreal.select<{ summary: string }>(record as RecordId<"decision", string>);
    return row?.summary;
  }

  const row = await surreal.select<{ text: string }>(record as RecordId<"question", string>);
  return row?.text;
}

async function getWorkspaceProjectRows(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
): Promise<Array<{ id: RecordId<"project", string>; name: string }>> {
  const [rows] = await surreal
    .query<[Array<{ id: RecordId<"project", string>; name: string }>]>(
      "SELECT id, name FROM project WHERE id IN (SELECT VALUE out FROM has_project WHERE `in` = $workspace);",
      { workspace: workspaceRecord },
    )
    .collect<[Array<{ id: RecordId<"project", string>; name: string }>]>();

  return rows;
}

async function getWorkspaceMessageIds(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
): Promise<RecordId<"message", string>[]> {
  const [rows] = await surreal
    .query<[Array<RecordId<"message", string>>]>(
      "SELECT VALUE id FROM message WHERE conversation IN (SELECT VALUE id FROM conversation WHERE workspace = $workspace);",
      { workspace: workspaceRecord },
    )
    .collect<[Array<RecordId<"message", string>>]>();

  return rows;
}

export async function isEntityInWorkspace(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
  entityRecord: GraphEntityRecord,
): Promise<boolean> {
  const table = entityRecord.table.name;

  if (table === "workspace") {
    return toRecordIdString(entityRecord) === toRecordIdString(workspaceRecord);
  }

  if (table === "project") {
    const [rows] = await surreal
      .query<[Array<{ id: RecordId<"has_project", string> }>]>(
        "SELECT id FROM has_project WHERE `in` = $workspace AND out = $project LIMIT 1;",
        { workspace: workspaceRecord, project: entityRecord },
      )
      .collect<[Array<{ id: RecordId<"has_project", string> }>]>();

    return rows.length > 0;
  }

  if (table === "person") {
    const [rows] = await surreal
      .query<[Array<{ id: RecordId<"member_of", string> }>]>(
        "SELECT id FROM member_of WHERE `in` = $person AND out = $workspace LIMIT 1;",
        { workspace: workspaceRecord, person: entityRecord },
      )
      .collect<[Array<{ id: RecordId<"member_of", string> }>]>();

    return rows.length > 0;
  }

  if (table === "feature") {
    const [rows] = await surreal
      .query<[Array<{ id: RecordId<"feature", string> }>]>(
        [
          "SELECT id",
          "FROM feature",
          "WHERE id = $feature",
          "AND id IN (",
          "  SELECT VALUE out",
          "  FROM has_feature",
          "  WHERE `in` IN (SELECT VALUE out FROM has_project WHERE `in` = $workspace)",
          ");",
        ].join(" "),
        { workspace: workspaceRecord, feature: entityRecord },
      )
      .collect<[Array<{ id: RecordId<"feature", string> }>]>();

    return rows.length > 0;
  }

  if (table === "task" || table === "decision" || table === "question" || table === "suggestion") {
    const [rows] = await surreal
      .query<[Array<{ id: RecordId<"task" | "decision" | "question" | "suggestion", string> }>]>(
        `SELECT id FROM ${table} WHERE id = $entity AND workspace = $workspace;`,
        { workspace: workspaceRecord, entity: entityRecord },
      )
      .collect<[Array<{ id: RecordId<"task" | "decision" | "question" | "suggestion", string> }>]>();

    return rows.length > 0;
  }

  return false;
}

export async function listConversationEntities(input: {
  surreal: Surreal;
  conversationRecord: RecordId<"conversation", string>;
  workspaceRecord: RecordId<"workspace", string>;
  limit: number;
  inheritedEntityIds?: RecordId[];
}): Promise<ConversationEntity[]> {
  const [rows] = await input.surreal
    .query<[Array<{ in: RecordId<"message", string>; out: GraphEntityRecord; confidence: number; extracted_at: string | Date }>]>(
      [
        "SELECT `in`, out, confidence, extracted_at",
        "FROM extraction_relation",
        "WHERE `in` IN (SELECT VALUE id FROM message WHERE conversation = $conversation)",
        "ORDER BY extracted_at DESC",
        "LIMIT $limit;",
      ].join(" "),
      {
        conversation: input.conversationRecord,
        limit: input.limit,
      },
    )
    .collect<[Array<{ in: RecordId<"message", string>; out: GraphEntityRecord; confidence: number; extracted_at: string | Date }>]>() ;

  const items: ConversationEntity[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const table = row.out.table.name as GraphEntityTable;
    if (
      table !== "workspace" &&
      table !== "project" &&
      table !== "person" &&
      table !== "feature" &&
      table !== "task" &&
      table !== "decision" &&
      table !== "question" &&
      table !== "suggestion"
    ) {
      continue;
    }

    const scoped = await isEntityInWorkspace(input.surreal, input.workspaceRecord, row.out);
    if (!scoped) {
      continue;
    }

    const entityKey = `${table}:${toRecordIdString(row.out)}`;
    if (seen.has(entityKey)) {
      continue;
    }

    const name = await readEntityName(input.surreal, row.out);
    if (!name) {
      continue;
    }

    items.push({
      id: toRecordIdString(row.out),
      kind: table,
      name,
      confidence: row.confidence,
      sourceMessageId: toRecordIdString(row.in),
    });
    seen.add(entityKey);
  }

  // Merge inherited entities from parent conversation when branch has sparse context
  if (input.inheritedEntityIds && input.inheritedEntityIds.length > 0 && items.length < 5) {
    const [inheritedRows] = await input.surreal
      .query<[Array<{ in: RecordId<"message", string>; out: GraphEntityRecord; confidence: number; extracted_at: string | Date }>]>(
        [
          "SELECT `in`, out, confidence, extracted_at",
          "FROM extraction_relation",
          "WHERE out IN $entityIds",
          "ORDER BY extracted_at DESC",
          "LIMIT $limit;",
        ].join(" "),
        { entityIds: input.inheritedEntityIds, limit: input.limit },
      )
      .collect<[Array<{ in: RecordId<"message", string>; out: GraphEntityRecord; confidence: number; extracted_at: string | Date }>]>();

    for (const row of inheritedRows) {
      const table = row.out.table.name as GraphEntityTable;
      if (
        table !== "workspace" &&
        table !== "project" &&
        table !== "person" &&
        table !== "feature" &&
        table !== "task" &&
        table !== "decision" &&
        table !== "question" &&
        table !== "suggestion"
      ) {
        continue;
      }

      const entityKey = `${table}:${toRecordIdString(row.out)}`;
      if (seen.has(entityKey)) continue;

      const name = await readEntityName(input.surreal, row.out);
      if (!name) continue;

      items.push({
        id: toRecordIdString(row.out),
        kind: table,
        name,
        confidence: row.confidence,
        sourceMessageId: toRecordIdString(row.in),
      });
      seen.add(entityKey);
    }
  }

  return items;
}

export async function listWorkspaceProjectSummaries(input: {
  surreal: Surreal;
  workspaceRecord: RecordId<"workspace", string>;
  limit: number;
}): Promise<WorkspaceProjectSummary[]> {
  const projectRows = await getWorkspaceProjectRows(input.surreal, input.workspaceRecord);
  const limited = projectRows.slice(0, input.limit);

  const counts = await Promise.all(
    limited.map(async (project) => {
      const [countRows] = await input.surreal
        .query<[Array<{ count: number }>]>(
          [
            "SELECT count() AS count",
            "FROM task",
            "WHERE status != 'done'",
            "AND (",
            "  id IN (SELECT VALUE `in` FROM belongs_to WHERE out = $project)",
            "  OR id IN (",
            "    SELECT VALUE out",
            "    FROM has_task",
            "    WHERE `in` IN (SELECT VALUE out FROM has_feature WHERE `in` = $project)",
            "  )",
            ");",
          ].join(" "),
          { project: project.id },
        )
        .collect<[Array<{ count: number }>]>();

      return {
        id: toRecordIdString(project.id),
        name: project.name,
        activeTaskCount: countRows[0]?.count ?? 0,
      } satisfies WorkspaceProjectSummary;
    }),
  );

  return counts;
}

export async function listWorkspaceRecentDecisions(input: {
  surreal: Surreal;
  workspaceRecord: RecordId<"workspace", string>;
  limit: number;
}): Promise<WorkspaceDecisionSummary[]> {
  const projects = await getWorkspaceProjectRows(input.surreal, input.workspaceRecord);
  const projectRecords = projects.map((project) => project.id);
  const projectById = new Map(projects.map((project) => [toRecordIdString(project.id), project.name]));

  const [rows] = await input.surreal
    .query<[Array<{ id: RecordId<"decision", string>; summary: string; status: string; priority?: string; created_at: string | Date }>]>(
      [
        "SELECT id, summary, status, priority, created_at",
        "FROM decision",
        "WHERE workspace = $workspace",
        "ORDER BY created_at DESC",
        "LIMIT $limit;",
      ].join(" "),
      {
        workspace: input.workspaceRecord,
        limit: input.limit,
      },
    )
    .collect<[Array<{ id: RecordId<"decision", string>; summary: string; status: string; priority?: string; created_at: string | Date }>]>();

  const values: WorkspaceDecisionSummary[] = [];

  for (const row of rows) {
    const [projectRows] = await input.surreal
      .query<[Array<RecordId<"project", string>>]>(
        "SELECT VALUE out FROM belongs_to WHERE `in` = $decision AND out IN $projects LIMIT 1;",
        {
          decision: row.id,
          projects: projectRecords,
        },
      )
      .collect<[Array<RecordId<"project", string>>]>();

    const project = projectRows[0] ? projectById.get(toRecordIdString(projectRows[0])) : undefined;

    values.push({
      id: toRecordIdString(row.id),
      name: row.summary,
      status: row.status,
      ...(row.priority ? { priority: row.priority } : {}),
      ...(project ? { project } : {}),
    });
  }

  return values;
}

export async function listWorkspaceOpenQuestions(input: {
  surreal: Surreal;
  workspaceRecord: RecordId<"workspace", string>;
  limit: number;
}): Promise<WorkspaceQuestionSummary[]> {
  const projects = await getWorkspaceProjectRows(input.surreal, input.workspaceRecord);
  const projectRecords = projects.map((project) => project.id);
  const projectById = new Map(projects.map((project) => [toRecordIdString(project.id), project.name]));

  const [rows] = await input.surreal
    .query<[Array<{ id: RecordId<"question", string>; text: string; status: string; priority?: string; created_at: string | Date }>]>(
      [
        "SELECT id, text, status, priority, created_at",
        "FROM question",
        "WHERE workspace = $workspace",
        "AND status = 'open'",
        "ORDER BY created_at DESC",
        "LIMIT $limit;",
      ].join(" "),
      {
        workspace: input.workspaceRecord,
        limit: input.limit,
      },
    )
    .collect<[Array<{ id: RecordId<"question", string>; text: string; status: string; priority?: string; created_at: string | Date }>]>();

  const values: WorkspaceQuestionSummary[] = [];

  for (const row of rows) {
    const [projectRows] = await input.surreal
      .query<[Array<RecordId<"project", string>>]>(
        "SELECT VALUE out FROM belongs_to WHERE `in` = $question AND out IN $projects LIMIT 1;",
        {
          question: row.id,
          projects: projectRecords,
        },
      )
      .collect<[Array<RecordId<"project", string>>]>();

    const project = projectRows[0] ? projectById.get(toRecordIdString(projectRows[0])) : undefined;

    values.push({
      id: toRecordIdString(row.id),
      name: row.text,
      ...(row.priority ? { priority: row.priority } : {}),
      ...(project ? { project } : {}),
    });
  }

  return values;
}

export async function resolveWorkspaceProjectRecord(input: {
  surreal: Surreal;
  workspaceRecord: RecordId<"workspace", string>;
  projectInput: string;
}): Promise<RecordId<"project", string>> {
  const projectInput = input.projectInput.trim();
  if (projectInput.length === 0) {
    throw new Error("project identifier is required");
  }

  if (projectInput.includes(":")) {
    const projectRecord = parseRecordIdString(projectInput, ["project"]);
    const scoped = await isEntityInWorkspace(input.surreal, input.workspaceRecord, projectRecord);
    if (!scoped) {
      throw new Error("project is not linked to this workspace");
    }
    return projectRecord;
  }

  const projects = await getWorkspaceProjectRows(input.surreal, input.workspaceRecord);
  const normalized = normalizeSearchValue(projectInput);

  const exactMatch = projects.find((project) => normalizeSearchValue(project.name) === normalized);
  if (exactMatch) {
    return exactMatch.id;
  }

  const fuzzyMatches = projects.filter((project) => normalizeSearchValue(project.name).includes(normalized));
  if (fuzzyMatches.length === 1) {
    return fuzzyMatches[0].id;
  }

  if (fuzzyMatches.length > 1) {
    throw new Error(`project input is ambiguous: ${fuzzyMatches.map((project) => project.name).join(", ")}`);
  }

  throw new Error(`project not found in workspace: ${projectInput}`);
}

export async function resolveWorkspaceFeatureRecord(input: {
  surreal: Surreal;
  workspaceRecord: RecordId<"workspace", string>;
  featureInput: string;
}): Promise<RecordId<"feature", string>> {
  const featureInput = input.featureInput.trim();
  if (featureInput.length === 0) {
    throw new Error("feature identifier is required");
  }

  if (featureInput.includes(":")) {
    const featureRecord = parseRecordIdString(featureInput, ["feature"]);
    const scoped = await isEntityInWorkspace(input.surreal, input.workspaceRecord, featureRecord);
    if (!scoped) {
      throw new Error("feature is not linked to this workspace");
    }
    return featureRecord;
  }

  const [rows] = await input.surreal
    .query<[Array<{ id: RecordId<"feature", string>; name: string }>]>(
      [
        "SELECT id, name",
        "FROM feature",
        "WHERE id IN (",
        "  SELECT VALUE out",
        "  FROM has_feature",
        "  WHERE `in` IN (SELECT VALUE out FROM has_project WHERE `in` = $workspace)",
        ");",
      ].join(" "),
      {
        workspace: input.workspaceRecord,
      },
    )
    .collect<[Array<{ id: RecordId<"feature", string>; name: string }>]>();

  const normalized = normalizeSearchValue(featureInput);
  const exactMatch = rows.find((row) => normalizeSearchValue(row.name) === normalized);
  if (exactMatch) {
    return exactMatch.id;
  }

  const fuzzy = rows.filter((row) => normalizeSearchValue(row.name).includes(normalized));
  if (fuzzy.length === 1) {
    return fuzzy[0].id;
  }

  if (fuzzy.length > 1) {
    throw new Error(`feature input is ambiguous: ${fuzzy.map((row) => row.name).join(", ")}`);
  }

  throw new Error(`feature not found in workspace: ${featureInput}`);
}

async function listScopedEntityCandidates(input: {
  surreal: Surreal;
  workspaceRecord: RecordId<"workspace", string>;
  kinds?: SearchEntityKind[];
  projectRecord?: RecordId<"project", string>;
  candidateLimit: number;
}): Promise<EntitySearchCandidate[]> {
  const kinds = input.kinds && input.kinds.length > 0 ? input.kinds : SEARCH_KINDS;
  const candidates: EntitySearchCandidate[] = [];
  const projects = input.projectRecord ? [input.projectRecord] : (await getWorkspaceProjectRows(input.surreal, input.workspaceRecord)).map((row) => row.id);

  if (kinds.includes("project")) {
    const [rows] = await input.surreal
      .query<[Array<{ id: RecordId<"project", string>; name: string; status: string; embedding?: number[] }>]>(
        input.projectRecord
          ? "SELECT id, name, status, embedding FROM project WHERE id = $project LIMIT 1;"
          : "SELECT id, name, status, embedding FROM project WHERE id IN (SELECT VALUE out FROM has_project WHERE `in` = $workspace) LIMIT $limit;",
        input.projectRecord
          ? { project: input.projectRecord }
          : { workspace: input.workspaceRecord, limit: input.candidateLimit },
      )
      .collect<[Array<{ id: RecordId<"project", string>; name: string; status: string; embedding?: number[] }>]>();

    for (const row of rows) {
      candidates.push({
        id: row.id,
        kind: "project",
        name: row.name,
        status: row.status,
        embedding: row.embedding,
      });
    }
  }

  if (kinds.includes("feature")) {
    const [rows] = await input.surreal
      .query<[Array<{ id: RecordId<"feature", string>; name: string; status: string; embedding?: number[] }>]>(
        [
          "SELECT id, name, status, embedding",
          "FROM feature",
          "WHERE id IN (",
          "  SELECT VALUE out",
          "  FROM has_feature",
          input.projectRecord
            ? "  WHERE `in` = $project"
            : "  WHERE `in` IN (SELECT VALUE out FROM has_project WHERE `in` = $workspace)",
          ")",
          "LIMIT $limit;",
        ].join(" "),
        input.projectRecord
          ? { project: input.projectRecord, limit: input.candidateLimit }
          : { workspace: input.workspaceRecord, limit: input.candidateLimit },
      )
      .collect<[Array<{ id: RecordId<"feature", string>; name: string; status: string; embedding?: number[] }>]>();

    for (const row of rows) {
      candidates.push({
        id: row.id,
        kind: "feature",
        name: row.name,
        status: row.status,
        embedding: row.embedding,
      });
    }
  }

  if (kinds.includes("task")) {
    const [rows] = await input.surreal
      .query<[Array<{ id: RecordId<"task", string>; title: string; status: string; embedding?: number[] }>]>(
        [
          "SELECT id, title, status, embedding",
          "FROM task",
          "WHERE (",
          input.projectRecord
            ? "  id IN (SELECT VALUE `in` FROM belongs_to WHERE out = $project)"
            : "  id IN (SELECT VALUE `in` FROM belongs_to WHERE out IN $projects)",
          "  OR source_message IN (",
          "    SELECT VALUE id",
          "    FROM message",
          "    WHERE conversation IN (SELECT VALUE id FROM conversation WHERE workspace = $workspace)",
          "  )",
          ")",
          "LIMIT $limit;",
        ].join(" "),
        {
          workspace: input.workspaceRecord,
          ...(input.projectRecord ? { project: input.projectRecord } : { projects }),
          limit: input.candidateLimit,
        },
      )
      .collect<[Array<{ id: RecordId<"task", string>; title: string; status: string; embedding?: number[] }>]>();

    for (const row of rows) {
      candidates.push({
        id: row.id,
        kind: "task",
        name: row.title,
        status: row.status,
        embedding: row.embedding,
      });
    }
  }

  if (kinds.includes("decision")) {
    const [rows] = await input.surreal
      .query<[Array<{ id: RecordId<"decision", string>; summary: string; status: string; embedding?: number[] }>]>(
        [
          "SELECT id, summary, status, embedding",
          "FROM decision",
          "WHERE (",
          input.projectRecord
            ? "  id IN (SELECT VALUE `in` FROM belongs_to WHERE out = $project)"
            : "  id IN (SELECT VALUE `in` FROM belongs_to WHERE out IN $projects)",
          "  OR source_message IN (",
          "    SELECT VALUE id",
          "    FROM message",
          "    WHERE conversation IN (SELECT VALUE id FROM conversation WHERE workspace = $workspace)",
          "  )",
          ")",
          "LIMIT $limit;",
        ].join(" "),
        {
          workspace: input.workspaceRecord,
          ...(input.projectRecord ? { project: input.projectRecord } : { projects }),
          limit: input.candidateLimit,
        },
      )
      .collect<[Array<{ id: RecordId<"decision", string>; summary: string; status: string; embedding?: number[] }>]>();

    for (const row of rows) {
      candidates.push({
        id: row.id,
        kind: "decision",
        name: row.summary,
        status: row.status,
        embedding: row.embedding,
      });
    }
  }

  if (kinds.includes("question")) {
    const [rows] = await input.surreal
      .query<[Array<{ id: RecordId<"question", string>; text: string; status: string; embedding?: number[] }>]>(
        [
          "SELECT id, text, status, embedding",
          "FROM question",
          "WHERE (",
          input.projectRecord
            ? "  id IN (SELECT VALUE `in` FROM belongs_to WHERE out = $project)"
            : "  id IN (SELECT VALUE `in` FROM belongs_to WHERE out IN $projects)",
          "  OR source_message IN (",
          "    SELECT VALUE id",
          "    FROM message",
          "    WHERE conversation IN (SELECT VALUE id FROM conversation WHERE workspace = $workspace)",
          "  )",
          ")",
          "LIMIT $limit;",
        ].join(" "),
        {
          workspace: input.workspaceRecord,
          ...(input.projectRecord ? { project: input.projectRecord } : { projects }),
          limit: input.candidateLimit,
        },
      )
      .collect<[Array<{ id: RecordId<"question", string>; text: string; status: string; embedding?: number[] }>]>();

    for (const row of rows) {
      candidates.push({
        id: row.id,
        kind: "question",
        name: row.text,
        status: row.status,
        embedding: row.embedding,
      });
    }
  }

  if (kinds.includes("suggestion")) {
    const [rows] = await input.surreal
      .query<[Array<{ id: RecordId<"suggestion", string>; text: string; status: string; embedding?: number[] }>]>(
        "SELECT id, text, status, embedding FROM suggestion WHERE workspace = $workspace LIMIT $limit;",
        { workspace: input.workspaceRecord, limit: input.candidateLimit },
      )
      .collect<[Array<{ id: RecordId<"suggestion", string>; text: string; status: string; embedding?: number[] }>]>();

    for (const row of rows) {
      candidates.push({
        id: row.id,
        kind: "suggestion",
        name: row.text,
        status: row.status,
        embedding: row.embedding,
      });
    }
  }

  return candidates;
}

export async function searchEntitiesByEmbedding(input: {
  surreal: Surreal;
  workspaceRecord: RecordId<"workspace", string>;
  queryEmbedding: number[];
  kinds?: SearchEntityKind[];
  projectRecord?: RecordId<"project", string>;
  limit: number;
}): Promise<RankedEntity[]> {
  const candidates = await listScopedEntityCandidates({
    surreal: input.surreal,
    workspaceRecord: input.workspaceRecord,
    kinds: input.kinds,
    projectRecord: input.projectRecord,
    candidateLimit: Math.max(input.limit * 20, 120),
  });

  const rows = candidates
    .map((candidate) => ({
      candidate,
      score: candidate.embedding ? cosineSimilarity(input.queryEmbedding, candidate.embedding) : -1,
    }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, input.limit);

  return rows.map((row) => ({
    id: toRecordIdString(row.candidate.id),
    kind: row.candidate.kind,
    name: row.candidate.name,
    score: row.score,
    ...(row.candidate.status ? { status: row.candidate.status } : {}),
  }));
}

export async function listEntityNeighbors(input: {
  surreal: Surreal;
  workspaceRecord: RecordId<"workspace", string>;
  entityRecord: GraphEntityRecord;
  limit: number;
}): Promise<EntityNeighbor[]> {
  const [rows] = await input.surreal
    .query<[Array<{ in: GraphEntityRecord; out: GraphEntityRecord; kind: string; confidence: number; extracted_at: string | Date }>]>(
      [
        "SELECT `in`, out, kind, confidence, extracted_at",
        "FROM entity_relation",
        "WHERE `in` = $entity OR out = $entity",
        "ORDER BY extracted_at DESC",
        "LIMIT $limit;",
      ].join(" "),
      { entity: input.entityRecord, limit: input.limit },
    )
    .collect<[Array<{ in: GraphEntityRecord; out: GraphEntityRecord; kind: string; confidence: number; extracted_at: string | Date }>]>() ;

  const neighbors: EntityNeighbor[] = [];

  for (const row of rows) {
    const direction = toRecordIdString(row.in) === toRecordIdString(input.entityRecord) ? "outgoing" : "incoming";
    const neighborRecord = direction === "outgoing" ? row.out : row.in;

    const scoped = await isEntityInWorkspace(input.surreal, input.workspaceRecord, neighborRecord);
    if (!scoped) {
      continue;
    }

    const name = await readEntityName(input.surreal, neighborRecord);
    if (!name) {
      continue;
    }

    neighbors.push({
      id: toRecordIdString(neighborRecord),
      kind: neighborRecord.table.name as GraphEntityTable,
      name,
      relationKind: row.kind,
      direction,
      confidence: row.confidence,
    });
  }

  return neighbors;
}

export async function getEntityDetail(input: {
  surreal: Surreal;
  workspaceRecord: RecordId<"workspace", string>;
  entityRecord: GraphEntityRecord;
}): Promise<EntityDetail> {
  const scoped = await isEntityInWorkspace(input.surreal, input.workspaceRecord, input.entityRecord);
  if (!scoped) {
    throw new Error("entity is outside the current workspace scope");
  }

  const table = input.entityRecord.table.name as GraphEntityTable;
  const row = await input.surreal.select<Record<string, unknown>>(input.entityRecord);
  if (!row) {
    throw new Error(`entity not found: ${table}:${toRecordIdString(input.entityRecord)}`);
  }

  const name = await readEntityName(input.surreal, input.entityRecord);
  if (!name) {
    throw new Error(`entity has no readable name field: ${table}:${toRecordIdString(input.entityRecord)}`);
  }

  const relationships = await listEntityNeighbors({
    surreal: input.surreal,
    workspaceRecord: input.workspaceRecord,
    entityRecord: input.entityRecord,
    limit: 40,
  });

  const [provenanceRows] = await input.surreal
    .query<[
      Array<{
        in: RecordId<"message" | "document_chunk" | "git_commit", string>;
        confidence: number;
        extracted_at: string | Date;
        evidence?: string;
        evidence_source?: RecordId<"message", string>;
        resolved_from?: RecordId<"message", string>;
        from_text?: string;
      }>,
    ]>(
      [
        "SELECT `in`, confidence, extracted_at, evidence, evidence_source, resolved_from, from_text",
        "FROM extraction_relation",
        "WHERE out = $entity",
        "AND (",
        "  `in` IN (",
        "    SELECT VALUE id",
        "    FROM message",
        "    WHERE conversation IN (SELECT VALUE id FROM conversation WHERE workspace = $workspace)",
        "  )",
        "  OR `in` IN (SELECT VALUE id FROM document_chunk WHERE workspace = $workspace)",
        "  OR `in` IN (SELECT VALUE id FROM git_commit WHERE workspace = $workspace)",
        ")",
        "ORDER BY extracted_at DESC",
        "LIMIT 40;",
      ].join(" "),
      {
        workspace: input.workspaceRecord,
        entity: input.entityRecord,
      },
    )
    .collect<[
      Array<{
        in: RecordId<"message" | "document_chunk" | "git_commit", string>;
        confidence: number;
        extracted_at: string | Date;
        evidence?: string;
        evidence_source?: RecordId<"message", string>;
        resolved_from?: RecordId<"message", string>;
        from_text?: string;
      }>,
    ]>();

  // Resolve conversationIds for message-type provenance sources
  const messageProvenanceRows = provenanceRows.filter((r) => r.in.table.name === "message");
  let convMap: Map<string, string> | undefined;
  if (messageProvenanceRows.length > 0) {
    const [convRows] = await input.surreal
      .query<[Array<{ id: RecordId<"message", string>; conversation: RecordId<"conversation", string> }>]>(
        "SELECT id, conversation FROM message WHERE id IN $ids;",
        { ids: messageProvenanceRows.map((r) => r.in) },
      )
      .collect<[Array<{ id: RecordId<"message", string>; conversation: RecordId<"conversation", string> }>]>();
    convMap = new Map(convRows.map((r) => [r.id.id as string, r.conversation.id as string]));
  }

  const provenance = provenanceRows.map((row) => ({
    sourceId: toRecordIdString(row.in),
    sourceKind: row.in.table.name === "document_chunk"
      ? "document_chunk"
      : row.in.table.name === "git_commit"
        ? "git_commit"
        : "message",
    confidence: row.confidence,
    extractedAt: toIsoString(row.extracted_at),
    ...(row.in.table.name === "message" && convMap?.get(row.in.id as string)
      ? { conversationId: convMap.get(row.in.id as string) }
      : {}),
    ...(row.evidence ? { evidence: row.evidence } : {}),
    ...(row.evidence_source ? { evidenceSource: toRecordIdString(row.evidence_source) } : {}),
    ...(row.resolved_from ? { resolvedFrom: toRecordIdString(row.resolved_from) } : {}),
    ...(row.from_text ? { fromText: row.from_text } : {}),
  } satisfies EntityProvenance));

  return {
    entity: {
      id: toRecordIdString(input.entityRecord),
      kind: table,
      name,
      data: row,
    },
    relationships,
    provenance,
  };
}

export async function getProjectStatus(input: {
  surreal: Surreal;
  workspaceRecord: RecordId<"workspace", string>;
  projectInput: string;
}): Promise<ProjectStatus> {
  const projectRecord = await resolveWorkspaceProjectRecord({
    surreal: input.surreal,
    workspaceRecord: input.workspaceRecord,
    projectInput: input.projectInput,
  });

  const project = await input.surreal.select<{ id: RecordId<"project", string>; name: string }>(projectRecord);
  if (!project) {
    throw new Error(`project not found: ${toRecordIdString(projectRecord)}`);
  }

  const [featureRows] = await input.surreal
    .query<[Array<{ id: RecordId<"feature", string>; name: string; status: string }>]>(
      "SELECT id, name, status FROM feature WHERE id IN (SELECT VALUE out FROM has_feature WHERE `in` = $project);",
      { project: projectRecord },
    )
    .collect<[Array<{ id: RecordId<"feature", string>; name: string; status: string }>]>();

  const [taskRows] = await input.surreal
    .query<[Array<{ id: RecordId<"task", string>; title: string; status: string; priority?: string; created_at: string | Date }>]>(
      [
        "SELECT id, title, status, priority, created_at",
        "FROM task",
        "WHERE id IN (SELECT VALUE `in` FROM belongs_to WHERE out = $project)",
        "OR id IN (",
        "  SELECT VALUE out",
        "  FROM has_task",
        "  WHERE `in` IN (SELECT VALUE out FROM has_feature WHERE `in` = $project)",
        ")",
        "ORDER BY created_at DESC",
        "LIMIT 100;",
      ].join(" "),
      { project: projectRecord },
    )
    .collect<[Array<{ id: RecordId<"task", string>; title: string; status: string; priority?: string; created_at: string | Date }>]>();

  const [decisionRows] = await input.surreal
    .query<[Array<{ id: RecordId<"decision", string>; summary: string; status: string; priority?: string; created_at: string | Date }>]>(
      [
        "SELECT id, summary, status, priority, created_at",
        "FROM decision",
        "WHERE id IN (SELECT VALUE `in` FROM belongs_to WHERE out = $project)",
        "ORDER BY created_at DESC",
        "LIMIT 30;",
      ].join(" "),
      { project: projectRecord },
    )
    .collect<[Array<{ id: RecordId<"decision", string>; summary: string; status: string; priority?: string; created_at: string | Date }>]>();

  const [questionRows] = await input.surreal
    .query<[Array<{ id: RecordId<"question", string>; text: string; status: string; priority?: string; created_at: string | Date }>]>(
      [
        "SELECT id, text, status, priority, created_at",
        "FROM question",
        "WHERE id IN (SELECT VALUE `in` FROM belongs_to WHERE out = $project)",
        "ORDER BY created_at DESC",
        "LIMIT 30;",
      ].join(" "),
      { project: projectRecord },
    )
    .collect<[Array<{ id: RecordId<"question", string>; text: string; status: string; priority?: string; created_at: string | Date }>]>();

  let active = 0;
  let completed = 0;
  let blocked = 0;

  for (const task of taskRows) {
    const normalized = task.status.trim().toLowerCase();
    if (normalized === "blocked") {
      blocked += 1;
      continue;
    }

    if (normalized === "done" || normalized === "completed") {
      completed += 1;
      continue;
    }

    active += 1;
  }

  return {
    project: {
      id: toRecordIdString(project.id),
      name: project.name,
    },
    tasks: {
      active,
      completed,
      blocked,
      recent: taskRows.slice(0, 20).map((task) => ({
        id: toRecordIdString(task.id),
        name: task.title,
        status: task.status,
        ...(task.priority ? { priority: task.priority } : {}),
      })),
    },
    decisions: decisionRows.map((decision) => ({
      id: toRecordIdString(decision.id),
      name: decision.summary,
      status: decision.status,
      ...(decision.priority ? { priority: decision.priority } : {}),
    })),
    questions: questionRows.map((question) => ({
      id: toRecordIdString(question.id),
      name: question.text,
      status: question.status,
      ...(question.priority ? { priority: question.priority } : {}),
    })),
    features: featureRows.map((feature) => ({
      id: toRecordIdString(feature.id),
      name: feature.name,
      status: feature.status,
    })),
  };
}

export async function searchConversationMessagesByEmbedding(input: {
  surreal: Surreal;
  workspaceRecord: RecordId<"workspace", string>;
  queryEmbedding: number[];
  projectRecord?: RecordId<"project", string>;
  limit: number;
}): Promise<RankedMessage[]> {
  let rows: Array<{ id: RecordId<"message", string>; conversation: RecordId<"conversation", string>; text: string; createdAt: string | Date; embedding?: number[] }> = [];

  if (input.projectRecord) {
    const [projectEntityRows] = await input.surreal
      .query<[Array<RecordId<"task" | "decision" | "question", string>>]>(
        "SELECT VALUE `in` FROM belongs_to WHERE out = $project;",
        { project: input.projectRecord },
      )
      .collect<[Array<RecordId<"task" | "decision" | "question", string>>]>();

    const scopedEntities: Array<RecordId<string, string>> = [input.projectRecord, ...projectEntityRows];

    const [messageRows] = await input.surreal
      .query<[
        Array<{
          id: RecordId<"message", string>;
          conversation: RecordId<"conversation", string>;
          text: string;
          createdAt: string | Date;
          embedding?: number[];
        }>,
      ]>(
        [
          "SELECT id, conversation, text, createdAt, embedding",
          "FROM message",
          "WHERE embedding != NONE",
          "AND conversation IN (SELECT VALUE id FROM conversation WHERE workspace = $workspace)",
          "AND id IN (SELECT VALUE `in` FROM extraction_relation WHERE out IN $entities)",
          "ORDER BY createdAt DESC",
          "LIMIT $limit;",
        ].join(" "),
        {
          workspace: input.workspaceRecord,
          entities: scopedEntities,
          limit: Math.max(input.limit * 25, 250),
        },
      )
      .collect<[
        Array<{
          id: RecordId<"message", string>;
          conversation: RecordId<"conversation", string>;
          text: string;
          createdAt: string | Date;
          embedding?: number[];
        }>,
      ]>();

    rows = messageRows;
  } else {
    const [messageRows] = await input.surreal
      .query<[
        Array<{
          id: RecordId<"message", string>;
          conversation: RecordId<"conversation", string>;
          text: string;
          createdAt: string | Date;
          embedding?: number[];
        }>,
      ]>(
        [
          "SELECT id, conversation, text, createdAt, embedding",
          "FROM message",
          "WHERE embedding != NONE",
          "AND conversation IN (SELECT VALUE id FROM conversation WHERE workspace = $workspace)",
          "ORDER BY createdAt DESC",
          "LIMIT $limit;",
        ].join(" "),
        {
          workspace: input.workspaceRecord,
          limit: Math.max(input.limit * 25, 250),
        },
      )
      .collect<[
        Array<{
          id: RecordId<"message", string>;
          conversation: RecordId<"conversation", string>;
          text: string;
          createdAt: string | Date;
          embedding?: number[];
        }>,
      ]>();

    rows = messageRows;
  }

  const ranked = rows
    .map((row) => ({
      row,
      score: row.embedding ? cosineSimilarity(input.queryEmbedding, row.embedding) : -1,
    }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, input.limit)
    .map((item) => ({
      id: toRecordIdString(item.row.id),
      conversationId: toRecordIdString(item.row.conversation),
      text: item.row.text,
      score: item.score,
      createdAt: toIsoString(item.row.createdAt),
    } satisfies RankedMessage));

  return ranked;
}

export async function createDecisionRecord(input: {
  surreal: Surreal;
  summary: string;
  status: string;
  now: Date;
  workspaceRecord: RecordId<"workspace", string>;
  sourceMessageRecord?: RecordId<"message", string>;
  rationale?: string;
  optionsConsidered?: string[];
  basedOn?: GraphEntityRecord[];
  inferredBy?: string;
  decidedByName?: string;
  projectRecord?: RecordId<"project", string>;
  featureRecord?: RecordId<"feature", string>;
}): Promise<RecordId<"decision", string>> {
  const decisionRecord = new RecordId("decision", randomUUID());

  await input.surreal.create(decisionRecord).content({
    summary: input.summary,
    status: input.status,
    created_at: input.now,
    updated_at: input.now,
    workspace: input.workspaceRecord,
    ...(input.sourceMessageRecord ? { source_message: input.sourceMessageRecord } : {}),
    ...(input.rationale ? { rationale: input.rationale } : {}),
    ...(input.optionsConsidered && input.optionsConsidered.length > 0
      ? { options_considered: input.optionsConsidered }
      : {}),
    ...(input.basedOn && input.basedOn.length > 0 ? { based_on: input.basedOn } : {}),
    ...(input.inferredBy ? { inferred_by: input.inferredBy } : {}),
    ...(input.decidedByName ? { decided_by_name: input.decidedByName } : {}),
  });

  if (input.projectRecord) {
    await input.surreal.relate(decisionRecord, new RecordId("belongs_to", randomUUID()), input.projectRecord, {
      added_at: input.now,
    }).output("after");
  }

  if (input.featureRecord) {
    await input.surreal.relate(decisionRecord, new RecordId("belongs_to", randomUUID()), input.featureRecord, {
      added_at: input.now,
    }).output("after");
  }

  return decisionRecord;
}

export async function createQuestionRecord(input: {
  surreal: Surreal;
  text: string;
  status: string;
  now: Date;
  workspaceRecord: RecordId<"workspace", string>;
  sourceMessageRecord?: RecordId<"message", string>;
  category?: string;
  priority?: string;
  assignedToName?: string;
  projectRecord?: RecordId<"project", string>;
  featureRecord?: RecordId<"feature", string>;
}): Promise<RecordId<"question", string>> {
  const questionRecord = new RecordId("question", randomUUID());

  await input.surreal.create(questionRecord).content({
    text: input.text,
    status: input.status,
    created_at: input.now,
    updated_at: input.now,
    workspace: input.workspaceRecord,
    ...(input.sourceMessageRecord ? { source_message: input.sourceMessageRecord } : {}),
    ...(input.category ? { category: input.category } : {}),
    ...(input.priority ? { priority: input.priority } : {}),
    ...(input.assignedToName ? { assigned_to_name: input.assignedToName } : {}),
  });

  if (input.projectRecord) {
    await input.surreal.relate(questionRecord, new RecordId("belongs_to", randomUUID()), input.projectRecord, {
      added_at: input.now,
    }).output("after");
  }

  if (input.featureRecord) {
    await input.surreal.relate(questionRecord, new RecordId("belongs_to", randomUUID()), input.featureRecord, {
      added_at: input.now,
    }).output("after");
  }

  return questionRecord;
}

export async function createProjectRecord(input: {
  surreal: Surreal;
  name: string;
  status: string;
  now: Date;
  workspaceRecord: RecordId<"workspace", string>;
  sourceMessageRecord?: RecordId<"message", string>;
}): Promise<RecordId<"project", string>> {
  const projectRecord = new RecordId("project", randomUUID());

  await input.surreal.create(projectRecord).content({
    name: input.name,
    status: input.status,
    created_at: input.now,
    updated_at: input.now,
    workspace: input.workspaceRecord,
    ...(input.sourceMessageRecord ? { source_message: input.sourceMessageRecord } : {}),
  });

  await input.surreal.relate(input.workspaceRecord, new RecordId("has_project", randomUUID()), projectRecord, {
    added_at: input.now,
  }).output("after");

  return projectRecord;
}

export async function createExtractionProvenanceEdge(input: {
  surreal: Surreal;
  sourceRecord: RecordId<"message", string>;
  targetRecord: GraphEntityRecord;
  now: Date;
  confidence: number;
  model: string;
  fromText: string;
  evidence: string;
  evidenceSourceRecord?: RecordId<"message", string>;
  resolvedFromRecord?: RecordId<"message", string>;
}): Promise<RecordId<"extraction_relation", string>> {
  const edgeRecord = new RecordId("extraction_relation", randomUUID());

  await input.surreal
    .relate(input.sourceRecord, edgeRecord, input.targetRecord, {
      confidence: input.confidence,
      extracted_at: input.now,
      created_at: input.now,
      model: input.model,
      from_text: input.fromText,
      evidence: input.evidence,
      ...(input.evidenceSourceRecord ? { evidence_source: input.evidenceSourceRecord } : {}),
      ...(input.resolvedFromRecord ? { resolved_from: input.resolvedFromRecord } : {}),
    })
    .output("after");

  return edgeRecord;
}

export async function getDecisionPrimarySourceMessage(input: {
  surreal: Surreal;
  workspaceRecord: RecordId<"workspace", string>;
  decisionRecord: RecordId<"decision", string>;
}): Promise<RecordId<"message", string> | undefined> {
  const decision = await input.surreal.select<{ source_message?: RecordId<"message", string> }>(input.decisionRecord);
  if (decision?.source_message) {
    const workspaceMessageIds = new Set((await getWorkspaceMessageIds(input.surreal, input.workspaceRecord)).map((row) => toRecordIdString(row)));
    if (workspaceMessageIds.has(toRecordIdString(decision.source_message))) {
      return decision.source_message;
    }
  }

  const [rows] = await input.surreal
    .query<[Array<{ in: RecordId<"message", string> }>]>(
      [
        "SELECT `in`",
        "FROM extraction_relation",
        "WHERE out = $decision",
        "AND `in` IN (",
        "  SELECT VALUE id",
        "  FROM message",
        "  WHERE conversation IN (SELECT VALUE id FROM conversation WHERE workspace = $workspace)",
        ")",
        "ORDER BY extracted_at ASC",
        "LIMIT 1;",
      ].join(" "),
      {
        workspace: input.workspaceRecord,
        decision: input.decisionRecord,
      },
    )
    .collect<[Array<{ in: RecordId<"message", string> }>]>();

  return rows[0]?.in;
}

export async function getWorkspaceOwnerRecord(input: {
  surreal: Surreal;
  workspaceRecord: RecordId<"workspace", string>;
}): Promise<RecordId<"person", string> | undefined> {
  const [rows] = await input.surreal
    .query<[Array<RecordId<"person", string>>]>(
      "SELECT VALUE `in` FROM member_of WHERE out = $workspace AND role = 'owner' LIMIT 1;",
      { workspace: input.workspaceRecord },
    )
    .collect<[Array<RecordId<"person", string>>]>();

  return rows[0];
}

export async function getDecisionRecordForWorkspace(input: {
  surreal: Surreal;
  workspaceRecord: RecordId<"workspace", string>;
  decisionInput: string;
}): Promise<{ id: RecordId<"decision", string>; summary: string; status: string }> {
  const decisionRecord = parseRecordIdString(input.decisionInput, ["decision"], "decision");
  const scoped = await isEntityInWorkspace(input.surreal, input.workspaceRecord, decisionRecord);
  if (!scoped) {
    throw new Error("decision is outside the current workspace scope");
  }

  const row = await input.surreal.select<{ id: RecordId<"decision", string>; summary: string; status: string }>(decisionRecord);
  if (!row) {
    throw new Error(`decision not found: ${input.decisionInput}`);
  }

  return row;
}

export async function confirmDecisionRecord(input: {
  surreal: Surreal;
  decisionRecord: RecordId<"decision", string>;
  confirmedAt: Date;
  confirmedBy?: RecordId<"person", string>;
  notes?: string;
}): Promise<void> {
  await input.surreal.update(input.decisionRecord).merge({
    status: "confirmed",
    confirmed_at: input.confirmedAt,
    ...(input.confirmedBy ? { confirmed_by: input.confirmedBy } : {}),
    ...(input.notes ? { confirmation_notes: input.notes } : {}),
    updated_at: input.confirmedAt,
  });
}

export async function listDecisionConstraintCandidates(input: {
  surreal: Surreal;
  workspaceRecord: RecordId<"workspace", string>;
  queryEmbedding: number[];
  projectRecord?: RecordId<"project", string>;
  limit: number;
}): Promise<RankedEntity[]> {
  return searchEntitiesByEmbedding({
    surreal: input.surreal,
    workspaceRecord: input.workspaceRecord,
    queryEmbedding: input.queryEmbedding,
    kinds: ["decision", "question", "task"],
    ...(input.projectRecord ? { projectRecord: input.projectRecord } : {}),
    limit: input.limit,
  });
}

// ---------------------------------------------------------------------------
// Graph view queries
// ---------------------------------------------------------------------------

type EntityRelationRow = {
  id: RecordId<"entity_relation", string>;
  in: GraphEntityRecord;
  out: GraphEntityRecord;
  kind: string;
  confidence: number;
};

async function collectEntityRelationEdges(
  surreal: Surreal,
  entityIds: RecordId<string, string>[],
): Promise<GraphViewRawEdge[]> {
  if (entityIds.length === 0) {
    return [];
  }

  const [rows] = await surreal
    .query<[EntityRelationRow[]]>(
      [
        "SELECT id, `in`, out, kind, confidence",
        "FROM entity_relation",
        "WHERE `in` IN $entityIds AND out IN $entityIds;",
      ].join(" "),
      { entityIds },
    )
    .collect<[EntityRelationRow[]]>();

  return rows.map((row) => ({
    id: toRecordIdString(row.id),
    fromId: toRecordIdString(row.in),
    toId: toRecordIdString(row.out),
    kind: row.kind,
    confidence: row.confidence,
  }));
}

async function resolveEntityNames(
  surreal: Surreal,
  records: GraphEntityRecord[],
): Promise<GraphViewRawEntity[]> {
  const entities: GraphViewRawEntity[] = [];

  for (const record of records) {
    const name = await readEntityName(surreal, record);
    if (!name) {
      continue;
    }

    entities.push({
      id: toRecordIdString(record),
      kind: record.table.name as GraphEntityTable,
      name,
    });
  }

  return entities;
}

export async function getProjectGraphView(input: {
  surreal: Surreal;
  workspaceRecord: RecordId<"workspace", string>;
  projectRecord: RecordId<"project", string>;
}): Promise<GraphViewRawResult> {
  const scoped = await isEntityInWorkspace(input.surreal, input.workspaceRecord, input.projectRecord);
  if (!scoped) {
    throw new Error("project is outside the current workspace scope");
  }

  const allRecords: GraphEntityRecord[] = [input.projectRecord as GraphEntityRecord];
  const seen = new Set<string>();
  seen.add(toRecordIdString(input.projectRecord));

  const addRecord = (record: GraphEntityRecord) => {
    const key = toRecordIdString(record);
    if (!seen.has(key)) {
      seen.add(key);
      allRecords.push(record);
    }
  };

  // Features via has_feature
  const [featureRows] = await input.surreal
    .query<[Array<RecordId<"feature", string>>]>(
      "SELECT VALUE out FROM has_feature WHERE `in` = $project;",
      { project: input.projectRecord },
    )
    .collect<[Array<RecordId<"feature", string>>]>();

  for (const record of featureRows) {
    addRecord(record as GraphEntityRecord);
  }

  // Tasks/decisions/questions via belongs_to WHERE out = project
  const [belongsToRows] = await input.surreal
    .query<[Array<RecordId<"task" | "decision" | "question", string>>]>(
      "SELECT VALUE `in` FROM belongs_to WHERE out = $project;",
      { project: input.projectRecord },
    )
    .collect<[Array<RecordId<"task" | "decision" | "question", string>>]>();

  for (const record of belongsToRows) {
    addRecord(record as GraphEntityRecord);
  }

  // Tasks via features' has_task + decisions/questions that belong_to features
  if (featureRows.length > 0) {
    const [featureTaskRows] = await input.surreal
      .query<[Array<RecordId<"task", string>>]>(
        "SELECT VALUE out FROM has_task WHERE `in` IN $features;",
        { features: featureRows },
      )
      .collect<[Array<RecordId<"task", string>>]>();

    for (const record of featureTaskRows) {
      addRecord(record as GraphEntityRecord);
    }

    const [featureBelongsRows] = await input.surreal
      .query<[Array<RecordId<"task" | "decision" | "question", string>>]>(
        "SELECT VALUE `in` FROM belongs_to WHERE out IN $features;",
        { features: featureRows },
      )
      .collect<[Array<RecordId<"task" | "decision" | "question", string>>]>();

    for (const record of featureBelongsRows) {
      addRecord(record as GraphEntityRecord);
    }
  }

  // Entities extracted from workspace messages (catches decisions/questions/tasks without belongs_to edges)
  const [provenanceRows] = await input.surreal
    .query<[Array<GraphEntityRecord>]>(
      [
        "SELECT VALUE out FROM extraction_relation",
        "WHERE `in` IN (SELECT VALUE id FROM message WHERE conversation IN (SELECT VALUE id FROM conversation WHERE workspace = $workspace));",
      ].join(" "),
      { workspace: input.workspaceRecord },
    )
    .collect<[Array<GraphEntityRecord>]>();

  for (const record of provenanceRows) {
    const table = record.table.name;
    if (table === "task" || table === "decision" || table === "question" || table === "feature" || table === "person") {
      addRecord(record as GraphEntityRecord);
    }
  }

  // Persons via member_of WHERE out = workspace
  const [personRows] = await input.surreal
    .query<[Array<RecordId<"person", string>>]>(
      "SELECT VALUE `in` FROM member_of WHERE out = $workspace;",
      { workspace: input.workspaceRecord },
    )
    .collect<[Array<RecordId<"person", string>>]>();

  for (const record of personRows) {
    addRecord(record as GraphEntityRecord);
  }

  const entities = await resolveEntityNames(input.surreal, allRecords);
  const edges = await collectEntityRelationEdges(input.surreal, allRecords);

  return { entities, edges };
}

export async function getFocusedGraphView(input: {
  surreal: Surreal;
  workspaceRecord: RecordId<"workspace", string>;
  centerEntityRecord: GraphEntityRecord;
  depth: number;
}): Promise<GraphViewRawResult> {
  const clampedDepth = Math.max(1, Math.min(3, input.depth));

  const scoped = await isEntityInWorkspace(input.surreal, input.workspaceRecord, input.centerEntityRecord);
  if (!scoped) {
    throw new Error("entity is outside the current workspace scope");
  }

  const collected = new Map<string, GraphEntityRecord>();
  collected.set(toRecordIdString(input.centerEntityRecord), input.centerEntityRecord);

  let frontier: RecordId<string, string>[] = [input.centerEntityRecord];

  for (let hop = 0; hop < clampedDepth; hop++) {
    if (frontier.length === 0) {
      break;
    }

    const [rows] = await input.surreal
      .query<[EntityRelationRow[]]>(
        [
          "SELECT id, `in`, out, kind, confidence",
          "FROM entity_relation",
          "WHERE `in` IN $currentIds OR out IN $currentIds;",
        ].join(" "),
        { currentIds: frontier },
      )
      .collect<[EntityRelationRow[]]>();

    const nextFrontier: RecordId<string, string>[] = [];

    for (const row of rows) {
      for (const endpoint of [row.in, row.out]) {
        const key = toRecordIdString(endpoint);
        if (collected.has(key)) {
          continue;
        }

        const inScope = await isEntityInWorkspace(input.surreal, input.workspaceRecord, endpoint);
        if (!inScope) {
          continue;
        }

        collected.set(key, endpoint);
        nextFrontier.push(endpoint);
      }
    }

    frontier = nextFrontier;
  }

  const allRecords = Array.from(collected.values());
  const entities = await resolveEntityNames(input.surreal, allRecords);
  const edges = await collectEntityRelationEdges(input.surreal, allRecords);

  return { entities, edges };
}

export async function getWorkspaceGraphOverview(input: {
  surreal: Surreal;
  workspaceRecord: RecordId<"workspace", string>;
}): Promise<GraphViewRawResult> {
  // Projects via has_project
  const [projectRows] = await input.surreal
    .query<[Array<RecordId<"project", string>>]>(
      "SELECT VALUE out FROM has_project WHERE `in` = $workspace;",
      { workspace: input.workspaceRecord },
    )
    .collect<[Array<RecordId<"project", string>>]>();

  const allRecords: GraphEntityRecord[] = [];

  for (const record of projectRows) {
    allRecords.push(record as GraphEntityRecord);
  }

  // Features via has_feature for each project
  if (projectRows.length > 0) {
    const [featureRows] = await input.surreal
      .query<[Array<RecordId<"feature", string>>]>(
        "SELECT VALUE out FROM has_feature WHERE `in` IN $projects;",
        { projects: projectRows },
      )
      .collect<[Array<RecordId<"feature", string>>]>();

    for (const record of featureRows) {
      allRecords.push(record as GraphEntityRecord);
    }
  }

  const entities = await resolveEntityNames(input.surreal, allRecords);
  const edges = await collectEntityRelationEdges(input.surreal, allRecords);

  return { entities, edges };
}
