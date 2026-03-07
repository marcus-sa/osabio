import { RecordId, type Surreal } from "surrealdb";
import {
  ASSIGNABLE_TASK_STATUSES,
  ACTIVE_ORCHESTRATOR_STATUSES,
  type AssignableTaskStatus,
  type AssignmentError,
  type AssignmentValidation,
  type TaskRow,
  type ActiveSessionRow,
} from "./types";

// ---------------------------------------------------------------------------
// Result type — discriminated union for success/failure
// ---------------------------------------------------------------------------

export type AssignmentResult =
  | { ok: true; validation: AssignmentValidation }
  | { ok: false; error: AssignmentError };

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function isAssignableStatus(status: string): status is AssignableTaskStatus {
  return (ASSIGNABLE_TASK_STATUSES as readonly string[]).includes(status);
}

function missingTaskId(): AssignmentResult {
  return {
    ok: false,
    error: {
      code: "MISSING_TASK_ID",
      message: "taskId is required",
      httpStatus: 400,
    },
  };
}

function taskNotFound(taskId: string): AssignmentResult {
  return {
    ok: false,
    error: {
      code: "TASK_NOT_FOUND",
      message: `Task not found: ${taskId}`,
      httpStatus: 404,
    },
  };
}

function workspaceMismatch(taskId: string): AssignmentResult {
  return {
    ok: false,
    error: {
      code: "WORKSPACE_MISMATCH",
      message: `Task ${taskId} does not belong to the requested workspace`,
      httpStatus: 403,
    },
  };
}

function taskNotAssignable(taskId: string, status: string): AssignmentResult {
  return {
    ok: false,
    error: {
      code: "TASK_NOT_ASSIGNABLE",
      message: `Task ${taskId} has status '${status}' and cannot be assigned (must be ready or todo)`,
      httpStatus: 409,
    },
  };
}

function agentAlreadyActive(taskId: string): AssignmentResult {
  return {
    ok: false,
    error: {
      code: "AGENT_ALREADY_ACTIVE",
      message: `Task ${taskId} already has an active agent session`,
      httpStatus: 409,
    },
  };
}

function repoPathRequired(workspaceId: string): AssignmentResult {
  return {
    ok: false,
    error: {
      code: "REPO_PATH_REQUIRED",
      message: `Workspace ${workspaceId} has no repo_path configured. Set a repository path before assigning tasks to agents.`,
      httpStatus: 400,
    },
  };
}

// ---------------------------------------------------------------------------
// DB queries (thin wrappers — side effects isolated here)
// ---------------------------------------------------------------------------

async function fetchTask(
  surreal: Surreal,
  taskRecord: RecordId<"task", string>,
): Promise<TaskRow | undefined> {
  const [rows] = await surreal.query<[TaskRow[]]>(
    `SELECT id, title, status, workspace FROM $taskRecord;`,
    { taskRecord },
  );
  return rows[0];
}

type WorkspaceRepoRow = {
  repo_path?: string;
};

async function fetchWorkspaceRepoPath(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
): Promise<string | undefined> {
  const [rows] = await surreal.query<[WorkspaceRepoRow[]]>(
    `SELECT repo_path FROM $workspaceRecord;`,
    { workspaceRecord },
  );
  return rows[0]?.repo_path;
}

async function hasActiveSession(
  surreal: Surreal,
  taskRecord: RecordId<"task", string>,
): Promise<boolean> {
  const [rows] = await surreal.query<[ActiveSessionRow[]]>(
    `SELECT id, orchestrator_status FROM agent_session
     WHERE task_id = $taskRecord
       AND orchestrator_status IN $activeStatuses
     LIMIT 1;`,
    { taskRecord, activeStatuses: [...ACTIVE_ORCHESTRATOR_STATUSES] },
  );
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Orchestration — pure pipeline over DB results
// ---------------------------------------------------------------------------

/**
 * Validate that a task exists, is in an assignable status, belongs to the
 * given workspace, and has no active agent session already working on it.
 */
export async function validateAssignment(
  surreal: Surreal,
  workspaceId: string,
  taskId: string,
): Promise<AssignmentResult> {
  // 1. Input validation
  if (!taskId) {
    return missingTaskId();
  }

  const taskRecord = new RecordId("task", taskId);

  // 2. Task existence
  const task = await fetchTask(surreal, taskRecord);
  if (!task) {
    return taskNotFound(taskId);
  }

  // 3. Workspace membership
  const taskWorkspaceId = task.workspace.id as string;
  if (taskWorkspaceId !== workspaceId) {
    return workspaceMismatch(taskId);
  }

  // 4. Repo path required
  const repoPath = await fetchWorkspaceRepoPath(surreal, task.workspace);
  if (!repoPath) {
    return repoPathRequired(workspaceId);
  }

  // 5. Status eligibility
  if (!isAssignableStatus(task.status)) {
    return taskNotAssignable(taskId, task.status);
  }

  // 6. One-agent-per-task
  const alreadyActive = await hasActiveSession(surreal, taskRecord);
  if (alreadyActive) {
    return agentAlreadyActive(taskId);
  }

  // All checks passed
  return {
    ok: true,
    validation: {
      taskRecord,
      workspaceRecord: task.workspace,
      taskStatus: task.status,
      title: task.title,
      repoPath,
    },
  };
}
