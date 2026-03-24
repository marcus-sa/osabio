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
import { createConnection, transition, activateConnection } from "./connection";
import { parseFrame, isParseError, serializeFrame } from "./protocol";
import type { EventFrame, ResponseFrame } from "./protocol";
import { createMethodDispatch, type MethodHandlerMap } from "./method-dispatch";
import { createConnectHandler, resolveConnectionUpdate } from "./method-handlers/connect";
import { createAgentHandler } from "./method-handlers/agent";
import { mapStreamEventToGatewayEvent } from "./event-adapter";
import type { GatewayConnection, GatewayDeps } from "./types";
import type { Server } from "bun";

// ---------------------------------------------------------------------------
// WebSocket data attached to each connection via server.upgrade()
// ---------------------------------------------------------------------------

export type GatewayWebSocketData = {
  readonly connection: GatewayConnection;
  readonly deps: GatewayDeps;
};

// ---------------------------------------------------------------------------
// Route handler — upgrades WebSocket or returns 426
// ---------------------------------------------------------------------------

function createGatewayRequestHandler(deps: GatewayDeps) {
  return function handleGatewayRequest(
    request: Request,
    server: Server<GatewayWebSocketData>,
  ): Response | undefined {
    // Check for WebSocket upgrade header
    const upgradeHeader = request.headers.get("upgrade");
    if (upgradeHeader?.toLowerCase() === "websocket") {
      const connection = createConnection();
      const upgraded = server.upgrade(request, {
        data: { connection, deps },
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
  };
}

// ---------------------------------------------------------------------------
// Method handler registry
// ---------------------------------------------------------------------------

function buildHandlerMap(): MethodHandlerMap {
  const { handler: connectHandler } = createConnectHandler();
  const agentHandler = createAgentHandler();

  return {
    connect: connectHandler,
    agent: agentHandler,
  };
}

// ---------------------------------------------------------------------------
// WebSocket handlers — Bun.serve websocket config
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Event streaming loop — subscribes to session events and forwards to WebSocket
// ---------------------------------------------------------------------------

async function streamSessionEvents(
  ws: { data: GatewayWebSocketData; send: (msg: string) => void },
  sessionId: string,
  deps: GatewayDeps,
): Promise<void> {
  const events = deps.subscribeToSessionEvents(sessionId);

  for await (const streamEvent of events) {
    // Get current connection state for seq counter
    const currentConnection = ws.data.connection;
    const nextSeq = currentConnection.seqCounter + 1;

    const eventFrame = mapStreamEventToGatewayEvent(streamEvent, nextSeq);
    if (eventFrame) {
      // Update seq counter on connection
      (ws.data as { connection: GatewayConnection; deps: GatewayDeps }).connection = {
        ...currentConnection,
        seqCounter: nextSeq,
      };

      ws.send(serializeFrame(eventFrame as EventFrame));
    }
  }
}

export function createGatewayWebSocketHandlers() {
  const dispatch = createMethodDispatch(buildHandlerMap());

  return {
    open(ws: { data: GatewayWebSocketData; send: (msg: string) => void }) {
      const { connection } = ws.data;
      const result = transition(connection, { type: "ws_open" });
      (ws.data as { connection: GatewayConnection; deps: GatewayDeps }).connection = result.connection;
    },

    message(
      ws: { data: GatewayWebSocketData; send: (msg: string) => void },
      message: string | Buffer,
    ) {
      const rawData = typeof message === "string" ? message : message.toString();
      const { connection, deps } = ws.data;

      // Parse frame
      const parsed = parseFrame(rawData);
      if (isParseError(parsed)) {
        const errorResponse: ResponseFrame = {
          type: "res",
          id: "unknown",
          ok: false,
          error: {
            code: "invalid_frame",
            message: parsed.parseError,
          },
        };
        ws.send(serializeFrame(errorResponse));
        return;
      }

      // Only handle request frames
      if (parsed.type !== "req") {
        return;
      }

      const requestFrame = parsed;

      // State guard: methods other than "connect" require active state
      if (requestFrame.method !== "connect" && connection.state !== "active") {
        const notAuthResponse: ResponseFrame = {
          type: "res",
          id: requestFrame.id,
          ok: false,
          error: {
            code: "not_authenticated",
            message: "Connection is not authenticated — send connect first",
          },
        };
        ws.send(serializeFrame(notAuthResponse));
        return;
      }

      // Dispatch to handler (async)
      dispatch(requestFrame.method, connection, requestFrame.params, deps)
        .then((result) => {
          // Build response frame
          const responseFrame: ResponseFrame = result.ok
            ? { type: "res", id: requestFrame.id, ok: true, payload: result.payload }
            : { type: "res", id: requestFrame.id, ok: false, error: result.error };

          ws.send(serializeFrame(responseFrame));

          // If connect succeeded, transition connection to active
          if (requestFrame.method === "connect" && result.ok) {
            const update = resolveConnectionUpdate(requestFrame.params);
            if (update) {
              (ws.data as { connection: GatewayConnection; deps: GatewayDeps }).connection =
                activateConnection(connection, update);
            }
          }

          // If agent method succeeded, start event streaming loop
          if (requestFrame.method === "agent" && result.ok) {
            const payload = result.payload as { sessionId?: string } | undefined;
            if (payload?.sessionId) {
              streamSessionEvents(ws, payload.sessionId, deps).catch(() => {
                // Event streaming ended — session complete or connection closed
              });
            }
          }
        })
        .catch((err) => {
          const errorResponse: ResponseFrame = {
            type: "res",
            id: requestFrame.id,
            ok: false,
            error: {
              code: "internal_error",
              message: err instanceof Error ? err.message : "Internal error",
            },
          };
          ws.send(serializeFrame(errorResponse));
        });
    },

    close(
      ws: { data: GatewayWebSocketData },
      code: number,
      reason: string,
    ) {
      const { connection } = ws.data;
      const result = transition(connection, { type: "ws_close", code, reason });
      (ws.data as { connection: GatewayConnection; deps: GatewayDeps }).connection = result.connection;
    },
  };
}

// ---------------------------------------------------------------------------
// Public API — route registration record for Bun.serve routes object
// ---------------------------------------------------------------------------

export function createGatewayRoutes(deps: GatewayDeps) {
  return {
    "/api/gateway": {
      GET: createGatewayRequestHandler(deps),
    },
  } as const;
}
