/**
 * Tools catalog handler -- returns the agent's granted tools.
 *
 * Delegates to the listGrantedTools port, scoped to the connection's
 * workspace and identity. Pure handler: no direct IO imports.
 */
import type { MethodHandler } from "../method-dispatch";

// ---------------------------------------------------------------------------
// Handler factory
// ---------------------------------------------------------------------------

export function createToolsCatalogHandler(): MethodHandler {
  return async (connection, _params, deps) => {
    const workspaceId = connection.workspaceId;
    const identityId = connection.identityId;

    if (!workspaceId || !identityId) {
      return {
        ok: false,
        error: {
          code: "not_authenticated",
          message: "Connection must be authenticated to list tools",
        },
      };
    }

    const tools = await deps.listGrantedTools(workspaceId, identityId);

    return {
      ok: true,
      payload: { tools },
    };
  };
}
