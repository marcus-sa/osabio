/**
 * Gateway — public API for route registration.
 *
 * The gateway is a thin protocol adapter at /api/gateway. Non-WebSocket
 * requests receive 426 Upgrade Required. WebSocket connections enter the
 * Gateway Protocol v3 state machine.
 */
import { withTracing } from "../http/instrumentation";
import { jsonResponse } from "../http/response";

// ---------------------------------------------------------------------------
// Route handler — returns 426 for non-WebSocket HTTP requests
// ---------------------------------------------------------------------------

function handleGatewayHttp(): Response {
  return jsonResponse(
    { error: "upgrade_required", message: "This endpoint requires a WebSocket connection" },
    426,
  );
}

// ---------------------------------------------------------------------------
// Public API — route registration record for Bun.serve routes object
// ---------------------------------------------------------------------------

export function createGatewayRoutes() {
  return {
    "/api/gateway": {
      GET: withTracing("GET /api/gateway", "GET", handleGatewayHttp),
    },
  } as const;
}
