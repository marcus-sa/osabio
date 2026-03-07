import { RecordId, type Surreal } from "surrealdb";
import type { OpencodeConfig } from "./config-builder";
import { buildOpencodeConfig } from "./config-builder";
import type { ShellExec } from "./worktree-manager";
import { createWorktree, removeWorktree } from "./worktree-manager";
import type { AssignmentResult } from "./assignment-guard";
import type { AssignmentError, OrchestratorStatus } from "./types";

// ---------------------------------------------------------------------------
// Types — exported for tests
// ---------------------------------------------------------------------------

export type OpenCodeHandle = {
  sessionId: string;
  abort: () => void;
};

export type SessionDeps = {
  surreal: Surreal;
  shellExec: ShellExec;
  brainBaseUrl: string;
  spawnOpenCode?: (
    config: OpencodeConfig,
    worktreePath: string,
  ) => Promise<OpenCodeHandle>;
};

export type SessionErrorCode =
  | "TASK_NOT_FOUND"
  | "TASK_NOT_ASSIGNABLE"
  | "AGENT_ALREADY_ACTIVE"
  | "WORKSPACE_MISMATCH"
  | "MISSING_TASK_ID"
  | "WORKTREE_ERROR"
  | "SESSION_NOT_FOUND"
  | "SESSION_ERROR";

export type SessionError = {
  code: SessionErrorCode;
  message: string;
  httpStatus: number;
};

export type SessionResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: SessionError };

export type OrchestratorSessionResult = SessionResult<{
  agentSessionId: string;
  streamId: string;
  worktreeBranch: string;
}>;

export type SessionStatusResult = SessionResult<{
  orchestratorStatus: OrchestratorStatus;
  worktreeBranch?: string;
  worktreePath?: string;
  lastEventAt?: string;
  startedAt?: string;
  error?: string;
}>;

export type AbortSessionResult = SessionResult<{
  aborted: boolean;
  sessionId: string;
}>;

export type AcceptSessionResult = SessionResult<{
  accepted: boolean;
  sessionId: string;
}>;

export type ReviewResult = SessionResult<{
  taskTitle: string;
  diff: import("./worktree-manager").DiffResult;
  session: {
    orchestratorStatus: string;
    worktreeBranch?: string;
    startedAt?: string;
    lastEventAt?: string;
    toolCallCount?: number;
    filesEdited?: number;
  };
}>;

export type RejectSessionResult = SessionResult<{
  rejected: boolean;
  continuing: boolean;
}>;

// ---------------------------------------------------------------------------
// In-memory handle registry — maps agentSessionId to OpenCodeHandle
// ---------------------------------------------------------------------------

const handleRegistry = new Map<string, OpenCodeHandle>();

// Exported for testing cleanup
export function clearHandleRegistry(): void {
  handleRegistry.clear();
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function sessionNotFound(sessionId: string): SessionError {
  return {
    code: "SESSION_NOT_FOUND",
    message: `Session not found: ${sessionId}`,
    httpStatus: 404,
  };
}

function worktreeError(message: string): SessionError {
  return {
    code: "WORKTREE_ERROR",
    message,
    httpStatus: 500,
  };
}

function fromAssignmentError(error: AssignmentError): SessionError {
  return {
    code: error.code as SessionErrorCode,
    message: error.message,
    httpStatus: error.httpStatus,
  };
}

type SessionLookup =
  | { ok: true; session: SessionRow; record: RecordId<"agent_session", string>; status: OrchestratorStatus }
  | { ok: false; error: SessionError };

async function lookupSession(
  surreal: Surreal,
  sessionId: string,
): Promise<SessionLookup> {
  const record = new RecordId("agent_session", sessionId);
  const session = await surreal.select<SessionRow>(record);
  if (!session) {
    return { ok: false, error: sessionNotFound(sessionId) };
  }
  if (!session.orchestrator_status) {
    throw new Error(`agent_session ${sessionId} missing orchestrator_status — data corruption`);
  }
  const status = session.orchestrator_status as OrchestratorStatus;
  return { ok: true, session, record, status };
}

function generateStreamId(sessionId: string): string {
  return `stream-${sessionId}`;
}

function slugFromTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}

// ---------------------------------------------------------------------------
// Session row shape (DB query result)
// ---------------------------------------------------------------------------

