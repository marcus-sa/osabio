import { RecordId, type Surreal } from "surrealdb";
import type {
  ContextPacket,
  DecisionContext,
  TaskContext,
  QuestionContext,
  ObservationContext,
  TaskScopeContext,
  RecentChangeContext,
} from "./types";

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

function toId(record: RecordId<string, string>): string {
  return `${record.table.name}:${record.id as string}`;
}

function toIso(value: Date | string | undefined): string {
  if (!value) return "";
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/** Build a broad project context packet (all decisions, tasks, questions for a project) */
export async function buildProjectContext(input: {
  surreal: Surreal;
  workspaceRecord: RecordId<"workspace", string>;
  workspaceName: string;
  projectRecord: RecordId<"project", string>;
  taskId?: string;
  since?: string;
}): Promise<ContextPacket> {
  const { surreal, workspaceRecord, workspaceName, projectRecord, taskId } = input;

  // Load project details
  const project = await surreal.select<ProjectRow>(projectRecord);
  if (!project) {
    throw new Error(`project not found: ${projectRecord.id}`);
  }

  // Load project-scoped entities in parallel
  const projectEntitiesQuery = `
    LET $project_entity_ids = SELECT VALUE \`in\` FROM belongs_to WHERE out = $project;

    SELECT id, summary, status, rationale, decided_at, category, priority
    FROM decision
    WHERE workspace = $workspace AND id IN $project_entity_ids
    ORDER BY created_at DESC LIMIT 50;

    SELECT id, title, status, priority, category, description
    FROM task
    WHERE workspace = $workspace AND id IN $project_entity_ids
    ORDER BY created_at DESC LIMIT 50;

    SELECT id, text, status, context, priority
    FROM question
    WHERE workspace = $workspace AND id IN $project_entity_ids
    ORDER BY created_at DESC LIMIT 30;

    SELECT id, text, severity, status, category
    FROM observation
    WHERE workspace = $workspace AND status IN ["open", "acknowledged"]
    ORDER BY created_at DESC LIMIT 20;
  `;

  const results = await surreal
    .query<[null, DecisionRow[], TaskRow[], QuestionRow[], ObservationRow[]]>(projectEntitiesQuery, {
      project: projectRecord,
      workspace: workspaceRecord,
    })
    .collect<[null, DecisionRow[], TaskRow[], QuestionRow[], ObservationRow[]]>();

  const [, decisionRows, taskRows, questionRows, observationRows] = results;

  // Categorize decisions by status
  const confirmed: DecisionContext[] = [];
  const provisional: DecisionContext[] = [];
  const contested: DecisionContext[] = [];

  for (const d of decisionRows) {
    const ctx: DecisionContext = {
      id: toId(d.id),
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

  // Map tasks
  const activeTasks: TaskContext[] = taskRows
    .filter((t) => t.status !== "done" && t.status !== "completed")
    .map((t) => ({
      id: toId(t.id),
      title: t.title,
      status: t.status,
      ...(t.priority ? { priority: t.priority } : {}),
      ...(t.category ? { category: t.category } : {}),
    }));

  // Map questions
  const openQuestions: QuestionContext[] = questionRows
    .filter((q) => q.status !== "answered" && q.status !== "resolved")
    .map((q) => ({
      id: toId(q.id),
      text: q.text,
      status: q.status,
      ...(q.context ? { context: q.context } : {}),
      ...(q.priority ? { priority: q.priority } : {}),
    }));

  // Map observations
  const observations: ObservationContext[] = observationRows.map((o) => ({
    id: toId(o.id),
    text: o.text,
    severity: o.severity,
    status: o.status,
    ...(o.category ? { category: o.category } : {}),
  }));

  // Build recent changes if `since` provided
  const recentChanges: RecentChangeContext[] = input.since
    ? await loadRecentChanges(surreal, workspaceRecord, projectRecord, input.since)
    : [];

  // Build task scope if taskId provided
  let taskScope: TaskScopeContext | undefined;
  if (taskId) {
    taskScope = await buildTaskScope(surreal, workspaceRecord, projectRecord, taskId);
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
  };
}

/** Build task-scoped context: subtasks, parent feature, siblings, dependencies, related sessions */
async function buildTaskScope(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
  projectRecord: RecordId<"project", string>,
  taskId: string,
): Promise<TaskScopeContext> {
  const taskRecord = new RecordId("task", taskId);
  const task = await surreal.select<TaskRow>(taskRecord);
  if (!task) {
    throw new Error(`task not found: ${taskId}`);
  }

  // Load subtasks, parent feature, dependencies, and related sessions in parallel
  const taskScopeQuery = `
    -- Subtasks of this task
    SELECT id, title, status
    FROM task
    WHERE id IN (SELECT VALUE \`in\` FROM subtask_of WHERE out = $task)
    ORDER BY created_at ASC;

    -- Parent feature (via has_task edge)
    SELECT id, name, description
    FROM feature
    WHERE id IN (SELECT VALUE \`in\` FROM has_task WHERE out = $task)
    LIMIT 1;

    -- Dependencies (tasks this task depends on)
    SELECT id, title, status
    FROM task
    WHERE id IN (SELECT VALUE out FROM depends_on WHERE \`in\` = $task);

    -- Recent agent sessions that touched this task
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
        id: toId(featureRows[0].id),
        name: featureRows[0].name,
        ...(featureRows[0].description ? { description: featureRows[0].description } : {}),
      }
    : undefined;

  // Load sibling tasks (other tasks under same feature)
  let siblingTasks: { id: string; title: string; status: string }[] = [];
  if (parentFeature && featureRows.length > 0) {
    const [siblingRows] = await surreal
      .query<[TaskRow[]]>(
        `SELECT id, title, status FROM task
         WHERE id IN (SELECT VALUE out FROM has_task WHERE \`in\` = $feature)
           AND id != $task
         ORDER BY created_at ASC LIMIT 20;`,
        { feature: featureRows[0].id, task: taskRecord },
      )
      .collect<[TaskRow[]]>();

    siblingTasks = siblingRows.map((t) => ({
      id: toId(t.id),
      title: t.title,
      status: t.status,
    }));
  }

  return {
    task: {
      id: toId(task.id),
      title: task.title,
      ...(task.description ? { description: task.description } : {}),
      status: task.status,
      ...(task.category ? { category: task.category } : {}),
    },
    subtasks: subtaskRows.map((s) => ({
      id: toId(s.id),
      title: s.title,
      status: s.status,
    })),
    parent_feature: parentFeature,
    sibling_tasks: siblingTasks,
    dependencies: dependencyRows.map((d) => ({
      id: toId(d.id),
      title: d.title,
      status: d.status,
    })),
    related_sessions: sessionRows.map((s) => ({
      id: toId(s.id),
      agent: s.agent,
      ended_at: toIso(s.ended_at),
      summary: s.summary ?? "",
    })),
  };
}

/** Load entities changed since a timestamp for the recent_changes field */
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

    RETURN array::flatten([$recent_decisions, $recent_tasks, $recent_questions]);
  `;

  const results = await surreal
    .query<[null, null, null, null, RecentChangeRow[]]>(query, {
      project: projectRecord,
      workspace: workspaceRecord,
      since: sinceDate,
    })
    .collect<[null, null, null, null, RecentChangeRow[]]>();

  const rows = results[4] ?? [];

  return rows.map((r) => ({
    entity_type: r.entity_type,
    entity_name: r.entity_name,
    change_type: r.change_type,
    changed_at: toIso(r.changed_at),
  }));
}

type RecentChangeRow = {
  entity_type: string;
  entity_name: string;
  change_type: string;
  changed_at: Date | string;
};
