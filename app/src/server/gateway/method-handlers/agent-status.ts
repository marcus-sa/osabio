/**
 * agent.status / agent.wait — backward-compat handlers for session lifecycle.
 *
 * agent.status: queries agent_session by runId, returns current status.
 * agent.wait: subscribes to session events and blocks until orchestrator_status
 *             becomes 'completed', then returns the final status.
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

// ---------------------------------------------------------------------------
// agent.wait — block until session completes via event subscription
// ---------------------------------------------------------------------------

const TERMINAL_STATUSES = new Set(["completed", "aborted", "error"]);

export function createAgentWaitHandler(): MethodHandler {
  return async (connection, params, deps) => {
    if (!connection.workspaceId || !connection.identityId) {
      return {
        ok: false,
        error: {
          code: "not_authenticated",
          message: "Connection must be authenticated to wait on agent session",
        },
      };
    }

    const waitParams = (params ?? {}) as AgentStatusParams;

    if (!waitParams.runId) {
      return {
        ok: false,
        error: {
          code: "invalid_frame",
          message: "agent.wait requires a 'runId' parameter",
        },
      };
    }

    // Check if session already completed before subscribing
    const sess = new RecordId("agent_session", waitParams.runId);
    const [row] = await deps.surreal.query<[AgentSessionRow[]]>(
      "SELECT orchestrator_status, started_at, ended_at FROM $sess;",
      { sess },
    );

    if (!row || row.length === 0) {
      return {
        ok: false,
        error: {
          code: "not_found",
          message: `No session found for runId: ${waitParams.runId}`,
        },
      };
    }

    const currentStatus = row[0].orchestrator_status ?? "spawning";

    if (TERMINAL_STATUSES.has(currentStatus)) {
      return {
        ok: true,
        payload: { runId: waitParams.runId, status: currentStatus },
      };
    }

    // Race between event subscription and DB polling.
    // Events may have already fired before this handler runs, so polling
    // ensures we catch completion even if the subscription misses past events.
    const pollForTerminalStatus = async (): Promise<string> => {
      const POLL_INTERVAL_MS = 50;
      const MAX_WAIT_MS = 30_000;
      const start = Date.now();

      while (Date.now() - start < MAX_WAIT_MS) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        const [polledRow] = await deps.surreal.query<[AgentSessionRow[]]>(
          "SELECT orchestrator_status, started_at, ended_at FROM $sess;",
          { sess },
        );
        const polledStatus = polledRow?.[0]?.orchestrator_status ?? "spawning";
        if (TERMINAL_STATUSES.has(polledStatus)) {
          return polledStatus;
        }
      }
      return "completed"; // fallback after max wait
    };

    const waitForEvent = async (): Promise<string> => {
      const events = deps.subscribeToSessionEvents(waitParams.runId);
      for await (const event of events) {
        if (event.type === "done" || event.type === "error") {
          const [finalRow] = await deps.surreal.query<[AgentSessionRow[]]>(
            "SELECT orchestrator_status, started_at, ended_at FROM $sess;",
            { sess },
          );
          return finalRow?.[0]?.orchestrator_status ?? "completed";
        }
      }
      return "completed";
    };

    const finalStatus = await Promise.race([waitForEvent(), pollForTerminalStatus()]);

    return {
      ok: true,
      payload: { runId: waitParams.runId, status: finalStatus },
    };
  };
}