type SessionRow = {
  id: RecordId<"agent_session", string>;
  orchestrator_status?: string;
  worktree_branch?: string;
  worktree_path?: string;
  started_at?: string;
  last_event_at?: string;
  task_id?: RecordId<"task", string>;
  workspace?: RecordId<"workspace", string>;
  error?: string;
};

// ---------------------------------------------------------------------------
// createOrchestratorSession
// ---------------------------------------------------------------------------

type CreateSessionInput = {
  surreal: Surreal;
  shellExec: ShellExec;
  brainBaseUrl: string;
  workspaceId: string;
  taskId: string;
  authToken: string;
  spawnOpenCode?: (
    config: OpencodeConfig,
    worktreePath: string,
  ) => Promise<OpenCodeHandle>;
  validateAssignment: (
    surreal: Surreal,
    workspaceId: string,
    taskId: string,
  ) => Promise<AssignmentResult>;
  createAgentSession: (input: {
    surreal: Surreal;
    agent: string;
    workspaceRecord: RecordId<"workspace", string>;
    taskId?: string;
  }) => Promise<{ session_id: string }>;
};

export async function createOrchestratorSession(
  input: CreateSessionInput,
): Promise<OrchestratorSessionResult> {
  // 1. Validate assignment eligibility
  const assignmentResult = await input.validateAssignment(
    input.surreal,
    input.workspaceId,
    input.taskId,
  );

  if (!assignmentResult.ok) {
    return { ok: false, error: fromAssignmentError(assignmentResult.error) };
  }

  const { validation } = assignmentResult;
  const taskSlug = slugFromTitle(validation.title);
  const repoRoot = validation.repoPath;

  // 2. Create worktree
  const worktreeResult = await createWorktree(
    input.shellExec,
    repoRoot,
    taskSlug,
  );

  if (!worktreeResult.ok) {
    return {
      ok: false,
      error: worktreeError(worktreeResult.error.message),
    };
  }

  const { branchName, worktreePath } = worktreeResult.value;

  // 3. Create agent_session record
  const { session_id: agentSessionId } = await input.createAgentSession({
    surreal: input.surreal,
    agent: "opencode",
    workspaceRecord: validation.workspaceRecord,
    taskId: input.taskId,
  });

  const streamId = generateStreamId(agentSessionId);

  // 4. Build config and spawn OpenCode
  const config = buildOpencodeConfig({
    brainBaseUrl: input.brainBaseUrl,
    workspaceId: input.workspaceId,
    authToken: input.authToken,
  });

  const spawnFn = input.spawnOpenCode ?? defaultSpawnOpenCode;
  let handle: OpenCodeHandle;
  try {
    handle = await spawnFn(config, worktreePath);
  } catch (err) {
    // Rollback: remove worktree and delete agent_session on spawn failure
    await removeWorktree(input.shellExec, repoRoot, branchName);
    const sessionRecord = new RecordId("agent_session", agentSessionId);
    await input.surreal.delete(sessionRecord);
    return {
      ok: false,
      error: worktreeError(`Failed to spawn OpenCode: ${err instanceof Error ? err.message : String(err)}`),
    };
  }

  // 5. Register handle for later abort
  handleRegistry.set(agentSessionId, handle);

  // 6. Update agent_session with orchestrator fields
  const sessionRecord = new RecordId("agent_session", agentSessionId);
  await input.surreal.update(sessionRecord).merge({
    orchestrator_status: "spawning" as OrchestratorStatus,
    worktree_branch: branchName,
    worktree_path: worktreePath,
    opencode_session_id: handle.sessionId,
    stream_id: streamId,
  });

  return {
    ok: true,
    value: {
      agentSessionId,
      streamId,
      worktreeBranch: branchName,
    },
  };
}

// Default spawn -- placeholder for production use
async function defaultSpawnOpenCode(
  _config: OpencodeConfig,
  _worktreePath: string,
): Promise<OpenCodeHandle> {
  throw new Error(
    "spawnOpenCode not provided -- must be injected for production use",
  );
}

// ---------------------------------------------------------------------------
// getOrchestratorSessionStatus
// ---------------------------------------------------------------------------

type GetStatusInput = {
  surreal: Surreal;
  sessionId: string;
};

