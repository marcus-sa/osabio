/**
 * Gateway — public API for route registration and WebSocket handler config.
 *
 * The gateway is a thin protocol adapter at /api/gateway. Non-WebSocket
 * requests receive 426 Upgrade Required. WebSocket connections enter the
 * Gateway Protocol v3 state machine.
 *
 * Pure core (connection.ts) handles state transitions. This module is the
 * impure shell that wires Bun's WebSocket handlers to the pure state machine.
 */
import { jsonResponse } from "../http/response";
import { createConnection, transition } from "./connection";
import type { GatewayConnection } from "./types";
import type { Server } from "bun";

// ---------------------------------------------------------------------------
// WebSocket data attached to each connection via server.upgrade()
// ---------------------------------------------------------------------------

export type GatewayWebSocketData = {
  readonly connection: GatewayConnection;
};

// ---------------------------------------------------------------------------
// Route handler — upgrades WebSocket or returns 426
// ---------------------------------------------------------------------------

function handleGatewayRequest(
  request: Request,
  server: Server<GatewayWebSocketData>,
): Response | undefined {
  // Check for WebSocket upgrade header
  const upgradeHeader = request.headers.get("upgrade");
  if (upgradeHeader?.toLowerCase() === "websocket") {
    const connection = createConnection();
    const upgraded = server.upgrade(request, {
      data: { connection },
    });
    if (upgraded) {
      // Return undefined to signal Bun that the upgrade was handled
      return undefined;
    }
    // Upgrade failed — fall through to 426
  }

  return jsonResponse(
    { error: "upgrade_required", message: "This endpoint requires a WebSocket connection" },
    426,
  );
}

// ---------------------------------------------------------------------------
// WebSocket handlers — Bun.serve websocket config
// ---------------------------------------------------------------------------

export function createGatewayWebSocketHandlers() {
  return {
    open(ws: { data: GatewayWebSocketData; send: (msg: string) => void }) {
      const { connection } = ws.data;
      const result = transition(connection, { type: "ws_open" });
      // Update the connection state on the ws data (Bun allows mutation of ws.data)
      (ws.data as { connection: GatewayConnection }).connection = result.connection;
    },

    message(
      ws: { data: GatewayWebSocketData; send: (msg: string) => void },
      message: string | Buffer,
    ) {
      const { connection } = ws.data;
      const data = typeof message === "string" ? message : message.toString();
      const result = transition(connection, { type: "ws_message", data });
      (ws.data as { connection: GatewayConnection }).connection = result.connection;

      // Process effects — message dispatch will be implemented in step 01-03
      for (const effect of result.effects) {
        if (effect.type === "send_frame") {
          ws.send(effect.frame);
        }
      }
    },

    close(
      ws: { data: GatewayWebSocketData },
      code: number,
      reason: string,
    ) {
      const { connection } = ws.data;
      const result = transition(connection, { type: "ws_close", code, reason });
      (ws.data as { connection: GatewayConnection }).connection = result.connection;
    },
  };
}

// ---------------------------------------------------------------------------
// Public API — route registration record for Bun.serve routes object
// ---------------------------------------------------------------------------

export function createGatewayRoutes() {
  return {
    "/api/gateway": {
      GET: handleGatewayRequest,
    },
  } as const;
}
