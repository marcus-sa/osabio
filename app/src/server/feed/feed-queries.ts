import { RecordId, type Surreal } from "surrealdb";
import type { GovernanceFeedAction, GovernanceFeedItem } from "../../shared/contracts";

// --- Shared types ---

type WorkspaceQueryInput = {
  surreal: Surreal;
  workspaceRecord: RecordId<"workspace", string>;
  limit: number;
};

type ProjectRow = { id: RecordId<"project", string>; name: string };

// --- Internal helpers ---

function toRecordIdString(record: RecordId<string, string>): string {
  return record.id as string;
}

function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

async function getWorkspaceProjectRows(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
): Promise<ProjectRow[]> {
  const [rows] = await surreal
    .query<[ProjectRow[]]>(
      "SELECT id, name FROM project WHERE id IN (SELECT VALUE out FROM has_project WHERE `in` = $workspace);",
      { workspace: workspaceRecord },
    )
    .collect<[ProjectRow[]]>();

  return rows;
}

const WORKSPACE_SCOPE_CLAUSE = "workspace = $workspace";

// --- Project context (shared setup for project-scoped queries) ---

type ProjectContext = {
  projectRecords: RecordId<"project", string>[];
  projectNameById: Map<string, string>;
};

async function loadProjectContext(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
): Promise<ProjectContext> {
  const projects = await getWorkspaceProjectRows(surreal, workspaceRecord);
  return {
    projectRecords: projects.map((p) => p.id),
    projectNameById: new Map(projects.map((p) => [toRecordIdString(p.id), p.name])),
  };
}

async function resolveProjectName(
  surreal: Surreal,
  entityRecord: RecordId<string, string>,
  ctx: ProjectContext,
  relation: "belongs_to" | "has_feature" = "belongs_to",
): Promise<string | undefined> {
  if (relation === "has_feature") {
    const [projRows] = await surreal
      .query<[Array<RecordId<"project", string>>]>(
        "SELECT VALUE `in` FROM has_feature WHERE out = $entity AND `in` IN $projects LIMIT 1;",
        { entity: entityRecord, projects: ctx.projectRecords },
      )
      .collect<[Array<RecordId<"project", string>>]>();
    return projRows[0] ? ctx.projectNameById.get(toRecordIdString(projRows[0])) : undefined;
  }

  const [projRows] = await surreal
    .query<[Array<RecordId<"project", string>>]>(
      "SELECT VALUE out FROM belongs_to WHERE `in` = $entity AND out IN $projects LIMIT 1;",
      { entity: entityRecord, projects: ctx.projectRecords },
    )
    .collect<[Array<RecordId<"project", string>>]>();
  return projRows[0] ? ctx.projectNameById.get(toRecordIdString(projRows[0])) : undefined;
}

// --- Blocking tier ---

export type ProvisionalDecisionRow = {
  id: RecordId<"decision", string>;
  summary: string;
  status: string;
  priority?: string;
  category?: string;
  created_at: string | Date;
  project?: string; // resolved after query
};

export async function listProvisionalDecisions(
  input: WorkspaceQueryInput,
): Promise<ProvisionalDecisionRow[]> {
  const ctx = await loadProjectContext(input.surreal, input.workspaceRecord);

  const [rows] = await input.surreal
    .query<[
      Array<{
        id: RecordId<"decision", string>;
        summary: string;
        status: string;
        priority?: string;
        category?: string;
        created_at: string | Date;
      }>,
    ]>(
      [
        "SELECT id, summary, status, priority, category, created_at",
        "FROM decision",
        "WHERE status IN ['provisional', 'proposed', 'extracted']",
        `AND ${WORKSPACE_SCOPE_CLAUSE}`,
        "ORDER BY created_at DESC",
        "LIMIT $limit;",
      ].join(" "),
      {
        workspace: input.workspaceRecord,
        projects: ctx.projectRecords,
        limit: input.limit,
      },
    )
    .collect<[
      Array<{
        id: RecordId<"decision", string>;
        summary: string;
        status: string;
        priority?: string;
        category?: string;
        created_at: string | Date;
      }>,
    ]>();

  const results: ProvisionalDecisionRow[] = [];

  for (const row of rows) {
    const project = await resolveProjectName(input.surreal, row.id, ctx);
    results.push({
      id: row.id,
      summary: row.summary,
      status: row.status,
      ...(row.priority ? { priority: row.priority } : {}),
      ...(row.category ? { category: row.category } : {}),
      created_at: row.created_at,
      ...(project ? { project } : {}),
    });
  }

  return results;
}