export async function getOrchestratorSessionStatus(
  input: GetStatusInput,
): Promise<SessionStatusResult> {
  const lookup = await lookupSession(input.surreal, input.sessionId);
  if (!lookup.ok) {
    return { ok: false, error: lookup.error };
  }
  const { session } = lookup;

  return {
    ok: true,
    value: {
      orchestratorStatus: lookup.status,
      ...(session.worktree_branch ? { worktreeBranch: session.worktree_branch } : {}),
      ...(session.worktree_path ? { worktreePath: session.worktree_path } : {}),
      ...(session.started_at ? { startedAt: session.started_at } : {}),
      ...(session.last_event_at ? { lastEventAt: session.last_event_at } : {}),
      ...(session.error ? { error: session.error } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// abortOrchestratorSession
// ---------------------------------------------------------------------------

type AbortSessionInput = {
  surreal: Surreal;
  shellExec: ShellExec;
  resolveRepoRoot: (workspaceRecord: RecordId<"workspace", string>) => Promise<string>;
  sessionId: string;
  endAgentSession: (input: {
    surreal: Surreal;
    workspaceRecord: RecordId<"workspace", string>;
    sessionId: string;
    summary: string;
  }) => Promise<{ session_id: string; ended: boolean }>;
};

export async function abortOrchestratorSession(
  input: AbortSessionInput,
): Promise<AbortSessionResult> {
  const lookup = await lookupSession(input.surreal, input.sessionId);
  if (!lookup.ok) {
    return { ok: false, error: lookup.error };
  }
  const { session, record: sessionRecord } = lookup;

  // 1. Kill the OpenCode process if handle exists
  const handle = handleRegistry.get(input.sessionId);
  if (handle) {
    handle.abort();
    handleRegistry.delete(input.sessionId);
  }

  // 2. Update orchestrator_status to aborted
  await input.surreal.update(sessionRecord).merge({
    orchestrator_status: "aborted" as OrchestratorStatus,
  });

  // 3. Remove worktree if branch name exists
  if (session.worktree_branch && session.workspace) {
    const repoRoot = await input.resolveRepoRoot(session.workspace as RecordId<"workspace", string>);
    await removeWorktree(input.shellExec, repoRoot, session.worktree_branch);
  }

  // 4. Return task to ready
  if (session.task_id) {
    await input.surreal.update(session.task_id).merge({
      status: "ready",
      updated_at: new Date(),
    });
  }

  // 5. End the agent session
  if (!session.workspace) {
    throw new Error(`agent_session ${input.sessionId} missing workspace — data corruption`);
  }
  await input.endAgentSession({
    surreal: input.surreal,
    workspaceRecord: session.workspace as RecordId<"workspace", string>,
    sessionId: input.sessionId,
    summary: "Session aborted",
  });

  return {
    ok: true,
    value: {
      aborted: true,
      sessionId: input.sessionId,
    },
  };
}

// ---------------------------------------------------------------------------
// acceptOrchestratorSession
// ---------------------------------------------------------------------------

type AcceptSessionInput = {
  surreal: Surreal;
  sessionId: string;
  summary: string;
  endAgentSession: (input: {
    surreal: Surreal;
    workspaceRecord: RecordId<"workspace", string>;
    sessionId: string;
    summary: string;
  }) => Promise<{ session_id: string; ended: boolean }>;
};

export async function acceptOrchestratorSession(
  input: AcceptSessionInput,
): Promise<AcceptSessionResult> {
  const lookup = await lookupSession(input.surreal, input.sessionId);
  if (!lookup.ok) {
    return { ok: false, error: lookup.error };
  }
  const { session, record: sessionRecord, status } = lookup;

  if (!ACCEPTABLE_STATUSES.has(status)) {
    return { ok: false, error: sessionStateConflict(input.sessionId, status, "accept") };
  }

  // 1. Update orchestrator_status to completed
  await input.surreal.update(sessionRecord).merge({
    orchestrator_status: "completed" as OrchestratorStatus,
  });

  // 2. Mark task as done
  if (session.task_id) {
    await input.surreal.update(session.task_id).merge({
      status: "done",
      updated_at: new Date(),
    });
  }

  // 3. Clean up handle registry
  handleRegistry.delete(input.sessionId);

  // 4. End the agent session
  if (!session.workspace) {
    throw new Error(`agent_session ${input.sessionId} missing workspace — data corruption`);
  }
  await input.endAgentSession({
    surreal: input.surreal,
    workspaceRecord: session.workspace as RecordId<"workspace", string>,
    sessionId: input.sessionId,
    summary: input.summary,
  });

  return {
    ok: true,
    value: {
      accepted: true,
      sessionId: input.sessionId,
    },
  };
}

// ---------------------------------------------------------------------------
// State guard helpers
// ---------------------------------------------------------------------------

const REVIEWABLE_STATUSES = new Set<OrchestratorStatus>(["idle", "completed"]);
const REJECTABLE_STATUSES = new Set<OrchestratorStatus>(["idle"]);
const ACCEPTABLE_STATUSES = new Set<OrchestratorStatus>(["idle", "completed"]);

function sessionStateConflict(sessionId: string, currentStatus: string, action: string): SessionError {
  return {
    code: "SESSION_ERROR",
    message: `Cannot ${action} session ${sessionId}: current status is ${currentStatus}`,
    httpStatus: 409,
  };
}

function sessionAborted(sessionId: string): SessionError {
  return {
    code: "SESSION_ERROR",
    message: `Session ${sessionId} has been aborted`,
    httpStatus: 409,
  };
}

// ---------------------------------------------------------------------------
// getOrchestratorReview
// ---------------------------------------------------------------------------

type GetReviewInput = {
  surreal: Surreal;
  sessionId: string;
  getDiff: (repoRoot: string, branchName: string) => Promise<import("./worktree-manager").WorktreeResult<import("./worktree-manager").DiffResult>>;
  resolveRepoRoot: (workspaceRecord: RecordId<"workspace", string>) => Promise<string>;
  getTaskTitle: (taskId: string) => Promise<string>;
};

export async function getOrchestratorReview(
  input: GetReviewInput,
): Promise<ReviewResult> {
  const lookup = await lookupSession(input.surreal, input.sessionId);
  if (!lookup.ok) {
    return { ok: false, error: lookup.error };
  }
  const { session, status } = lookup;

  if (status === "aborted") {
    return { ok: false, error: sessionAborted(input.sessionId) };
  }

  if (!REVIEWABLE_STATUSES.has(status)) {
    return { ok: false, error: sessionStateConflict(input.sessionId, status, "review") };
  }

  // Get diff from the branch
  const branchName = session.worktree_branch ?? "";
  if (!session.workspace) {
    throw new Error(`agent_session ${input.sessionId} missing workspace — data corruption`);
  }
  const repoRoot = await input.resolveRepoRoot(session.workspace as RecordId<"workspace", string>);
  const diffResult = await input.getDiff(repoRoot, branchName);

  const diff = diffResult.ok
    ? diffResult.value
    : { files: [], rawDiff: "", stats: { filesChanged: 0, insertions: 0, deletions: 0 } };

  // Get task title
  const taskId = session.task_id ? (session.task_id.id as string) : "";
  const taskTitle = taskId ? await input.getTaskTitle(taskId) : "";

  return {
    ok: true,
    value: {
      taskTitle,
      diff,
      session: {
        orchestratorStatus: status,
        ...(session.worktree_branch ? { worktreeBranch: session.worktree_branch } : {}),
        ...(session.started_at ? { startedAt: session.started_at } : {}),
        ...(session.last_event_at ? { lastEventAt: session.last_event_at } : {}),
      },
    },
  };
}

// ---------------------------------------------------------------------------
// rejectOrchestratorSession
// ---------------------------------------------------------------------------

type RejectSessionInput = {
  surreal: Surreal;
  sessionId: string;
  feedback: string;
};

export async function rejectOrchestratorSession(
  input: RejectSessionInput,
): Promise<RejectSessionResult> {
  const lookup = await lookupSession(input.surreal, input.sessionId);
  if (!lookup.ok) {
    return { ok: false, error: lookup.error };
  }
  const { session, record: sessionRecord, status } = lookup;

  if (!REJECTABLE_STATUSES.has(status)) {
    return { ok: false, error: sessionStateConflict(input.sessionId, status, "reject") };
  }

  // 1. Update session status to active (agent resumes work)
  await input.surreal.update(sessionRecord).merge({
    orchestrator_status: "active" as OrchestratorStatus,
    last_feedback: input.feedback,
  });

  // 2. Return task to in_progress
  if (session.task_id) {
    await input.surreal.update(session.task_id).merge({
      status: "in_progress",
      updated_at: new Date(),
    });
  }

  return {
    ok: true,
    value: {
      rejected: true,
      continuing: true,
    },
  };
}
