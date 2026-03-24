/**
 * Session management handlers -- sessions.list and sessions.patch.
 *
 * Pure handlers that delegate to GatewayDeps ports for all DB access.
 * No direct IO imports.
 */
import type { MethodHandler } from "../method-dispatch";

// ---------------------------------------------------------------------------
// sessions.list — returns sessions for the authenticated identity
// ---------------------------------------------------------------------------

type SessionsListParams = {
  readonly status?: "active" | "completed" | "all";
  readonly limit?: number;
};

export function createSessionsListHandler(): MethodHandler {
  return async (connection, params, deps) => {
    const workspaceId = connection.workspaceId;
    const identityId = connection.identityId;

    if (!workspaceId || !identityId) {
      return {
        ok: false,
        error: {
          code: "not_authenticated",
          message: "Connection must be authenticated to list sessions",
        },
      };
    }

    const listParams = (params ?? {}) as SessionsListParams;
    const sessions = await deps.listSessions(
      workspaceId,
      identityId,
      listParams.status,
      listParams.limit,
    );

    return {
      ok: true,
      payload: { sessions },
    };
  };
}

// ---------------------------------------------------------------------------
// sessions.patch — updates session properties mid-flight
// ---------------------------------------------------------------------------

type SessionsPatchParams = {
  readonly runId?: string;
  readonly model?: string;
  readonly thinkingLevel?: string;
  readonly verbose?: boolean;
};

export function createSessionsPatchHandler(): MethodHandler {
  return async (connection, params, deps) => {
    if (!connection.workspaceId || !connection.identityId) {
      return {
        ok: false,
        error: {
          code: "not_authenticated",
          message: "Connection must be authenticated to patch sessions",
        },
      };
    }

    const patchParams = (params ?? {}) as SessionsPatchParams;

    if (!patchParams.runId) {
      return {
        ok: false,
        error: {
          code: "invalid_frame",
          message: "sessions.patch requires a 'runId' parameter",
        },
      };
    }

    const { model, thinkingLevel, verbose } = patchParams;
    const patch = {
      ...(model !== undefined ? { model } : {}),
      ...(thinkingLevel !== undefined ? { thinkingLevel } : {}),
      ...(verbose !== undefined ? { verbose } : {}),
    };

    const result = await deps.patchSession(patchParams.runId, patch);

    return {
      ok: true,
      payload: result,
    };
  };
}
