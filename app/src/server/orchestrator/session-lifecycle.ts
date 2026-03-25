import { RecordId, type Surreal } from "surrealdb";
import type { ShellExec } from "./worktree-manager";
import { createWorktree, removeWorktree } from "./worktree-manager";
import type { AssignmentResult } from "./assignment-guard";
import type { AssignmentError, OrchestratorStatus } from "./types";
import { TERMINAL_ORCHESTRATOR_STATUSES } from "./types";
import { startEventBridge, type SdkMessage } from "./event-bridge";
import type { StreamEvent } from "../../shared/contracts";
import type { StallDetectorHandle } from "./stall-detector";
import { getIntentById, updateIntentStatus } from "../intent/intent-queries";
import type { IntentStatus } from "../intent/types";
import { log } from "../telemetry/logger";
import type { SandboxAgentAdapter, SessionHandle } from "./sandbox-adapter";

// ---------------------------------------------------------------------------
// Types — exported for tests
// ---------------------------------------------------------------------------

export type SessionDeps = {
  surreal: Surreal;
  shellExec: ShellExec;
  brainBaseUrl: string;
};

export type SessionErrorCode =
  | "TASK_NOT_FOUND"
  | "TASK_NOT_ASSIGNABLE"
  | "AGENT_ALREADY_ACTIVE"
  | "WORKSPACE_MISMATCH"
  | "MISSING_TASK_ID"
  | "WORKTREE_ERROR"
  | "SESSION_NOT_FOUND"
  | "SESSION_ERROR"
  | "INTENT_NOT_AUTHORIZED";

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
  sessionHandle?: SessionHandle;
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

export type PromptSessionResult = SessionResult<{
  delivered: boolean;
}>;

// ---------------------------------------------------------------------------
// Event iteration — port (dependencies as function signatures)
// ---------------------------------------------------------------------------

export type EventIterationDeps = {
  emitEvent: (streamId: string, event: StreamEvent) => void;
  updateSessionStatus: (
    sessionId: string,
    status: OrchestratorStatus,
    error?: string,
  ) => Promise<void>;
  updateLastEventAt: (sessionId: string) => Promise<void>;
  getSessionStatus: (sessionId: string) => Promise<OrchestratorStatus>;
  startStallDetector: (sessionId: string, streamId: string) => StallDetectorHandle;
};

const TERMINAL_STATUSES: ReadonlySet<string> = new Set<string>(
  TERMINAL_ORCHESTRATOR_STATUSES,
);

/**
 * Iterates the SDK message stream, forwarding messages through the event
 * bridge. Transitions session to "active" on first message, starts stall
 * detection, and stops on terminal status or error.
 *
 * Returns a Promise that resolves when iteration ends (for testing).
 * In production, this is launched fire-and-forget.
 */
export function startEventIteration(
  deps: EventIterationDeps,
  messageStream: AsyncIterable<unknown>,
  streamId: string,
  sessionId: string,
): Promise<void> {
  const stallDetector = deps.startStallDetector(sessionId, streamId);

  const bridge = startEventBridge(
    {
      emitEvent: deps.emitEvent,
      updateLastEventAt: deps.updateLastEventAt,
    },
    streamId,
    sessionId,
    stallDetector,
  );

  let firstMessageReceived = false;
  let messageCount = 0;

  async function iterate(): Promise<void> {
    log.info("orchestrator.iteration", "Event iteration started, awaiting SDK messages", { sessionId, streamId });
    try {
      for await (const rawMessage of messageStream) {
        messageCount++;
        const msg = rawMessage as SdkMessage;
        log.info("orchestrator.iteration", `SDK message received (#${messageCount})`, {
          sessionId,
          messageType: msg.type,
          ...(msg.type === "result" ? { subtype: msg.subtype, ...(msg.subtype === "error" ? { error: msg.error } : {}) } : {}),
          ...(msg.type === "system" ? { subtype: msg.subtype } : {}),
        });

        // Check if session has reached terminal status
        const currentStatus = await deps.getSessionStatus(sessionId);
        if (TERMINAL_STATUSES.has(currentStatus)) {
          log.info("orchestrator.iteration", "Stopping: session reached terminal status", { sessionId, currentStatus });
          break;
        }

        // Transition to active on first message
        if (!firstMessageReceived) {
          firstMessageReceived = true;
          await deps.updateSessionStatus(sessionId, "active");
        }

        // Forward through event bridge (transform + emit + stall detection)
        bridge.handleMessage(msg);
      }
      log.info("orchestrator.iteration", "Event iteration ended normally", { sessionId, messageCount });
      // Transition to idle when stream ends normally and agent produced output
      if (firstMessageReceived) {
        const finalStatus = await deps.getSessionStatus(sessionId);
        if (!TERMINAL_STATUSES.has(finalStatus)) {
          await deps.updateSessionStatus(sessionId, "idle");
        }
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      log.error("orchestrator.iteration", "Agent message stream error", err, { sessionId, streamId });
      await deps.updateSessionStatus(sessionId, "error", errorMessage);
    } finally {
      if (!firstMessageReceived) {
        log.warn("orchestrator.iteration", "Agent stream ended with zero messages", { sessionId, streamId });
      }
      bridge.stop();
    }
  }

  return iterate();
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export function pickDefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result as Partial<T>;
}

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
  error_message?: string;
  external_session_id?: string;
  session_type?: string;
};

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