export type ConflictRow = {
  edgeId: string;
  fromRecord: RecordId<"decision" | "feature", string>;
  fromName: string;
  fromKind: "decision" | "feature";
  toRecord: RecordId<"decision" | "feature", string>;
  toName: string;
  toKind: "decision" | "feature";
  description?: string;
  severity?: string;
  detectedAt: string;
};

export async function listWorkspaceConflicts(input: WorkspaceQueryInput): Promise<ConflictRow[]> {
  const [rows] = await input.surreal
    .query<[
      Array<{
        id: RecordId<"conflicts_with", string>;
        in: RecordId<"decision" | "feature", string>;
        out: RecordId<"decision" | "feature", string>;
        description?: string;
        severity?: string;
        detected_at?: string | Date;
      }>,
    ]>(
      [
        "SELECT id, `in`, out, description, severity, detected_at",
        "FROM conflicts_with",
        "WHERE `in` IN (SELECT VALUE id FROM decision WHERE workspace = $workspace)",
        "OR `in` IN (SELECT VALUE id FROM feature WHERE workspace = $workspace)",
        "OR out IN (SELECT VALUE id FROM decision WHERE workspace = $workspace)",
        "OR out IN (SELECT VALUE id FROM feature WHERE workspace = $workspace)",
        "ORDER BY detected_at DESC",
        "LIMIT $limit;",
      ].join(" "),
      { workspace: input.workspaceRecord, limit: input.limit },
    )
    .collect<[
      Array<{
        id: RecordId<"conflicts_with", string>;
        in: RecordId<"decision" | "feature", string>;
        out: RecordId<"decision" | "feature", string>;
        description?: string;
        severity?: string;
        detected_at?: string | Date;
      }>,
    ]>();

  const results: ConflictRow[] = [];

  for (const row of rows) {
    const fromKind = row.in.table.name as "decision" | "feature";
    const toKind = row.out.table.name as "decision" | "feature";

    const fromName = await readEntityNameByTable(input.surreal, row.in, fromKind);
    const toName = await readEntityNameByTable(input.surreal, row.out, toKind);

    if (!fromName || !toName) continue;

    results.push({
      edgeId: toRecordIdString(row.id),
      fromRecord: row.in,
      fromName,
      fromKind,
      toRecord: row.out,
      toName,
      toKind,
      ...(row.description ? { description: row.description } : {}),
      ...(row.severity ? { severity: row.severity } : {}),
      detectedAt: row.detected_at ? toIso(row.detected_at) : new Date().toISOString(),
    });
  }

  return results;
}

export type BlockingQuestionRow = {
  id: RecordId<"question", string>;
  text: string;
  status: string;
  priority: string;
  category?: string;
  created_at: string | Date;
  project?: string;
};

export async function listBlockingQuestions(
  input: WorkspaceQueryInput,
): Promise<BlockingQuestionRow[]> {
  const ctx = await loadProjectContext(input.surreal, input.workspaceRecord);

  const [rows] = await input.surreal
    .query<[
      Array<{
        id: RecordId<"question", string>;
        text: string;
        status: string;
        priority: string;
        category?: string;
        created_at: string | Date;
      }>,
    ]>(
      [
        "SELECT id, text, status, priority, category, created_at",
        "FROM question",
        "WHERE status = 'open'",
        "AND priority IN ['high', 'critical']",
        `AND ${WORKSPACE_SCOPE_CLAUSE}`,
        "ORDER BY created_at DESC",
        "LIMIT $limit;",
      ].join(" "),
      {
        workspace: input.workspaceRecord,
        projects: ctx.projectRecords,
        limit: input.limit,
      },
    )
    .collect<[
      Array<{
        id: RecordId<"question", string>;
        text: string;
        status: string;
        priority: string;
        category?: string;
        created_at: string | Date;
      }>,
    ]>();

  const results: BlockingQuestionRow[] = [];

  for (const row of rows) {
    const project = await resolveProjectName(input.surreal, row.id, ctx);
    results.push({
      id: row.id,
      text: row.text,
      status: row.status,
      priority: row.priority,
      ...(row.category ? { category: row.category } : {}),
      created_at: row.created_at,
      ...(project ? { project } : {}),
    });
  }

  return results;
}

// --- Review tier ---

export type LowConfidenceDecisionRow = {
  id: RecordId<"decision", string>;
  summary: string;
  status: string;
  extraction_confidence: number;
  category?: string;
  priority?: string;
  created_at: string | Date;
  project?: string;
};

