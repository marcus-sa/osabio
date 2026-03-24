/**
 * agent.status — backward-compat handler that queries agent_session by runId.
 *
 * Returns the session's current orchestrator status, mapped to the
 * client-facing status vocabulary.
 */
import { RecordId } from "surrealdb";
import type { MethodHandler } from "../method-dispatch";

// ---------------------------------------------------------------------------
// Params
// ---------------------------------------------------------------------------

type AgentStatusParams = {
  readonly runId?: string;
};

// ---------------------------------------------------------------------------
// DB row shape (SELECT projection)
// ---------------------------------------------------------------------------

type AgentSessionRow = {
  readonly orchestrator_status?: string;
  readonly started_at: string;
  readonly ended_at?: string;
};

// ---------------------------------------------------------------------------
// Handler factory
// ---------------------------------------------------------------------------

export function createAgentStatusHandler(): MethodHandler {
  return async (connection, params, deps) => {
    if (!connection.workspaceId || !connection.identityId) {
      return {
        ok: false,
        error: {
          code: "not_authenticated",
          message: "Connection must be authenticated to query agent status",
        },
      };
    }

    const statusParams = (params ?? {}) as AgentStatusParams;

    if (!statusParams.runId) {
      return {
        ok: false,
        error: {
          code: "invalid_frame",
          message: "agent.status requires a 'runId' parameter",
        },
      };
    }

    const sess = new RecordId("agent_session", statusParams.runId);
    const [row] = await deps.surreal.query<[AgentSessionRow[]]>(
      "SELECT orchestrator_status, started_at, ended_at FROM $sess;",
      { sess },
    );

    if (!row || row.length === 0) {
      return {
        ok: false,
        error: {
          code: "not_found",
          message: `No session found for runId: ${statusParams.runId}`,
        },
      };
    }

    const session = row[0];
    const status = session.orchestrator_status ?? "spawning";

    return {
      ok: true,
      payload: {
        runId: statusParams.runId,
        status,
        startedAt: session.started_at,
        ...(session.ended_at !== undefined ? { endedAt: session.ended_at } : {}),
      },
    };
  };
}
