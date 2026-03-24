/**
 * Gateway connection state machine — pure transition function.
 *
 * No IO, no side effects, no imports from IO modules.
 * The state machine models the lifecycle of a single WebSocket connection
 * through the Gateway Protocol v3.
 *
 * transition(connection, event) => TransitionResult
 *
 * Effects are returned as data — the caller (impure shell) interprets them.
 */
import type { ConnectionState, GatewayConnection } from "./types";

// ---------------------------------------------------------------------------
// Connection events — inputs to the state machine
// ---------------------------------------------------------------------------

export type ConnectionEvent =
  | { readonly type: "ws_open" }
  | { readonly type: "ws_close"; readonly code: number; readonly reason: string }
  | { readonly type: "ws_message"; readonly data: string };

// ---------------------------------------------------------------------------
// Connection effects — side effects described as data
// ---------------------------------------------------------------------------

export type ConnectionEffect =
  | { readonly type: "send_frame"; readonly frame: string }
  | { readonly type: "close_connection"; readonly code: number; readonly reason: string }
  | { readonly type: "start_keepalive" }
  | { readonly type: "stop_keepalive" }
  | { readonly type: "emit_presence"; readonly status: string }
  | { readonly type: "record_trace"; readonly method: string; readonly connectionId: string };

// ---------------------------------------------------------------------------
// Transition result — new connection state + effects to execute
// ---------------------------------------------------------------------------

export type TransitionResult = {
  readonly connection: GatewayConnection;
  readonly effects: readonly ConnectionEffect[];
};

// ---------------------------------------------------------------------------
// Factory — create a new connection in "connecting" state
// ---------------------------------------------------------------------------

export function createConnection(): GatewayConnection {
  return {
    connectionId: crypto.randomUUID(),
    state: "connecting",
    createdAt: Date.now(),
    seqCounter: 0,
    activeSessions: new Set<string>(),
  };
}

// ---------------------------------------------------------------------------
// Pure transition function
// ---------------------------------------------------------------------------

export function transition(
  connection: GatewayConnection,
  event: ConnectionEvent,
): TransitionResult {
  switch (connection.state) {
    case "connecting":
      return transitionFromConnecting(connection, event);
    case "authenticating":
      return transitionFromAuthenticating(connection, event);
    case "active":
      return transitionFromActive(connection, event);
    case "closed":
      return transitionFromClosed(connection);
  }
}

// ---------------------------------------------------------------------------
// Per-state transition handlers
// ---------------------------------------------------------------------------

function transitionFromConnecting(
  connection: GatewayConnection,
  event: ConnectionEvent,
): TransitionResult {
  switch (event.type) {
    case "ws_open":
      return {
        connection: withState(connection, "authenticating"),
        effects: [
          { type: "record_trace", method: "ws_open", connectionId: connection.connectionId },
        ],
      };
    case "ws_close":
      return toClosedState(connection);
    case "ws_message":
      // Messages before ws_open are invalid — ignore
      return { connection, effects: [] };
  }
}

function transitionFromAuthenticating(
  connection: GatewayConnection,
  event: ConnectionEvent,
): TransitionResult {
  switch (event.type) {
    case "ws_close":
      return toClosedState(connection);
    case "ws_message":
      // Authentication message handling will be added in step 01-03
      return { connection, effects: [] };
    case "ws_open":
      // Already opened — ignore duplicate
      return { connection, effects: [] };
  }
}

function transitionFromActive(
  connection: GatewayConnection,
  event: ConnectionEvent,
): TransitionResult {
  switch (event.type) {
    case "ws_close":
      return {
        connection: withState(connection, "closed"),
        effects: [
          { type: "stop_keepalive" },
          { type: "emit_presence", status: "offline" },
          { type: "record_trace", method: "ws_close", connectionId: connection.connectionId },
        ],
      };
    case "ws_message":
      // Message dispatch will be added in step 01-03
      return { connection, effects: [] };
    case "ws_open":
      // Already opened — ignore
      return { connection, effects: [] };
  }
}

function transitionFromClosed(
  connection: GatewayConnection,
): TransitionResult {
  // Terminal state — no transitions possible
  return { connection, effects: [] };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function withState(
  connection: GatewayConnection,
  state: ConnectionState,
): GatewayConnection {
  return { ...connection, state };
}

function toClosedState(connection: GatewayConnection): TransitionResult {
  return {
    connection: withState(connection, "closed"),
    effects: [
      { type: "record_trace", method: "ws_close", connectionId: connection.connectionId },
    ],
  };
}