export async function listLowConfidenceDecisions(
  input: WorkspaceQueryInput & { confidenceThreshold: number },
): Promise<LowConfidenceDecisionRow[]> {
  const ctx = await loadProjectContext(input.surreal, input.workspaceRecord);

  const [rows] = await input.surreal
    .query<[
      Array<{
        id: RecordId<"decision", string>;
        summary: string;
        status: string;
        extraction_confidence: number;
        category?: string;
        priority?: string;
        created_at: string | Date;
      }>,
    ]>(
      [
        "SELECT id, summary, status, extraction_confidence, category, priority, created_at",
        "FROM decision",
        "WHERE status = 'inferred'",
        "AND extraction_confidence != NONE",
        "AND extraction_confidence < $threshold",
        `AND ${WORKSPACE_SCOPE_CLAUSE}`,
        "ORDER BY extraction_confidence ASC",
        "LIMIT $limit;",
      ].join(" "),
      {
        workspace: input.workspaceRecord,
        projects: ctx.projectRecords,
        threshold: input.confidenceThreshold,
        limit: input.limit,
      },
    )
    .collect<[
      Array<{
        id: RecordId<"decision", string>;
        summary: string;
        status: string;
        extraction_confidence: number;
        category?: string;
        priority?: string;
        created_at: string | Date;
      }>,
    ]>();

  const results: LowConfidenceDecisionRow[] = [];

  for (const row of rows) {
    const project = await resolveProjectName(input.surreal, row.id, ctx);
    results.push({
      id: row.id,
      summary: row.summary,
      status: row.status,
      extraction_confidence: row.extraction_confidence,
      ...(row.category ? { category: row.category } : {}),
      ...(row.priority ? { priority: row.priority } : {}),
      created_at: row.created_at,
      ...(project ? { project } : {}),
    });
  }

  return results;
}

export type BlockedTaskRow = {
  id: RecordId<"task", string>;
  title: string;
  status: string;
  priority?: string;
  category?: string;
  created_at: string | Date;
  project?: string;
};

export async function listBlockedTasks(input: WorkspaceQueryInput): Promise<BlockedTaskRow[]> {
  const ctx = await loadProjectContext(input.surreal, input.workspaceRecord);

  const [rows] = await input.surreal
    .query<[
      Array<{
        id: RecordId<"task", string>;
        title: string;
        status: string;
        priority?: string;
        category?: string;
        created_at: string | Date;
      }>,
    ]>(
      [
        "SELECT id, title, status, priority, category, created_at",
        "FROM task",
        "WHERE status = 'blocked'",
        `AND ${WORKSPACE_SCOPE_CLAUSE}`,
        "ORDER BY created_at DESC",
        "LIMIT $limit;",
      ].join(" "),
      {
        workspace: input.workspaceRecord,
        projects: ctx.projectRecords,
        limit: input.limit,
      },
    )
    .collect<[
      Array<{
        id: RecordId<"task", string>;
        title: string;
        status: string;
        priority?: string;
        category?: string;
        created_at: string | Date;
      }>,
    ]>();

  const results: BlockedTaskRow[] = [];

  for (const row of rows) {
    const project = await resolveProjectName(input.surreal, row.id, ctx);
    results.push({
      id: row.id,
      title: row.title,
      status: row.status,
      ...(row.priority ? { priority: row.priority } : {}),
      ...(row.category ? { category: row.category } : {}),
      created_at: row.created_at,
      ...(project ? { project } : {}),
    });
  }

  return results;
}

// --- Awareness tier ---

export type StaleTaskRow = {
  id: RecordId<"task", string>;
  title: string;
  status: string;
  priority?: string;
  category?: string;
  created_at: string | Date;
  updated_at?: string | Date;
  project?: string;
};