function requireWorkspace(session: SessionRow, sessionId: string): RecordId<"workspace", string> {
  if (!session.workspace) {
    throw new Error(`agent_session ${sessionId} missing workspace — data corruption`);
  }
  return session.workspace as RecordId<"workspace", string>;
}

function generateStreamId(sessionId: string): string {
  return `stream-${sessionId}`;
}

// ---------------------------------------------------------------------------
// createOrchestratorSession
// ---------------------------------------------------------------------------

type CreateSessionInput = {
  surreal: Surreal;
  shellExec: ShellExec;
  brainBaseUrl: string;
  workspaceId: string;
  taskId: string;
  intentId?: string;
  authToken?: string;
  adapter: SandboxAgentAdapter;
  sandboxAgentType?: string;
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
  // 0. Intent authorization gate (optional — backwards compatible)
  if (input.intentId) {
    const gateResult = await checkIntentAuthorization(input.surreal, input.intentId, input.workspaceId);
    if (!gateResult.ok) {
      return { ok: false, error: gateResult.error };
    }
  }

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

  return createSessionViaAdapter(input, validation);
}

// ---------------------------------------------------------------------------
// Intent authorization helpers
// ---------------------------------------------------------------------------

async function checkIntentAuthorization(
  surreal: Surreal,
  intentId: string,
  workspaceId: string,
): Promise<SessionResult<void>> {
  const intent = await getIntentById(surreal, intentId);
  if (!intent) {
    return {
      ok: false,
      error: {
        code: "INTENT_NOT_AUTHORIZED",
        message: `Intent ${intentId} not found`,
        httpStatus: 404,
      },
    };
  }

  // Validate workspace scope: intent must belong to the session's workspace
  const intentWorkspaceId = intent.workspace.id as string;
  if (intentWorkspaceId !== workspaceId) {
    return {
      ok: false,
      error: {
        code: "WORKSPACE_MISMATCH",
        message: `Intent ${intentId} belongs to workspace "${intentWorkspaceId}", not "${workspaceId}"`,
        httpStatus: 403,
      },
    };
  }

  const status = intent.status as IntentStatus;
  if (status !== "authorized") {
    return {
      ok: false,
      error: {
        code: "INTENT_NOT_AUTHORIZED",
        message: `Intent ${intentId} has status "${status}", expected "authorized"`,
        httpStatus: 403,
      },
    };
  }

  return { ok: true, value: undefined as void };
}

async function transitionIntentToExecuting(
  surreal: Surreal,
  intentId: string,
  sessionRecord: RecordId<"agent_session", string>,
): Promise<void> {
  await updateIntentStatus(surreal, intentId, "executing");

  const intentRecord = new RecordId("intent", intentId);
  // NOTE: `$session` is a SurrealDB protected variable — use `$sess` instead
  await surreal.query(
    "RELATE $intent->gates->$sess SET created_at = time::now();",
    { intent: intentRecord, sess: sessionRecord },
  );

  log.info("orchestrator.intent-gate", "Intent transitioned to executing with gates relation", {
    intentId,
    sessionId: sessionRecord.id as string,
  });
}

// ---------------------------------------------------------------------------
// Adapter-based session creation
// ---------------------------------------------------------------------------

function slugFromTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}

