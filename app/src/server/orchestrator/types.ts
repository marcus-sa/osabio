import type { RecordId } from "surrealdb";

// ---------------------------------------------------------------------------
// Task status classification
// ---------------------------------------------------------------------------

export const ASSIGNABLE_TASK_STATUSES = ["ready", "todo"] as const;
export type AssignableTaskStatus = (typeof ASSIGNABLE_TASK_STATUSES)[number];

// ---------------------------------------------------------------------------
// Orchestrator session status
// ---------------------------------------------------------------------------

export const ACTIVE_ORCHESTRATOR_STATUSES = [
  "spawning",
  "active",
  "idle",
] as const;
export type ActiveOrchestratorStatus =
  (typeof ACTIVE_ORCHESTRATOR_STATUSES)[number];

export const TERMINAL_ORCHESTRATOR_STATUSES = [
  "completed",
  "aborted",
  "error",
] as const;
export type TerminalOrchestratorStatus =
  (typeof TERMINAL_ORCHESTRATOR_STATUSES)[number];

export type OrchestratorStatus =
  | ActiveOrchestratorStatus
  | TerminalOrchestratorStatus;

// ---------------------------------------------------------------------------
// Assignment validation result
// ---------------------------------------------------------------------------

export type AssignmentValidation = {
  taskRecord: RecordId<"task", string>;
  workspaceRecord: RecordId<"workspace", string>;
  taskStatus: AssignableTaskStatus;
  title: string;
  repoPath: string;
};

// ---------------------------------------------------------------------------
// Assignment errors
// ---------------------------------------------------------------------------

export type AssignmentErrorCode =
  | "TASK_NOT_FOUND"
  | "TASK_NOT_ASSIGNABLE"
  | "AGENT_ALREADY_ACTIVE"
  | "WORKSPACE_MISMATCH"
  | "MISSING_TASK_ID"
  | "REPO_PATH_REQUIRED";

export type AssignmentError = {
  code: AssignmentErrorCode;
  message: string;
  httpStatus: number;
};

// ---------------------------------------------------------------------------
// DB row shapes (query results)
// ---------------------------------------------------------------------------

export type TaskRow = {
  id: RecordId<"task", string>;
  title: string;
  status: string;
  workspace: RecordId<"workspace", string>;
};

export type ActiveSessionRow = {
  id: RecordId<"agent_session", string>;
  orchestrator_status: string;
};