export async function listStaleTasks(
  input: WorkspaceQueryInput & { staleDays: number },
): Promise<StaleTaskRow[]> {
  const ctx = await loadProjectContext(input.surreal, input.workspaceRecord);
  const cutoff = new Date(Date.now() - input.staleDays * 24 * 60 * 60 * 1000);

  const [rows] = await input.surreal
    .query<[
      Array<{
        id: RecordId<"task", string>;
        title: string;
        status: string;
        priority?: string;
        category?: string;
        created_at: string | Date;
        updated_at?: string | Date;
      }>,
    ]>(
      [
        "SELECT id, title, status, priority, category, created_at, updated_at",
        "FROM task",
        "WHERE status NOT IN ['done', 'completed', 'blocked']",
        "AND created_at < $cutoff",
        `AND ${WORKSPACE_SCOPE_CLAUSE}`,
        "ORDER BY created_at ASC",
        "LIMIT $limit;",
      ].join(" "),
      {
        workspace: input.workspaceRecord,
        projects: ctx.projectRecords,
        cutoff,
        limit: input.limit,
      },
    )
    .collect<[
      Array<{
        id: RecordId<"task", string>;
        title: string;
        status: string;
        priority?: string;
        category?: string;
        created_at: string | Date;
        updated_at?: string | Date;
      }>,
    ]>();

  const results: StaleTaskRow[] = [];

  for (const row of rows) {
    const project = await resolveProjectName(input.surreal, row.id, ctx);
    results.push({
      id: row.id,
      title: row.title,
      status: row.status,
      ...(row.priority ? { priority: row.priority } : {}),
      ...(row.category ? { category: row.category } : {}),
      created_at: row.created_at,
      ...(row.updated_at ? { updated_at: row.updated_at } : {}),
      ...(project ? { project } : {}),
    });
  }

  return results;
}

export type RecentlyCompletedRow = {
  id: RecordId<"task" | "feature", string>;
  kind: "task" | "feature";
  name: string;
  status: string;
  category?: string;
  updated_at: string | Date;
  project?: string;
};

export async function listRecentlyCompletedItems(
  input: WorkspaceQueryInput & { recentDays: number },
): Promise<RecentlyCompletedRow[]> {
  const ctx = await loadProjectContext(input.surreal, input.workspaceRecord);
  const cutoff = new Date(Date.now() - input.recentDays * 24 * 60 * 60 * 1000);

  // Completed tasks
  const [taskRows] = await input.surreal
    .query<[
      Array<{
        id: RecordId<"task", string>;
        title: string;
        status: string;
        category?: string;
        updated_at: string | Date;
      }>,
    ]>(
      [
        "SELECT id, title, status, category, updated_at",
        "FROM task",
        "WHERE status IN ['done', 'completed']",
        "AND updated_at != NONE AND updated_at > $cutoff",
        `AND ${WORKSPACE_SCOPE_CLAUSE}`,
        "ORDER BY updated_at DESC",
        "LIMIT $limit;",
      ].join(" "),
      {
        workspace: input.workspaceRecord,
        projects: ctx.projectRecords,
        cutoff,
        limit: input.limit,
      },
    )
    .collect<[
      Array<{
        id: RecordId<"task", string>;
        title: string;
        status: string;
        category?: string;
        updated_at: string | Date;
      }>,
    ]>();

  // Completed features
  const [featureRows] = await input.surreal
    .query<[
      Array<{
        id: RecordId<"feature", string>;
        name: string;
        status: string;
        category?: string;
        updated_at: string | Date;
      }>,
    ]>(
      [
        "SELECT id, name, status, updated_at",
        "FROM feature",
        "WHERE status = 'done'",
        "AND updated_at != NONE AND updated_at > $cutoff",
        "AND id IN (",
        "  SELECT VALUE out FROM has_feature",
        "  WHERE `in` IN (SELECT VALUE out FROM has_project WHERE `in` = $workspace)",
        ")",
        "ORDER BY updated_at DESC",
        "LIMIT $limit;",
      ].join(" "),
      {
        workspace: input.workspaceRecord,
        cutoff,
        limit: input.limit,
      },
    )
    .collect<[
      Array<{
        id: RecordId<"feature", string>;
        name: string;
        status: string;
        category?: string;
        updated_at: string | Date;
      }>,
    ]>();

  const results: RecentlyCompletedRow[] = [];

  for (const row of taskRows) {
    const project = await resolveProjectName(input.surreal, row.id, ctx);
    results.push({
      id: row.id,
      kind: "task",
      name: row.title,
      status: row.status,
      ...(row.category ? { category: row.category } : {}),
      updated_at: row.updated_at,
      ...(project ? { project } : {}),
    });
  }

  for (const row of featureRows) {
    const project = await resolveProjectName(input.surreal, row.id, ctx, "has_feature");
    results.push({
      id: row.id,
      kind: "feature",
      name: row.name,
      status: row.status,
      ...(row.category ? { category: row.category } : {}),
      updated_at: row.updated_at,
      ...(project ? { project } : {}),
    });
  }

  // Sort by updated_at descending
  results.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());

  return results.slice(0, input.limit);
}

