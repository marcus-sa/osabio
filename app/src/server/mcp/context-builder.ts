import { RecordId, type Surreal } from "surrealdb";
import type {
  ContextPacket,
  DecisionContext,
  TaskContext,
  QuestionContext,
  ObservationContext,
  SuggestionContext,
  ActiveSessionContext,
  TaskScopeContext,
  RecentChangeContext,
  WorkspaceOverview,
  TaskContextPacket,
  HotItems,
} from "./types";
import { toRawId } from "./id-format";

// ---------------------------------------------------------------------------
// Row types (private)
// ---------------------------------------------------------------------------

type ProjectRow = {
  id: RecordId<"project", string>;
  name: string;
  status: string;
  description?: string;
};

type DecisionRow = {
  id: RecordId<"decision", string>;
  summary: string;
  status: string;
  rationale?: string;
  decided_at?: Date | string;
  category?: string;
  priority?: string;
};

type TaskRow = {
  id: RecordId<"task", string>;
  title: string;
  status: string;
  priority?: string;
  category?: string;
  description?: string;
  source_session?: RecordId<"agent_session", string>;
};

type QuestionRow = {
  id: RecordId<"question", string>;
  text: string;
  status: string;
  context?: string;
  priority?: string;
};

type ObservationRow = {
  id: RecordId<"observation", string>;
  text: string;
  severity: string;
  status: string;
  category?: string;
  observation_type?: string;
};

type SuggestionRow = {
  id: RecordId<"suggestion", string>;
  text: string;
  category: string;
  rationale: string;
  confidence: number;
  status: string;
  suggested_by: string;
  created_at: Date | string;
};

type AgentSessionRow = {
  id: RecordId<"agent_session", string>;
  agent: string;
  ended_at?: Date | string;
  summary?: string;
};

type SubtaskRow = {
  id: RecordId<"task", string>;
  title: string;
  status: string;
};

type FeatureRow = {
  id: RecordId<"feature", string>;
  name: string;
  description?: string;
};

type DependencyRow = {
  id: RecordId<"task", string>;
  title: string;
  status: string;
};

type ActiveAgentSessionRow = {
  id: RecordId<"agent_session", string>;
  agent: string;
  started_at: Date | string;
  task_id?: RecordId<"task", string>;
};

type SessionObservationRow = {
  id: RecordId<"observation", string>;
  text: string;
  severity: string;
  source_session: RecordId<"agent_session", string>;
};

type EntityCountRow = {
  project_id: RecordId<"project", string>;
  entity_type: string;
  count: number;
};

type FeatureCountRow = {
  project_id: RecordId<"project", string>;
  count: number;
};

type ContestedDecisionRow = {
  id: RecordId<"decision", string>;
  summary: string;
};

type HotObservationRow = {
  id: RecordId<"observation", string>;
  text: string;
  severity: string;
  category?: string;
};

type HotSuggestionRow = {
  id: RecordId<"suggestion", string>;
  text: string;
  category: string;
  confidence: number;
};

type RecentChangeRow = {
  entity_type: string;
  entity_name: string;
  change_type: string;
  changed_at: Date | string;
};

