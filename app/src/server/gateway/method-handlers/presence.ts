/**
 * Presence method handler — queries the presence registry for online devices.
 *
 * Returns all devices in the same workspace as the requesting connection.
 * Pure handler — reads from the registry, no IO.
 */
import type { MethodHandler } from "../method-dispatch";
import type { PresenceRegistry } from "../presence-registry";

// ---------------------------------------------------------------------------
// Factory — takes the registry as a dependency
// ---------------------------------------------------------------------------

export function createPresenceHandler(
  registry: PresenceRegistry,
): MethodHandler {
  return async (connection) => {
    if (!connection.workspaceId) {
      return {
        ok: false,
        error: {
          code: "not_authenticated",
          message: "Connection is not authenticated — send connect first",
        },
      };
    }

    const devices = registry.queryByWorkspace(connection.workspaceId);

    return {
      ok: true,
      payload: { devices },
    };
  };
}