export type RecentExtractionRow = {
  edgeId: string;
  sourceKind: "message" | "document_chunk" | "git_commit";
  sourceId: string;
  entityId: string;
  entityKind: string;
  entityName: string;
  confidence: number;
  extractedAt: string;
};

export async function listRecentExtractions(input: WorkspaceQueryInput & { cutoff: Date }): Promise<RecentExtractionRow[]> {
  const [rows] = await input.surreal
    .query<[
      Array<{
        id: RecordId<"extraction_relation", string>;
        in: RecordId<"message" | "document_chunk" | "git_commit", string>;
        out: RecordId<string, string>;
        confidence: number;
        extracted_at: string | Date;
      }>,
    ]>(
      [
        "SELECT id, `in`, out, confidence, extracted_at",
        "FROM extraction_relation",
        "WHERE extracted_at > $cutoff",
        "AND (",
        "  `in` IN (",
        "    SELECT VALUE id FROM message",
        "    WHERE conversation IN (SELECT VALUE id FROM conversation WHERE workspace = $workspace)",
        "  )",
        "  OR `in` IN (SELECT VALUE id FROM document_chunk WHERE workspace = $workspace)",
        "  OR `in` IN (SELECT VALUE id FROM git_commit WHERE workspace = $workspace)",
        ")",
        "ORDER BY extracted_at DESC",
        "LIMIT $limit;",
      ].join(" "),
      { workspace: input.workspaceRecord, limit: input.limit, cutoff: input.cutoff },
    )
    .collect<[
      Array<{
        id: RecordId<"extraction_relation", string>;
        in: RecordId<"message" | "document_chunk" | "git_commit", string>;
        out: RecordId<string, string>;
        confidence: number;
        extracted_at: string | Date;
      }>,
    ]>();

  const results: RecentExtractionRow[] = [];

  for (const row of rows) {
    const entityKind = row.out.table.name;
    const entityName = await readEntityNameByTable(input.surreal, row.out, entityKind);
    if (!entityName) continue;

    const sourceKind = row.in.table.name === "document_chunk"
      ? "document_chunk"
      : row.in.table.name === "git_commit"
        ? "git_commit"
        : "message";

    results.push({
      edgeId: toRecordIdString(row.id),
      sourceKind: sourceKind as "message" | "document_chunk" | "git_commit",
      sourceId: toRecordIdString(row.in),
      entityId: toRecordIdString(row.out),
      entityKind,
      entityName,
      confidence: row.confidence,
      extractedAt: toIso(row.extracted_at),
    });
  }

  return results;
}

// --- Agent attention sessions ---

export type AgentAttentionSessionRow = {
  id: RecordId<"agent_session", string>;
  orchestrator_status: "idle" | "error";
  task_id?: RecordId<"task", string>;
  task_title?: string;
  error_message?: string;
  started_at: string | Date;
};

export async function listAgentAttentionSessions(
  input: WorkspaceQueryInput,
): Promise<AgentAttentionSessionRow[]> {
  const [rows] = await input.surreal
    .query<[
      Array<{
        id: RecordId<"agent_session", string>;
        orchestrator_status: string;
        task_id?: RecordId<"task", string>;
        error_message?: string;
        started_at: string | Date;
      }>,
    ]>(
      [
        "SELECT id, orchestrator_status, task_id, error_message, started_at",
        "FROM agent_session",
        "WHERE orchestrator_status IN ['idle', 'error']",
        "AND workspace = $workspace",
        "ORDER BY started_at DESC",
        "LIMIT $limit;",
      ].join(" "),
      { workspace: input.workspaceRecord, limit: input.limit },
    )
    .collect<[
      Array<{
        id: RecordId<"agent_session", string>;
        orchestrator_status: string;
        task_id?: RecordId<"task", string>;
        error_message?: string;
        started_at: string | Date;
      }>,
    ]>();

  const results: AgentAttentionSessionRow[] = [];

  for (const row of rows) {
    let taskTitle: string | undefined;
    if (row.task_id) {
      const taskRow = await input.surreal.select<{ title: string }>(row.task_id);
      taskTitle = taskRow?.title;
    }

    results.push({
      id: row.id,
      orchestrator_status: row.orchestrator_status as "idle" | "error",
      ...(row.task_id ? { task_id: row.task_id } : {}),
      ...(taskTitle ? { task_title: taskTitle } : {}),
      ...(row.error_message ? { error_message: row.error_message } : {}),
      started_at: row.started_at,
    });
  }

  return results;
}

