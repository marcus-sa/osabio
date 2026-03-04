import { randomUUID } from "node:crypto";
import { RecordId, type Surreal } from "surrealdb";

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

type DecisionRow = {
  id: RecordId<"decision", string>;
  summary: string;
  status: string;
  rationale?: string;
  decided_at?: Date | string;
  category?: string;
  priority?: string;
  created_at: Date | string;
};

type TaskRow = {
  id: RecordId<"task", string>;
  title: string;
  status: string;
  priority?: string;
  category?: string;
  description?: string;
  created_at: Date | string;
};

type EntityChangeRow = {
  entity_type: string;
  entity_name: string;
  change_type: string;
  changed_at: Date | string;
};

type SubtaskRow = {
  id: RecordId<"task", string>;
  title: string;
  status: string;
};

type DependencyRow = {
  id: RecordId<"task", string>;
  title: string;
  status: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toId(record: RecordId<string, string>): string {
  return `${record.table.name}:${record.id as string}`;
}

function toIso(value: Date | string | undefined): string {
  if (!value) return "";
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

// ---------------------------------------------------------------------------
// Project-scoped queries
// ---------------------------------------------------------------------------

/** List active decisions for a project, optionally filtered by area/category */
export async function listProjectDecisions(input: {
  surreal: Surreal;
  workspaceRecord: RecordId<"workspace", string>;
  projectRecord: RecordId<"project", string>;
  area?: string;
}): Promise<{
  confirmed: Array<{ id: string; summary: string; status: string; rationale?: string; decided_at?: string; category?: string }>;
  provisional: Array<{ id: string; summary: string; status: string; rationale?: string; decided_at?: string; category?: string }>;
  contested: Array<{ id: string; summary: string; status: string; rationale?: string; decided_at?: string; category?: string }>;
}> {
  const areaFilter = input.area
    ? `AND category = $area`
    : "";

  const [rows] = await input.surreal
    .query<[DecisionRow[]]>(
      `SELECT id, summary, status, rationale, decided_at, category, priority, created_at
       FROM decision
       WHERE workspace = $workspace
         AND id IN (SELECT VALUE \`in\` FROM belongs_to WHERE out = $project)
         ${areaFilter}
       ORDER BY created_at DESC LIMIT 50;`,
      {
        workspace: input.workspaceRecord,
        project: input.projectRecord,
        ...(input.area ? { area: input.area } : {}),
      },
    )
    .collect<[DecisionRow[]]>();

  type DecisionItem = { id: string; summary: string; status: string; rationale?: string; decided_at?: string; category?: string };
  const confirmed: DecisionItem[] = [];
  const provisional: DecisionItem[] = [];
  const contested: DecisionItem[] = [];

  for (const d of rows) {
    const item: DecisionItem = {
      id: toId(d.id),
      summary: d.summary,
      status: d.status,
      ...(d.rationale ? { rationale: d.rationale } : {}),
      ...(d.decided_at ? { decided_at: toIso(d.decided_at) } : {}),
      ...(d.category ? { category: d.category } : {}),
    };

    if (d.status === "contested") contested.push(item);
    else if (d.status === "provisional" || d.status === "inferred") provisional.push(item);
    else if (d.status === "confirmed") confirmed.push(item);
  }

  return { confirmed, provisional, contested };
}

/** Get task dependency tree (recursive) */
export async function getTaskDependencyTree(input: {
  surreal: Surreal;
  taskRecord: RecordId<"task", string>;
}): Promise<{
  task: { id: string; title: string; status: string };
  dependencies: Array<{ id: string; title: string; status: string; resolved: boolean }>;
  dependents: Array<{ id: string; title: string; status: string }>;
  subtasks: Array<{ id: string; title: string; status: string }>;
}> {
  const task = await input.surreal.select<TaskRow>(input.taskRecord);
  if (!task) throw new Error(`task not found: ${input.taskRecord.id}`);

  const query = `
    -- Tasks this task depends on
    SELECT id, title, status
    FROM task
    WHERE id IN (SELECT VALUE out FROM depends_on WHERE \`in\` = $task);

    -- Tasks that depend on this task
    SELECT id, title, status
    FROM task
    WHERE id IN (SELECT VALUE \`in\` FROM depends_on WHERE out = $task);

    -- Subtasks
    SELECT id, title, status
    FROM task
    WHERE id IN (SELECT VALUE \`in\` FROM subtask_of WHERE out = $task)
    ORDER BY created_at ASC;
  `;

  const results = await input.surreal
    .query<[DependencyRow[], DependencyRow[], SubtaskRow[]]>(query, { task: input.taskRecord })
    .collect<[DependencyRow[], DependencyRow[], SubtaskRow[]]>();

  const [deps, dependents, subtasks] = results;

  return {
    task: { id: toId(task.id), title: task.title, status: task.status },
    dependencies: deps.map((d) => ({
      id: toId(d.id),
      title: d.title,
      status: d.status,
      resolved: d.status === "done" || d.status === "completed",
    })),
    dependents: dependents.map((d) => ({ id: toId(d.id), title: d.title, status: d.status })),
    subtasks: subtasks.map((s) => ({ id: toId(s.id), title: s.title, status: s.status })),
  };
}

/** List architecture constraints for a project */
export async function listProjectConstraints(input: {
  surreal: Surreal;
  workspaceRecord: RecordId<"workspace", string>;
  projectRecord: RecordId<"project", string>;
  area?: string;
}): Promise<Array<{ text: string; source: string; severity: "hard" | "soft" }>> {
  // Constraints come from two sources:
  // 1. Decisions marked as confirmed/contested (hard constraints)
  // 2. Observations with severity "conflict" or "warning"

  const areaFilter = input.area ? `AND category = $area` : "";

  const query = `
    LET $project_entity_ids = SELECT VALUE \`in\` FROM belongs_to WHERE out = $project;

    SELECT summary AS text, "decision" AS source_type, status, id
    FROM decision
    WHERE workspace = $workspace
      AND id IN $project_entity_ids
      AND status IN ["confirmed", "contested"]
      ${areaFilter}
    ORDER BY created_at DESC LIMIT 30;

    SELECT text, "observation" AS source_type, severity, id
    FROM observation
    WHERE workspace = $workspace
      AND status IN ["open", "acknowledged"]
      AND severity IN ["conflict", "warning"]
    ORDER BY created_at DESC LIMIT 20;
  `;

  const results = await input.surreal
    .query<[null, Array<{ text: string; source_type: string; status: string; id: RecordId }>, Array<{ text: string; source_type: string; severity: string; id: RecordId }>]>(
      query,
      {
        workspace: input.workspaceRecord,
        project: input.projectRecord,
        ...(input.area ? { area: input.area } : {}),
      },
    )
    .collect<[null, Array<{ text: string; source_type: string; status: string; id: RecordId }>, Array<{ text: string; source_type: string; severity: string; id: RecordId }>]>();

  const [, decisionRows, observationRows] = results;

  const constraints: Array<{ text: string; source: string; severity: "hard" | "soft" }> = [];

  for (const d of decisionRows) {
    constraints.push({
      text: d.text,
      source: `decision:${(d.id as RecordId<string, string>).id as string}`,
      severity: d.status === "contested" ? "hard" : "hard",
    });
  }

  for (const o of observationRows) {
    constraints.push({
      text: o.text,
      source: `observation:${(o.id as RecordId<string, string>).id as string}`,
      severity: o.severity === "conflict" ? "hard" : "soft",
    });
  }

  return constraints;
}

/** List recent changes since a timestamp */
export async function listRecentChanges(input: {
  surreal: Surreal;
  workspaceRecord: RecordId<"workspace", string>;
  projectRecord?: RecordId<"project", string>;
  since: string;
}): Promise<Array<{ entity_type: string; entity_name: string; change_type: string; changed_at: string }>> {
  const sinceDate = new Date(input.since);

  const projectFilter = input.projectRecord
    ? `AND id IN (SELECT VALUE \`in\` FROM belongs_to WHERE out = $project)`
    : "";

  const query = `
    LET $recent_decisions = SELECT "decision" AS entity_type, summary AS entity_name, status AS change_type, updated_at AS changed_at
    FROM decision
    WHERE workspace = $workspace ${projectFilter} AND updated_at > $since
    ORDER BY updated_at DESC LIMIT 20;

    LET $recent_tasks = SELECT "task" AS entity_type, title AS entity_name, status AS change_type, updated_at AS changed_at
    FROM task
    WHERE workspace = $workspace ${projectFilter} AND updated_at > $since
    ORDER BY updated_at DESC LIMIT 20;

    LET $recent_questions = SELECT "question" AS entity_type, text AS entity_name, status AS change_type, updated_at AS changed_at
    FROM question
    WHERE workspace = $workspace ${projectFilter} AND updated_at > $since
    ORDER BY updated_at DESC LIMIT 20;

    RETURN array::flatten([$recent_decisions, $recent_tasks, $recent_questions]);
  `;

  const results = await input.surreal
    .query<[null, null, null, EntityChangeRow[]]>(query, {
      workspace: input.workspaceRecord,
      since: sinceDate,
      ...(input.projectRecord ? { project: input.projectRecord } : {}),
    })
    .collect<[null, null, null, EntityChangeRow[]]>();

  return (results[3] ?? []).map((r) => ({
    entity_type: r.entity_type,
    entity_name: r.entity_name,
    change_type: r.change_type,
    changed_at: toIso(r.changed_at),
  }));
}

/** Create a subtask with semantic dedup */
export async function createSubtask(input: {
  surreal: Surreal;
  parentTaskRecord: RecordId<"task", string>;
  title: string;
  workspaceRecord: RecordId<"workspace", string>;
  category?: string;
  rationale?: string;
}): Promise<{ task_id: string; parent_task_id: string; already_existed: boolean }> {
  // Check for existing similar subtasks (semantic dedup by title)
  const normalizedTitle = input.title.toLowerCase().trim();

  const [existingRows] = await input.surreal
    .query<[SubtaskRow[]]>(
      `SELECT id, title, status
       FROM task
       WHERE id IN (SELECT VALUE \`in\` FROM subtask_of WHERE out = $parent)
       ORDER BY created_at ASC;`,
      { parent: input.parentTaskRecord },
    )
    .collect<[SubtaskRow[]]>();

  // Simple dedup: check if any existing subtask title is very similar
  for (const existing of existingRows) {
    const existingNormalized = existing.title.toLowerCase().trim();
    if (existingNormalized === normalizedTitle || levenshteinSimilarity(existingNormalized, normalizedTitle) > 0.85) {
      return {
        task_id: toId(existing.id),
        parent_task_id: toId(input.parentTaskRecord),
        already_existed: true,
      };
    }
  }

  // Get parent task's category if not specified
  const parentTask = await input.surreal.select<TaskRow>(input.parentTaskRecord);
  if (!parentTask) throw new Error(`parent task not found: ${input.parentTaskRecord.id}`);

  const now = new Date();
  const taskRecord = new RecordId("task", randomUUID());

  await input.surreal.create(taskRecord).content({
    title: input.title,
    status: "todo",
    created_at: now,
    updated_at: now,
    workspace: input.workspaceRecord,
    ...(input.category ? { category: input.category } : parentTask.category ? { category: parentTask.category } : {}),
    ...(input.rationale ? { description: input.rationale } : {}),
  });

  // Create subtask_of edge
  await input.surreal
    .relate(taskRecord, new RecordId("subtask_of", randomUUID()), input.parentTaskRecord, {
      added_at: now,
    })
    .output("after");

  // Copy belongs_to edges from parent (inherit project/feature)
  const [parentBelongsTo] = await input.surreal
    .query<[Array<{ out: RecordId }>]>(
      "SELECT out FROM belongs_to WHERE `in` = $parent;",
      { parent: input.parentTaskRecord },
    )
    .collect<[Array<{ out: RecordId }>]>();

  for (const edge of parentBelongsTo) {
    await input.surreal
      .relate(taskRecord, new RecordId("belongs_to", randomUUID()), edge.out, {
        added_at: now,
      })
      .output("after");
  }

  return {
    task_id: toId(taskRecord),
    parent_task_id: toId(input.parentTaskRecord),
    already_existed: false,
  };
}

/** Update task status with subtask rollup */
export async function updateTaskStatus(input: {
  surreal: Surreal;
  taskRecord: RecordId<"task", string>;
  status: string;
  notes?: string;
}): Promise<{ task_id: string; status: string; parent_status?: string }> {
  const now = new Date();

  await input.surreal.update(input.taskRecord).merge({
    status: input.status,
    updated_at: now,
  });

  if (input.notes) {
    // Append note to description_entries
    const task = await input.surreal.select<{ description_entries?: Array<{ text: string; created_at: Date }> }>(input.taskRecord);
    const entries = task?.description_entries ?? [];
    entries.push({ text: input.notes, created_at: now });
    await input.surreal.update(input.taskRecord).merge({ description_entries: entries });
  }

  // Check if this task has a parent (subtask_of) and compute rollup
  const [parentRows] = await input.surreal
    .query<[Array<{ out: RecordId<"task", string> }>]>(
      "SELECT out FROM subtask_of WHERE `in` = $task LIMIT 1;",
      { task: input.taskRecord },
    )
    .collect<[Array<{ out: RecordId<"task", string> }>]>();

  let parentStatus: string | undefined;

  if (parentRows.length > 0) {
    const parentRecord = parentRows[0].out;
    parentStatus = await computeSubtaskRollup(input.surreal, parentRecord);
  }

  return {
    task_id: toId(input.taskRecord),
    status: input.status,
    ...(parentStatus ? { parent_status: parentStatus } : {}),
  };
}

/** Compute and apply subtask rollup on a parent task */
async function computeSubtaskRollup(
  surreal: Surreal,
  parentRecord: RecordId<"task", string>,
): Promise<string> {
  const [subtaskRows] = await surreal
    .query<[SubtaskRow[]]>(
      `SELECT id, title, status
       FROM task
       WHERE id IN (SELECT VALUE \`in\` FROM subtask_of WHERE out = $parent);`,
      { parent: parentRecord },
    )
    .collect<[SubtaskRow[]]>();

  if (subtaskRows.length === 0) return "unknown";

  const allCompleted = subtaskRows.every((s) => s.status === "done" || s.status === "completed");
  const anyBlocked = subtaskRows.some((s) => s.status === "blocked");
  const anyInProgress = subtaskRows.some((s) => s.status === "in_progress");
  const allTodo = subtaskRows.every((s) => s.status === "todo");

  let derivedStatus: string;

  if (allCompleted) derivedStatus = "completed";
  else if (anyBlocked && anyInProgress) derivedStatus = "in_progress";
  else if (anyBlocked) derivedStatus = "blocked";
  else if (anyInProgress) derivedStatus = "in_progress";
  else if (allTodo) derivedStatus = "todo";
  else derivedStatus = "in_progress";

  await surreal.update(parentRecord).merge({
    status: derivedStatus,
    updated_at: new Date(),
  });

  return derivedStatus;
}

/** Log an implementation note on an entity */
export async function logImplementationNote(input: {
  surreal: Surreal;
  entityTable: string;
  entityId: string;
  note: string;
  filesChanged?: string[];
}): Promise<{ entity_id: string; note_added: boolean }> {
  const record = new RecordId(input.entityTable, input.entityId);
  const entity = await input.surreal.select<{ description_entries?: Array<{ text: string; source?: RecordId; created_at: Date }> }>(record);

  if (!entity) throw new Error(`entity not found: ${input.entityTable}:${input.entityId}`);

  const now = new Date();
  const entries = entity.description_entries ?? [];
  const noteText = input.filesChanged?.length
    ? `${input.note}\n\nFiles: ${input.filesChanged.join(", ")}`
    : input.note;

  entries.push({ text: noteText, created_at: now });

  await input.surreal.update(record).merge({
    description_entries: entries,
    updated_at: now,
  });

  return { entity_id: `${input.entityTable}:${input.entityId}`, note_added: true };
}

/** Create or finalize an agent session */
export async function createAgentSession(input: {
  surreal: Surreal;
  agent: string;
  directory: string;
  workspaceRecord: RecordId<"workspace", string>;
  projectRecord: RecordId<"project", string>;
  taskId?: string;
}): Promise<{ session_id: string }> {
  const now = new Date();
  const sessionRecord = new RecordId("agent_session", randomUUID());

  await input.surreal.create(sessionRecord).content({
    agent: input.agent,
    directory: input.directory,
    started_at: now,
    workspace: input.workspaceRecord,
    project: input.projectRecord,
    created_at: now,
    ...(input.taskId ? { task_id: new RecordId("task", input.taskId) } : {}),
  });

  // If task-scoped, link session to task and auto-promote status
  if (input.taskId) {
    const taskRecord = new RecordId("task", input.taskId);
    const task = await input.surreal.select<TaskRow>(taskRecord);
    if (task) {
      await input.surreal.update(taskRecord).merge({
        ...(task.status === "todo" || task.status === "ready"
          ? { status: "in_progress" }
          : {}),
        source_session: sessionRecord,
        updated_at: now,
      });
    }
  }

  return { session_id: toId(sessionRecord) };
}

/** End an agent session with summary */
export async function endAgentSession(input: {
  surreal: Surreal;
  sessionId: string;
  summary: string;
  decisionsMade?: string[];
  questionsAsked?: string[];
  tasksProgressed?: Array<{ task_id: string; from_status: string; to_status: string }>;
  filesChanged?: Array<{ path: string; change_type: string }>;
  observationsLogged?: string[];
}): Promise<{ session_id: string; ended: boolean }> {
  const now = new Date();
  const sessionRecord = new RecordId("agent_session", input.sessionId);

  await input.surreal.update(sessionRecord).merge({
    ended_at: now,
    summary: input.summary,
    ...(input.decisionsMade?.length
      ? { decisions_made: input.decisionsMade.map((id) => new RecordId("decision", id)) }
      : {}),
    ...(input.questionsAsked?.length
      ? { questions_asked: input.questionsAsked.map((id) => new RecordId("question", id)) }
      : {}),
    ...(input.tasksProgressed?.length
      ? {
          tasks_progressed: input.tasksProgressed.map((t) => ({
            task_id: new RecordId("task", t.task_id),
            from_status: t.from_status,
            to_status: t.to_status,
          })),
        }
      : {}),
    ...(input.filesChanged?.length ? { files_changed: input.filesChanged } : {}),
    ...(input.observationsLogged?.length
      ? { observations_logged: input.observationsLogged.map((id) => new RecordId("observation", id)) }
      : {}),
  });

  // Create session -> entity edges
  if (input.decisionsMade?.length) {
    for (const decisionId of input.decisionsMade) {
      await input.surreal
        .relate(sessionRecord, new RecordId("produced", randomUUID()), new RecordId("decision", decisionId), {
          added_at: now,
        })
        .output("after");
    }
  }

  if (input.questionsAsked?.length) {
    for (const questionId of input.questionsAsked) {
      await input.surreal
        .relate(sessionRecord, new RecordId("asked", randomUUID()), new RecordId("question", questionId), {
          added_at: now,
        })
        .output("after");
    }
  }

  if (input.tasksProgressed?.length) {
    for (const t of input.tasksProgressed) {
      await input.surreal
        .relate(sessionRecord, new RecordId("progressed", randomUUID()), new RecordId("task", t.task_id), {
          from_status: t.from_status,
          to_status: t.to_status,
          added_at: now,
        })
        .output("after");
    }
  }

  return { session_id: toId(sessionRecord), ended: true };
}

/** Log a git commit to the graph */
export async function logCommit(input: {
  surreal: Surreal;
  workspaceRecord: RecordId<"workspace", string>;
  projectRecord: RecordId<"project", string>;
  sha: string;
  message: string;
  filesChanged: Array<{ path: string; change_type: string; lines_added: number; lines_removed: number }>;
  author: string;
  taskUpdates?: Array<{ task_id: string; new_status: string }>;
  relatedTaskIds?: string[];
  decisionsDetected?: Array<{ name: string; rationale: string }>;
}): Promise<{ commit_id: string; tasks_updated: number; tasks_linked: number; decisions_created: number }> {
  const now = new Date();
  const commitRecord = new RecordId("git_commit", randomUUID());

  await input.surreal.create(commitRecord).content({
    sha: input.sha,
    message: input.message,
    workspace: input.workspaceRecord,
    authored_at: now,
    created_at: now,
  });

  // Update task statuses
  let tasksUpdated = 0;
  if (input.taskUpdates?.length) {
    for (const update of input.taskUpdates) {
      const taskRecord = new RecordId("task", update.task_id);
      await input.surreal.update(taskRecord).merge({
        status: update.new_status,
        updated_at: now,
      });
      tasksUpdated++;
    }
  }

  // Link related tasks to this commit
  const linkedTaskIds = new Set<string>();
  // Include tasks from task_updates
  if (input.taskUpdates?.length) {
    for (const update of input.taskUpdates) {
      linkedTaskIds.add(update.task_id);
    }
  }
  // Include explicitly declared related tasks
  if (input.relatedTaskIds?.length) {
    for (const taskId of input.relatedTaskIds) {
      linkedTaskIds.add(taskId);
    }
  }
  for (const taskId of linkedTaskIds) {
    await input.surreal
      .relate(new RecordId("task", taskId), new RecordId("implemented_by", randomUUID()), commitRecord, {
        commit_sha: input.sha,
        linked_at: now,
      })
      .output("after");
  }

  // Create provisional decisions if flagged
  let decisionsCreated = 0;
  if (input.decisionsDetected?.length) {
    for (const decision of input.decisionsDetected) {
      const decisionRecord = new RecordId("decision", randomUUID());
      await input.surreal.create(decisionRecord).content({
        summary: decision.name,
        rationale: decision.rationale,
        status: "provisional",
        decided_by_name: "code-agent",
        workspace: input.workspaceRecord,
        source_commit: commitRecord,
        created_at: now,
        updated_at: now,
      });

      // Link decision to project
      await input.surreal
        .relate(decisionRecord, new RecordId("belongs_to", randomUUID()), input.projectRecord, {
          added_at: now,
        })
        .output("after");

      // Create implemented_by edge
      await input.surreal
        .relate(decisionRecord, new RecordId("implemented_by", randomUUID()), commitRecord, {
          commit_sha: input.sha,
          linked_at: now,
        })
        .output("after");

      decisionsCreated++;
    }
  }

  return {
    commit_id: toId(commitRecord),
    tasks_updated: tasksUpdated,
    tasks_linked: linkedTaskIds.size,
    decisions_created: decisionsCreated,
  };
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function levenshteinSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;
  if (longer.length === 0) return 1;

  const costs: number[] = [];
  for (let i = 0; i <= longer.length; i++) {
    let lastValue = i;
    for (let j = 0; j <= shorter.length; j++) {
      if (i === 0) {
        costs[j] = j;
      } else if (j > 0) {
        let newValue = costs[j - 1];
        if (longer.charAt(i - 1) !== shorter.charAt(j - 1)) {
          newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
        }
        costs[j - 1] = lastValue;
        lastValue = newValue;
      }
    }
    if (i > 0) costs[shorter.length] = lastValue;
  }

  return (longer.length - costs[shorter.length]) / longer.length;
}