function toIso(value: Date | string | undefined): string {
  if (!value) return "";
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

// ===========================================================================
// 1. Workspace Overview (lightweight orientation, no params)
// ===========================================================================

/** Build a lightweight workspace overview for agent orientation */
export async function buildWorkspaceOverview(input: {
  surreal: Surreal;
  workspaceRecord: RecordId<"workspace", string>;
  workspaceName: string;
  excludeSessionId?: string;
}): Promise<WorkspaceOverview> {
  const { surreal, workspaceRecord, workspaceName } = input;

  const overviewQuery = `
    SELECT id, name, status, description
    FROM project
    WHERE id IN (SELECT VALUE out FROM has_project WHERE \`in\` = $workspace);

    SELECT out AS project_id, record::tb(\`in\`) AS entity_type, count() AS count
    FROM belongs_to
    WHERE out IN (SELECT VALUE out FROM has_project WHERE \`in\` = $workspace)
    GROUP BY project_id, entity_type;

    SELECT \`in\` AS project_id, count() AS count
    FROM has_feature
    WHERE \`in\` IN (SELECT VALUE out FROM has_project WHERE \`in\` = $workspace)
    GROUP BY project_id;
  `;

  const [projectRows, entityCounts, featureCounts] = await surreal
    .query<[ProjectRow[], EntityCountRow[], FeatureCountRow[]]>(overviewQuery, {
      workspace: workspaceRecord,
    })
    .collect<[ProjectRow[], EntityCountRow[], FeatureCountRow[]]>();

  const countsByProject = buildProjectCountMaps(entityCounts, featureCounts);
  const hotItems = await loadHotItems(surreal, workspaceRecord);
  const activeSessions = await loadActiveSessions(surreal, workspaceRecord, undefined, input.excludeSessionId);

  return {
    workspace: { id: workspaceRecord.id as string, name: workspaceName },
    projects: projectRows.map((p) => ({
      id: toRawId(p.id),
      name: p.name,
      status: p.status,
      ...(p.description ? { description: p.description } : {}),
      counts: countsByProject.get(toRawId(p.id)) ?? { tasks: 0, decisions: 0, features: 0, questions: 0 },
    })),
    hot_items: hotItems,
    active_sessions: activeSessions,
  };
}

function buildProjectCountMaps(
  entityCounts: EntityCountRow[],
  featureCounts: FeatureCountRow[],
): Map<string, { tasks: number; decisions: number; features: number; questions: number }> {
  const map = new Map<string, { tasks: number; decisions: number; features: number; questions: number }>();

  for (const row of entityCounts) {
    const pid = toRawId(row.project_id);
    const entry = map.get(pid) ?? { tasks: 0, decisions: 0, features: 0, questions: 0 };
    if (row.entity_type === "task") entry.tasks = row.count;
    else if (row.entity_type === "decision") entry.decisions = row.count;
    else if (row.entity_type === "question") entry.questions = row.count;
    map.set(pid, entry);
  }

  for (const row of featureCounts) {
    const pid = toRawId(row.project_id);
    const entry = map.get(pid) ?? { tasks: 0, decisions: 0, features: 0, questions: 0 };
    entry.features = row.count;
    map.set(pid, entry);
  }

  return map;
}

// ===========================================================================
// 2. Project Context (full project context, project_id required)
// ===========================================================================

/** Build a full project context packet (decisions, tasks, questions, observations, suggestions) */
export async function buildProjectContext(input: {
  surreal: Surreal;
  workspaceRecord: RecordId<"workspace", string>;
  workspaceName: string;
  projectRecord: RecordId<"project", string>;
  taskId?: string;
  since?: string;
  excludeSessionId?: string;
}): Promise<ContextPacket> {
  const { surreal, workspaceRecord, workspaceName, projectRecord, taskId } = input;

  const project = await surreal.select<ProjectRow>(projectRecord);
  if (!project) {
    throw new Error(`project not found: ${projectRecord.id}`);
  }

  const projectEntitiesQuery = `
    LET $project_entity_ids = SELECT VALUE \`in\` FROM belongs_to WHERE out = $project;

    SELECT id, summary, status, rationale, decided_at, category, priority
    FROM decision
    WHERE workspace = $workspace AND id IN $project_entity_ids
    ORDER BY created_at DESC LIMIT 50;

    SELECT id, title, status, priority, category, description, source_session
    FROM task
    WHERE workspace = $workspace AND id IN $project_entity_ids
    ORDER BY created_at DESC LIMIT 50;

    SELECT id, text, status, context, priority
    FROM question
    WHERE workspace = $workspace AND id IN $project_entity_ids
    ORDER BY created_at DESC LIMIT 30;

    SELECT id, text, severity, status, category, observation_type
    FROM observation
    WHERE workspace = $workspace AND status IN ["open", "acknowledged"]
    ORDER BY created_at DESC LIMIT 20;

    SELECT id, text, category, rationale, confidence, status, suggested_by, created_at
    FROM suggestion
    WHERE workspace = $workspace AND status IN ["pending", "deferred"]
    ORDER BY confidence DESC, created_at DESC LIMIT 15;
  `;

  const results = await surreal
    .query<[null, DecisionRow[], TaskRow[], QuestionRow[], ObservationRow[], SuggestionRow[]]>(projectEntitiesQuery, {
      project: projectRecord,
      workspace: workspaceRecord,
    })
    .collect<[null, DecisionRow[], TaskRow[], QuestionRow[], ObservationRow[], SuggestionRow[]]>();

  const [, decisionRows, taskRows, questionRows, observationRows, suggestionRows] = results;

  // Categorize decisions by status
  const confirmed: DecisionContext[] = [];
  const provisional: DecisionContext[] = [];
  const contested: DecisionContext[] = [];

  for (const d of decisionRows) {
    const ctx: DecisionContext = {
      id: toRawId(d.id),
      summary: d.summary,
      status: d.status,
      ...(d.rationale ? { rationale: d.rationale } : {}),
      ...(d.decided_at ? { decided_at: toIso(d.decided_at) } : {}),
      ...(d.category ? { category: d.category } : {}),
      ...(d.priority ? { priority: d.priority } : {}),
    };

    if (d.status === "contested") {
      contested.push(ctx);
    } else if (d.status === "provisional" || d.status === "inferred") {
      provisional.push(ctx);
    } else if (d.status === "confirmed") {
      confirmed.push(ctx);
    }
  }

  const activeTasks: TaskContext[] = taskRows
    .filter((t) => t.status !== "done" && t.status !== "completed")
    .map((t) => ({
      id: toRawId(t.id),
      title: t.title,
      status: t.status,
      ...(t.priority ? { priority: t.priority } : {}),
      ...(t.category ? { category: t.category } : {}),
      ...(t.source_session ? { source_session: toRawId(t.source_session) } : {}),
    }));

  const openQuestions: QuestionContext[] = questionRows
    .filter((q) => q.status !== "answered" && q.status !== "resolved")
    .map((q) => ({
      id: toRawId(q.id),
      text: q.text,
      status: q.status,
      ...(q.context ? { context: q.context } : {}),
      ...(q.priority ? { priority: q.priority } : {}),
    }));

  const observations: ObservationContext[] = observationRows.map((o) => ({
    id: toRawId(o.id),
    text: o.text,
    severity: o.severity,
    status: o.status,
    ...(o.category ? { category: o.category } : {}),
    ...(o.observation_type ? { observation_type: o.observation_type } : {}),
  }));

  const pendingSuggestions: SuggestionContext[] = suggestionRows.map((s) => ({
    id: toRawId(s.id),
    text: s.text,
    category: s.category,
    rationale: s.rationale,
    confidence: s.confidence,
    status: s.status,
    suggested_by: s.suggested_by,
    created_at: toIso(s.created_at),
  }));

  const activeSessions = await loadActiveSessions(surreal, workspaceRecord, projectRecord, input.excludeSessionId);

  const recentChanges: RecentChangeContext[] = input.since
    ? await loadRecentChanges(surreal, workspaceRecord, projectRecord, input.since)
    : [];

  let taskScope: TaskScopeContext | undefined;
  if (taskId) {
    taskScope = await buildTaskScope(surreal, workspaceRecord, taskId);
  }

  return {
    workspace: { id: workspaceRecord.id as string, name: workspaceName },
    project: {
      id: projectRecord.id as string,
      name: project.name,
      status: project.status,
      ...(project.description ? { description: project.description } : {}),
    },
    ...(taskScope ? { task_scope: taskScope } : {}),
    decisions: { confirmed, provisional, contested },
    active_tasks: activeTasks,
    open_questions: openQuestions,
    recent_changes: recentChanges,
    observations,
    pending_suggestions: pendingSuggestions,
    active_sessions: activeSessions,
  };
}

// ===========================================================================
// 3. Task Context (task-focused, task_id required, project resolved from graph)
// ===========================================================================

/** Build task-focused context: task subgraph + project hot items */
export async function buildTaskContext(input: {
  surreal: Surreal;
  workspaceRecord: RecordId<"workspace", string>;
  workspaceName: string;
  taskId: string;
  excludeSessionId?: string;
}): Promise<TaskContextPacket> {
  const { surreal, workspaceRecord, workspaceName, taskId } = input;

  const taskRecord = new RecordId("task", taskId);
  const task = await surreal.select<TaskRow & { workspace: RecordId<"workspace", string> }>(taskRecord);
  if (!task) {
    throw new Error(`task not found: ${taskId}`);
  }
  if ((task.workspace.id as string) !== (workspaceRecord.id as string)) {
    throw new Error(`task not in workspace: ${taskId}`);
  }

  // Resolve project from belongs_to edge
  const [projectEdges] = await surreal
    .query<[Array<{ out: RecordId<"project", string> }>]>(
      `SELECT out FROM belongs_to WHERE \`in\` = $task AND record::tb(out) = "project" LIMIT 1;`,
      { task: taskRecord },
    )
    .collect<[Array<{ out: RecordId<"project", string> }>]>();

  let projectInfo: { id: string; name: string; status: string };
  let projectRecord: RecordId<"project", string> | undefined;

  if (projectEdges.length > 0) {
    projectRecord = projectEdges[0].out;
    const project = await surreal.select<ProjectRow>(projectRecord);
    if (project) {
      projectInfo = { id: toRawId(project.id), name: project.name, status: project.status };
    } else {
      projectInfo = { id: toRawId(projectRecord), name: "unknown", status: "unknown" };
    }
  } else {
    projectInfo = { id: "unassigned", name: "unassigned", status: "unknown" };
  }

  const taskScope = await buildTaskScope(surreal, workspaceRecord, taskId);
  const hotItems = await loadHotItems(surreal, workspaceRecord, projectRecord);
  const activeSessions = await loadActiveSessions(surreal, workspaceRecord, projectRecord, input.excludeSessionId);

  return {
    workspace: { id: workspaceRecord.id as string, name: workspaceName },
    project: projectInfo,
    task_scope: taskScope,
    hot_items: hotItems,
    active_sessions: activeSessions,
  };
}

// ===========================================================================
// Shared helpers
// ===========================================================================

/** Load hot items: contested decisions, open observations, pending suggestions */
async function loadHotItems(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
  projectRecord?: RecordId<"project", string>,
): Promise<HotItems> {
  // When project-scoped, filter decisions via belongs_to
  const decisionFilter = projectRecord
    ? `AND id IN (SELECT VALUE \`in\` FROM belongs_to WHERE out = $project)`
    : "";

  const hotQuery = `
    SELECT id, summary
    FROM decision
    WHERE workspace = $workspace AND status = "contested" ${decisionFilter}
    ORDER BY updated_at DESC LIMIT 10;

    SELECT id, text, severity, category
    FROM observation
    WHERE workspace = $workspace AND status IN ["open", "acknowledged"] AND severity IN ["warning", "conflict"]
    ORDER BY created_at DESC LIMIT 10;

    SELECT id, text, category, confidence
    FROM suggestion
    WHERE workspace = $workspace AND status = "pending"
    ORDER BY confidence DESC, created_at DESC LIMIT 5;
  `;

  const [contestedDecisions, hotObservations, hotSuggestions] = await surreal
    .query<[ContestedDecisionRow[], HotObservationRow[], HotSuggestionRow[]]>(hotQuery, {
      workspace: workspaceRecord,
      ...(projectRecord ? { project: projectRecord } : {}),
    })
    .collect<[ContestedDecisionRow[], HotObservationRow[], HotSuggestionRow[]]>();

  return {
    contested_decisions: contestedDecisions.map((d) => ({
      id: toRawId(d.id),
      summary: d.summary,
    })),
    open_observations: hotObservations.map((o) => ({
      id: toRawId(o.id),
      text: o.text,
      severity: o.severity,
      ...(o.category ? { category: o.category } : {}),
    })),
    pending_suggestions: hotSuggestions.map((s) => ({
      id: toRawId(s.id),
      text: s.text,
      category: s.category,
      confidence: s.confidence,
    })),
  };
}

/** Build task-scoped context: subtasks, parent feature, siblings, dependencies, related sessions */
async function buildTaskScope(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
  taskId: string,
): Promise<TaskScopeContext> {
  const taskRecord = new RecordId("task", taskId);
  const task = await surreal.select<TaskRow & { workspace: RecordId<"workspace", string> }>(taskRecord);
  if (!task) {
    throw new Error(`task not found: ${taskId}`);
  }
  if ((task.workspace.id as string) !== (workspaceRecord.id as string)) {
    throw new Error(`task not in workspace: ${taskId}`);
  }

  const taskScopeQuery = `
    SELECT id, title, status
    FROM task
    WHERE id IN (SELECT VALUE \`in\` FROM subtask_of WHERE out = $task)
    ORDER BY created_at ASC;

    SELECT id, name, description
    FROM feature
    WHERE id IN (SELECT VALUE \`in\` FROM has_task WHERE out = $task)
    LIMIT 1;

    SELECT id, title, status
    FROM task
    WHERE id IN (SELECT VALUE out FROM depends_on WHERE \`in\` = $task);

    SELECT id, agent, ended_at, summary
    FROM agent_session
    WHERE task_id = $task AND ended_at != NONE
    ORDER BY ended_at DESC LIMIT 5;
  `;

  const results = await surreal
    .query<[SubtaskRow[], FeatureRow[], DependencyRow[], AgentSessionRow[]]>(taskScopeQuery, {
      task: taskRecord,
    })
    .collect<[SubtaskRow[], FeatureRow[], DependencyRow[], AgentSessionRow[]]>();

  const [subtaskRows, featureRows, dependencyRows, sessionRows] = results;

  const parentFeature = featureRows.length > 0
    ? {
        id: toRawId(featureRows[0].id),
        name: featureRows[0].name,
        ...(featureRows[0].description ? { description: featureRows[0].description } : {}),
      }
    : undefined;

  let siblingTasks: { id: string; title: string; status: string; source_session?: string }[] = [];
  if (parentFeature && featureRows.length > 0) {
    const [siblingRows] = await surreal
      .query<[TaskRow[]]>(
        `SELECT id, title, status, source_session FROM task
         WHERE id IN (SELECT VALUE out FROM has_task WHERE \`in\` = $feature)
           AND id != $task
         ORDER BY created_at ASC LIMIT 20;`,
        { feature: featureRows[0].id, task: taskRecord },
      )
      .collect<[TaskRow[]]>();

    siblingTasks = siblingRows.map((t) => ({
      id: toRawId(t.id),
      title: t.title,
      status: t.status,
      ...(t.source_session ? { source_session: toRawId(t.source_session) } : {}),
    }));
  }

  return {
    task: {
      id: toRawId(task.id),
      title: task.title,
      ...(task.description ? { description: task.description } : {}),
      status: task.status,
      ...(task.category ? { category: task.category } : {}),
    },
    subtasks: subtaskRows.map((s) => ({
      id: toRawId(s.id),
      title: s.title,
      status: s.status,
    })),
    parent_feature: parentFeature,
    sibling_tasks: siblingTasks,
    dependencies: dependencyRows.map((d) => ({
      id: toRawId(d.id),
      title: d.title,
      status: d.status,
    })),
    related_sessions: sessionRows.map((s) => ({
      id: toRawId(s.id),
      agent: s.agent,
      ended_at: toIso(s.ended_at),
      summary: s.summary ?? "",
    })),
  };
}

/** Load active agent sessions, optionally scoped to a project */
async function loadActiveSessions(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
  projectRecord?: RecordId<"project", string>,
  excludeSessionId?: string,
): Promise<ActiveSessionContext[]> {
  const excludeRecord = excludeSessionId
    ? new RecordId("agent_session", excludeSessionId)
    : new RecordId("agent_session", "__none__");

  const projectFilter = projectRecord ? "AND project = $project" : "";
  const [sessionRows] = await surreal
    .query<[ActiveAgentSessionRow[]]>(
      `SELECT id, agent, started_at, task_id
       FROM agent_session
       WHERE workspace = $workspace ${projectFilter} AND ended_at = NONE AND id != $exclude
       ORDER BY started_at DESC LIMIT 10;`,
      { workspace: workspaceRecord, ...(projectRecord ? { project: projectRecord } : {}), exclude: excludeRecord },
    )
    .collect<[ActiveAgentSessionRow[]]>();

  if (sessionRows.length === 0) return [];

  const sessionIds = sessionRows.map((s) => s.id);

  const [observationRows] = await surreal
    .query<[SessionObservationRow[]]>(
      `SELECT id, text, severity, source_session FROM observation
       WHERE source_session IN $sessions
         AND status IN ["open", "acknowledged"];`,
      { sessions: sessionIds },
    )
    .collect<[SessionObservationRow[]]>();

  const taskIds = sessionRows
    .filter((s) => s.task_id)
    .map((s) => s.task_id!);

  let taskTitles: Map<string, string> = new Map();
  if (taskIds.length > 0) {
    const [taskRows] = await surreal
      .query<[Array<{ id: RecordId<"task", string>; title: string }>]>(
        `SELECT id, title FROM task WHERE id IN $tasks;`,
        { tasks: taskIds },
      )
      .collect<[Array<{ id: RecordId<"task", string>; title: string }>]>();
    taskTitles = new Map(taskRows.map((t) => [toRawId(t.id), t.title]));
  }

  const obsBySession = new Map<string, Array<{ id: string; text: string; severity: string }>>();
  for (const o of observationRows) {
    const sessionKey = toRawId(o.source_session);
    const arr = obsBySession.get(sessionKey) ?? [];
    arr.push({ id: toRawId(o.id), text: o.text, severity: o.severity });
    obsBySession.set(sessionKey, arr);
  }

  const decisionsBySession = new Map<string, Array<{ id: string; summary: string }>>();
  for (const session of sessionRows) {
    const sessionKey = toRawId(session.id);
    const [decisionRows] = await surreal
      .query<[Array<{ id: RecordId<"decision", string>; summary: string }>]>(
        `SELECT id, summary FROM decision
         WHERE id IN (SELECT VALUE out FROM produced WHERE \`in\` = $session)
           AND status = "provisional";`,
        { session: session.id },
      )
      .collect<[Array<{ id: RecordId<"decision", string>; summary: string }>]>();

    decisionsBySession.set(
      sessionKey,
      decisionRows.map((d) => ({ id: toRawId(d.id), summary: d.summary })),
    );
  }

  return sessionRows.map((s) => {
    const sessionKey = toRawId(s.id);
    const taskId = s.task_id ? toRawId(s.task_id) : undefined;
    return {
      id: sessionKey,
      agent: s.agent,
      started_at: toIso(s.started_at),
      ...(taskId && taskTitles.has(taskId)
        ? { task: { id: taskId, title: taskTitles.get(taskId)! } }
        : {}),
      provisional_decisions: decisionsBySession.get(sessionKey) ?? [],
      observations: obsBySession.get(sessionKey) ?? [],
    };
  });
}

/** Load entities changed since a timestamp (project-scoped) */
async function loadRecentChanges(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
  projectRecord: RecordId<"project", string>,
  since: string,
): Promise<RecentChangeContext[]> {
  const sinceDate = new Date(since);

  const query = `
    LET $project_entity_ids = SELECT VALUE \`in\` FROM belongs_to WHERE out = $project;

    LET $recent_decisions = SELECT "decision" AS entity_type, summary AS entity_name, status AS change_type, updated_at AS changed_at
    FROM decision
    WHERE workspace = $workspace AND id IN $project_entity_ids AND updated_at > $since
    ORDER BY updated_at DESC LIMIT 20;

    LET $recent_tasks = SELECT "task" AS entity_type, title AS entity_name, status AS change_type, updated_at AS changed_at
    FROM task
    WHERE workspace = $workspace AND id IN $project_entity_ids AND updated_at > $since
    ORDER BY updated_at DESC LIMIT 20;

    LET $recent_questions = SELECT "question" AS entity_type, text AS entity_name, status AS change_type, updated_at AS changed_at
    FROM question
    WHERE workspace = $workspace AND id IN $project_entity_ids AND updated_at > $since
    ORDER BY updated_at DESC LIMIT 20;

    LET $recent_observations = SELECT "observation" AS entity_type, text AS entity_name, severity AS change_type, updated_at AS changed_at
    FROM observation
    WHERE workspace = $workspace AND updated_at > $since
    ORDER BY updated_at DESC LIMIT 20;

    LET $recent_suggestions = SELECT "suggestion" AS entity_type, text AS entity_name, status AS change_type, updated_at AS changed_at
    FROM suggestion
    WHERE workspace = $workspace AND updated_at > $since
    ORDER BY updated_at DESC LIMIT 20;

    RETURN array::flatten([$recent_decisions, $recent_tasks, $recent_questions, $recent_observations, $recent_suggestions]);
  `;

  const results = await surreal
    .query<[null, null, null, null, null, null, RecentChangeRow[]]>(query, {
      project: projectRecord,
      workspace: workspaceRecord,
      since: sinceDate,
    })
    .collect<[null, null, null, null, null, null, RecentChangeRow[]]>();

  const rows = results[6] ?? [];

  return rows.map((r) => ({
    entity_type: r.entity_type,
    entity_name: r.entity_name,
    change_type: r.change_type,
    changed_at: toIso(r.changed_at),
  }));
}