async function createSessionViaAdapter(
  input: CreateSessionInput,
  validation: import("./types").AssignmentValidation,
): Promise<OrchestratorSessionResult> {
  const adapter = input.adapter;
  const repoRoot = validation.repoPath;
  const taskSlug = `${slugFromTitle(validation.title)}-${crypto.randomUUID()}`;

  // 1. Create worktree for isolated agent work
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

  // 2. Create agent_session record
  const { session_id: agentSessionId } = await input.createAgentSession({
    surreal: input.surreal,
    agent: "claude",
    workspaceRecord: validation.workspaceRecord,
    taskId: input.taskId,
  });

  const streamId = generateStreamId(agentSessionId);

  // 3. Create session via adapter — agent works in worktree, not main repo
  let handle: SessionHandle;
  try {
    handle = await adapter.createSession({
      agent: input.sandboxAgentType ?? "claude",
      cwd: worktreePath,
    });
  } catch (err) {
    // Rollback: remove worktree and delete agent_session on adapter failure
    await removeWorktree(input.shellExec, repoRoot, branchName);
    const sessionRecord = new RecordId("agent_session", agentSessionId);
    await input.surreal.delete(sessionRecord);
    return {
      ok: false,
      error: worktreeError(`Failed to create sandbox session: ${err instanceof Error ? err.message : String(err)}`),
    };
  }

  // 4. Update agent_session with sandbox + worktree fields
  const sessionRecord = new RecordId("agent_session", agentSessionId);
  await input.surreal.update(sessionRecord).merge({
    orchestrator_status: "spawning" as OrchestratorStatus,
    stream_id: streamId,
    session_type: "sandbox_agent",
    provider: "local",
    external_session_id: handle.id,
    worktree_branch: branchName,
    worktree_path: worktreePath,
  });

  // 5. Transition intent to executing
  if (input.intentId) {
    await transitionIntentToExecuting(input.surreal, input.intentId, sessionRecord);
  }

  return {
    ok: true,
    value: {
      agentSessionId,
      streamId,
      worktreeBranch: branchName,
      sessionHandle: handle,
    },
  };
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
      ...pickDefined({
        worktreeBranch: session.worktree_branch,
        worktreePath: session.worktree_path,
        startedAt: session.started_at,
        lastEventAt: session.last_event_at,
        error: session.error_message,
      }),
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
  adapter?: SandboxAgentAdapter;
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

  // 1. Abort the agent process via adapter if available
  if (input.adapter && session.external_session_id) {
    try {
      await input.adapter.destroySession(session.external_session_id);
    } catch (err) {
      log.warn("orchestrator.abort", "Failed to destroy sandbox session", {
        sessionId: input.sessionId,
        externalSessionId: session.external_session_id,
        error: String(err),
      });
    }
  }

  // 2. Update orchestrator_status to aborted
  await input.surreal.update(sessionRecord).merge({
    orchestrator_status: "aborted" as OrchestratorStatus,
  });

  const workspaceRecord = requireWorkspace(session, input.sessionId);

  // 3. Remove worktree if branch name exists
  if (session.worktree_branch) {
    const repoRoot = await input.resolveRepoRoot(workspaceRecord);
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
  await input.endAgentSession({
    surreal: input.surreal,
    workspaceRecord,
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

  const workspaceRecord = requireWorkspace(session, input.sessionId);

  // 1. Update orchestrator_status to completed
  await input.surreal.update(sessionRecord).merge({
    orchestrator_status: "completed" as OrchestratorStatus,
  });

  // 2. (handle registry eliminated — no cleanup needed)

  // 3. End the agent session
  await input.endAgentSession({
    surreal: input.surreal,
    workspaceRecord,
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
const PROMPTABLE_STATUSES = new Set<OrchestratorStatus>(["spawning", "active", "idle"]);

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
  const workspaceRecord = requireWorkspace(session, input.sessionId);
  const repoRoot = await input.resolveRepoRoot(workspaceRecord);
  const diffResult = await input.getDiff(repoRoot, branchName);

  const diff = diffResult.ok
    ? diffResult.value
    : { files: [], rawDiff: "", stats: { filesChanged: 0, insertions: 0, deletions: 0 } };

  // Get task title
  const taskId = session.task_id ? session.task_id.id : "";
  const taskTitle = taskId ? await input.getTaskTitle(taskId) : "";

  return {
    ok: true,
    value: {
      taskTitle,
      diff,
      session: {
        orchestratorStatus: status,
        ...pickDefined({
          worktreeBranch: session.worktree_branch,
          startedAt: session.started_at,
          lastEventAt: session.last_event_at,
        }),
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

// ---------------------------------------------------------------------------
// sendSessionPrompt
// ---------------------------------------------------------------------------

type SendPromptInput = {
  surreal: Surreal;
  sessionId: string;
  text: string;
  adapter: SandboxAgentAdapter;
};

export async function sendSessionPrompt(
  input: SendPromptInput,
): Promise<PromptSessionResult> {
  const lookup = await lookupSession(input.surreal, input.sessionId);
  if (!lookup.ok) {
    return { ok: false, error: lookup.error };
  }
  const { session, status } = lookup;

  if (!PROMPTABLE_STATUSES.has(status)) {
    // Terminal sessions return 404 (session is "gone"), non-terminal return 409 (conflict)
    if (TERMINAL_STATUSES.has(status)) {
      return { ok: false, error: sessionNotFound(input.sessionId) };
    }
    return { ok: false, error: sessionStateConflict(input.sessionId, status, "prompt") };
  }

  if (!session.external_session_id) {
    return {
      ok: false,
      error: {
        code: "SESSION_ERROR",
        message: `Session ${input.sessionId} has no external_session_id — cannot deliver prompt`,
        httpStatus: 500,
      },
    };
  }

  try {
    const handle = await input.adapter.resumeSession(session.external_session_id);
    await handle.prompt([{ type: "text", text: input.text }]);
    return { ok: true, value: { delivered: true } };
  } catch (err) {
    return {
      ok: false,
      error: {
        code: "SESSION_ERROR",
        message: `Failed to deliver prompt: ${err instanceof Error ? err.message : String(err)}`,
        httpStatus: 500,
      },
    };
  }
}
