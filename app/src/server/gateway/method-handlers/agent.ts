/**
 * Agent method handler — delegates to the orchestrator.
 *
 * Validates the task param, loads workspace context summary,
 * assigns the task to create a session, and returns the run details.
 */
import type { MethodHandler } from "../method-dispatch";

// ---------------------------------------------------------------------------
// Agent params shape
// ---------------------------------------------------------------------------

type AgentParams = {
  readonly task?: string;
  readonly model?: string;
  readonly maxTokens?: number;
};

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export function createAgentHandler(): MethodHandler {
  return async (connection, params, deps) => {
    const agentParams = (params ?? {}) as AgentParams;

    if (!agentParams.task || agentParams.task.trim() === "") {
      return {
        ok: false,
        error: {
          code: "invalid_frame",
          message: "agent method requires a 'task' parameter",
        },
      };
    }

    // Connection must have workspace and identity from connect auth
    if (!connection.workspaceId || !connection.identityId) {
      return {
        ok: false,
        error: {
          code: "not_authenticated",
          message: "Connection is not authenticated — send connect first",
        },
      };
    }

    const workspaceId = connection.workspaceId;
    const identityId = connection.identityId;
    const task = agentParams.task.trim();

    // Load context summary from workspace
    const contextSummary = await deps.loadContext(workspaceId, task);

    // Assign task to create session
    const { runId, sessionId } = await deps.assignTask(
      workspaceId,
      identityId,
      task,
      agentParams.model || agentParams.maxTokens
        ? {
            model: agentParams.model,
            maxTokens: agentParams.maxTokens,
          }
        : undefined,
    );

    return {
      ok: true,
      payload: {
        runId,
        sessionId,
        contextSummary,
      },
    };
  };
}