export function mapAgentSessionToFeedItem(row: AgentAttentionSessionRow): GovernanceFeedItem {
  const rawId = row.id.id as string;
  const entityId = `agent_session:${rawId}`;
  const entityName = row.task_title ?? `Agent session ${rawId}`;

  const isError = row.orchestrator_status === "error";
  const tier = isError ? "blocking" : "review";

  const reason = isError
    ? `Agent error${row.error_message ? `: ${row.error_message}` : ""}`
    : `Agent completed work on '${entityName}' -- review ready`;

  const actions: GovernanceFeedAction[] = isError
    ? [{ action: "discuss", label: "Discuss" }, { action: "abort", label: "Abort" }]
    : [{ action: "review", label: "Review" }, { action: "abort", label: "Abort" }];

  return {
    id: `${entityId}:${row.orchestrator_status}`,
    tier,
    entityId,
    entityKind: "agent_session",
    entityName,
    reason,
    status: row.orchestrator_status,
    createdAt: row.started_at instanceof Date ? row.started_at.toISOString() : new Date(row.started_at).toISOString(),
    actions,
  };
}

// --- Intent governance (pending veto intents for human review) ---

export type PendingIntentRow = {
  id: RecordId<"intent", string>;
  goal: string;
  status: string;
  priority: number;
  risk_score?: number;
  reason?: string;
  veto_expires_at?: string | Date;
  created_at: string | Date;
};

export async function listPendingVetoIntents(
  input: WorkspaceQueryInput,
): Promise<PendingIntentRow[]> {
  const [rows] = await input.surreal
    .query<[
      Array<{
        id: RecordId<"intent", string>;
        goal: string;
        status: string;
        priority: number;
        evaluation?: { risk_score: number; reason: string };
        veto_expires_at?: string | Date;
        created_at: string | Date;
      }>,
    ]>(
      [
        "SELECT id, goal, status, priority, evaluation, veto_expires_at, created_at",
        "FROM intent",
        "WHERE status = 'pending_veto'",
        `AND ${WORKSPACE_SCOPE_CLAUSE}`,
        "ORDER BY priority DESC, created_at ASC",
        "LIMIT $limit;",
      ].join(" "),
      { workspace: input.workspaceRecord, limit: input.limit },
    )
    .collect<[
      Array<{
        id: RecordId<"intent", string>;
        goal: string;
        status: string;
        priority: number;
        evaluation?: { risk_score: number; reason: string };
        veto_expires_at?: string | Date;
        created_at: string | Date;
      }>,
    ]>();

  return rows.map((row) => ({
    id: row.id,
    goal: row.goal,
    status: row.status,
    priority: row.priority,
    ...(row.evaluation ? { risk_score: row.evaluation.risk_score, reason: row.evaluation.reason } : {}),
    ...(row.veto_expires_at ? { veto_expires_at: row.veto_expires_at } : {}),
    created_at: row.created_at,
  }));
}

export function mapPendingIntentToFeedItem(row: PendingIntentRow): GovernanceFeedItem {
  const rawId = row.id.id as string;
  const riskLabel = row.risk_score !== undefined ? ` (risk ${row.risk_score})` : "";

  return {
    id: `intent:${rawId}:pending_veto`,
    tier: "blocking",
    entityId: `intent:${rawId}`,
    entityKind: "intent",
    entityName: row.goal,
    reason: `Intent awaiting human review${riskLabel}`,
    status: row.status,
    priority: row.priority > 50 ? "high" : "medium",
    createdAt: toIso(row.created_at),
    actions: intentActions(),
  };
}

function intentActions(): GovernanceFeedAction[] {
  return [
    { action: "confirm", label: "Approve" },
    { action: "override", label: "Veto" },
    { action: "discuss", label: "Discuss" },
  ];
}

// --- Shared helper ---

async function readEntityNameByTable(
  surreal: Surreal,
  record: RecordId<string, string>,
  table: string,
): Promise<string | undefined> {
  if (table === "workspace" || table === "project" || table === "person" || table === "feature") {
    const row = await surreal.select<{ name: string }>(record);
    return row?.name;
  }

  if (table === "task") {
    const row = await surreal.select<{ title: string }>(record);
    return row?.title;
  }

  if (table === "decision") {
    const row = await surreal.select<{ summary: string }>(record);
    return row?.summary;
  }

  if (table === "question") {
    const row = await surreal.select<{ text: string }>(record);
    return row?.text;
  }

  return undefined;
}
