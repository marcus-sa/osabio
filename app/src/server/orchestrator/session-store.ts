/**
 * SurrealDB CRUD operations for sandbox agent sessions.
 *
 * Pure query builders — each function accepts a Surreal instance
 * as its first parameter (dependency injection, no module-level singleton).
 *
 * Replaces the in-memory handleRegistry for sandbox session state.
 */
import { RecordId, type Surreal } from "surrealdb";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CreateSandboxSessionInput = {
  surreal: Surreal;
  workspaceId: string;
  agent: string;
  provider: string;
  taskId?: string;
};

export type CreateSandboxSessionResult = {
  sessionId: string;
  streamId: string;
};

export type SandboxSessionRecord = {
  id: RecordId<"agent_session", string>;
  workspace: RecordId<"workspace", string>;
  session_type: string;
  provider?: string;
  orchestrator_status: string;
  external_session_id?: string;
  agent: string;
  created_at: string;
  started_at: string;
  ended_at?: string;
  last_event_at?: string;
};

// ---------------------------------------------------------------------------
// createSandboxSession
// ---------------------------------------------------------------------------

export async function createSandboxSession(
  input: CreateSandboxSessionInput,
): Promise<CreateSandboxSessionResult> {
  const sessionId = crypto.randomUUID();
  const streamId = `stream-${sessionId}`;
  const record = new RecordId("agent_session", sessionId);
  const workspace = new RecordId("workspace", input.workspaceId);

  const vars: Record<string, unknown> = {
    record,
    agent: input.agent,
    workspace,
    session_type: "sandbox_agent",
    provider: input.provider,
    orchestrator_status: "running",
    stream_id: streamId,
    started_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
  };

  if (input.taskId) {
    vars.task_id = new RecordId("task", input.taskId);
  }

  await input.surreal.query(
    `CREATE $record CONTENT {
      agent: $agent,
      workspace: $workspace,
      session_type: $session_type,
      provider: $provider,
      orchestrator_status: $orchestrator_status,
      stream_id: $stream_id,
      started_at: $started_at,
      created_at: $created_at
    };`,
    vars,
  );

  return { sessionId, streamId };
}

// ---------------------------------------------------------------------------
// updateSessionStatus
// ---------------------------------------------------------------------------

export async function updateSessionStatus(
  surreal: Surreal,
  sessionId: string,
  status: string,
  errorMessage?: string,
): Promise<void> {
  const record = new RecordId("agent_session", sessionId);

  const vars: Record<string, unknown> = {
    record,
    status,
  };

  const setClause = errorMessage
    ? "orchestrator_status = $status, error_message = $error_message, ended_at = time::now()"
    : status === "completed" || status === "aborted" || status === "error"
      ? "orchestrator_status = $status, ended_at = time::now()"
      : "orchestrator_status = $status";

  if (errorMessage) {
    vars.error_message = errorMessage;
  }

  await surreal.query(
    `UPDATE $record SET ${setClause};`,
    vars,
  );
}

// ---------------------------------------------------------------------------
// getActiveSandboxSessions
// ---------------------------------------------------------------------------

export async function getActiveSandboxSessions(
  surreal: Surreal,
  workspaceId: string,
): Promise<SandboxSessionRecord[]> {
  const workspace = new RecordId("workspace", workspaceId);

  const result = await surreal.query<[SandboxSessionRecord[]]>(
    `SELECT * FROM agent_session
     WHERE workspace = $workspace
       AND session_type = $session_type
       AND orchestrator_status IN $active_statuses
     ORDER BY created_at DESC;`,
    {
      workspace,
      session_type: "sandbox_agent",
      active_statuses: ["running", "idle", "restoring"],
    },
  );

  return result[0] ?? [];
}

// ---------------------------------------------------------------------------
// updateExternalSessionId
// ---------------------------------------------------------------------------

export async function updateExternalSessionId(
  surreal: Surreal,
  sessionId: string,
  newExternalId: string,
): Promise<void> {
  const record = new RecordId("agent_session", sessionId);

  await surreal.query(
    `UPDATE $record SET external_session_id = $external_session_id;`,
    {
      record,
      external_session_id: newExternalId,
    },
  );
}
