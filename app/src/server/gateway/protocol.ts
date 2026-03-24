/**
 * Gateway Protocol v3 — Frame types, parsing, and serialization.
 *
 * All functions are pure. No IO, no side effects, no imports from IO modules.
 * The protocol uses JSON text frames over WebSocket with three discriminants:
 * - "req"   — client-to-server request expecting a response
 * - "res"   — server-to-client response matching a request id
 * - "event" — server-to-client push notification (no request id needed)
 */

// ---------------------------------------------------------------------------
// Method names — all protocol methods the gateway recognizes
// ---------------------------------------------------------------------------

export type MethodName =
  // Connection & auth
  | "connect"
  | "connect.verify"
  // Agent execution
  | "agent"
  // Session management (OpenClaw sessions.* namespace)
  | "sessions.list"
  | "sessions.history"
  | "sessions.send"
  | "sessions.patch"
  // Backward compat aliases
  | "agent.status"
  | "agent.wait"
  // Exec approval (Brain governance extension)
  | "exec.approve"
  | "exec.deny"
  | "exec.approval.resolve"
  // Device management
  | "device.token.rotate"
  | "device.token.revoke"
  | "device.pair.start"
  | "device.pair.complete"
  // Discovery & status
  | "tools.catalog"
  | "skills.bins"
  | "model.list"
  | "presence"
  // Configuration
  | "config.get";

// ---------------------------------------------------------------------------
// Error codes — protocol-level and business-level error classifications
// ---------------------------------------------------------------------------

export type ErrorCode =
  // Protocol errors
  | "invalid_frame"
  | "unknown_method"
  | "not_authenticated"
  | "already_authenticated"
  // Device auth errors (aligned with real protocol)
  | "auth_failed"
  | "DEVICE_AUTH_NONCE_REQUIRED"
  | "DEVICE_AUTH_NONCE_MISMATCH"
  | "DEVICE_AUTH_SIGNATURE_INVALID"
  | "DEVICE_AUTH_SIGNATURE_EXPIRED"
  | "DEVICE_AUTH_DEVICE_ID_MISMATCH"
  | "DEVICE_AUTH_PUBLIC_KEY_INVALID"
  | "AUTH_TOKEN_MISMATCH"
  // Business errors
  | "no_membership"
  | "policy_violation"
  | "budget_exceeded"
  | "session_not_found"
  | "method_not_supported"
  | "internal_error";

// ---------------------------------------------------------------------------
// Frame types — discriminated union on the "type" field
// ---------------------------------------------------------------------------

export type RequestFrame = {
  readonly type: "req";
  readonly id: string;
  readonly method: MethodName;
  readonly params?: unknown;
};

export type GatewayError = {
  readonly code: ErrorCode;
  readonly message: string;
  readonly details?: unknown;
};

export type ResponseFrame =
  | {
      readonly type: "res";
      readonly id: string;
      readonly ok: true;
      readonly payload?: unknown;
    }
  | {
      readonly type: "res";
      readonly id: string;
      readonly ok: false;
      readonly error: GatewayError;
    };

export type EventFrame = {
  readonly type: "event";
  readonly event: string;
  readonly payload?: unknown;
  readonly seq?: number;
};

export type GatewayFrame = RequestFrame | ResponseFrame | EventFrame;

// ---------------------------------------------------------------------------
// Pure parser — string to GatewayFrame | { error: string }
// ---------------------------------------------------------------------------

export type ParseError = { readonly parseError: string };

export function parseFrame(raw: string): GatewayFrame | ParseError {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { parseError: "Failed to parse JSON frame" };
  }

  if (typeof parsed !== "object" || parsed === null) {
    return { parseError: "Frame must be a JSON object" };
  }

  const obj = parsed as Record<string, unknown>;
  const frameType = obj.type;

  if (frameType === "req") {
    return parseRequestFrame(obj);
  }
  if (frameType === "res") {
    return parseResponseFrame(obj);
  }
  if (frameType === "event") {
    return parseEventFrame(obj);
  }

  return { parseError: `Unknown frame type: ${String(frameType)}` };
}

export function isParseError(result: GatewayFrame | ParseError): result is ParseError {
  return "parseError" in result;
}

function parseRequestFrame(obj: Record<string, unknown>): RequestFrame | ParseError {
  if (typeof obj.id !== "string") {
    return { parseError: "Request frame missing required field: id" };
  }
  if (typeof obj.method !== "string") {
    return { parseError: "Request frame missing required field: method" };
  }
  const frame: RequestFrame = {
    type: "req",
    id: obj.id,
    method: obj.method as MethodName,
    ...(obj.params !== undefined ? { params: obj.params } : {}),
  };
  return frame;
}

function parseResponseFrame(obj: Record<string, unknown>): ResponseFrame | ParseError {
  if (typeof obj.id !== "string") {
    return { parseError: "Response frame missing required field: id" };
  }
  if (typeof obj.ok !== "boolean") {
    return { parseError: "Response frame missing required field: ok" };
  }

  if (obj.ok) {
    const frame: ResponseFrame = {
      type: "res",
      id: obj.id,
      ok: true,
      ...(obj.payload !== undefined ? { payload: obj.payload } : {}),
    };
    return frame;
  }

  const frame: ResponseFrame = {
    type: "res",
    id: obj.id,
    ok: false,
    error: obj.error as GatewayError,
  };
  return frame;
}

function parseEventFrame(obj: Record<string, unknown>): EventFrame | ParseError {
  if (typeof obj.event !== "string") {
    return { parseError: "Event frame missing required field: event" };
  }
  const frame: EventFrame = {
    type: "event",
    event: obj.event,
    ...(obj.payload !== undefined ? { payload: obj.payload } : {}),
    ...(obj.seq !== undefined ? { seq: obj.seq as number } : {}),
  };
  return frame;
}

// ---------------------------------------------------------------------------
// Pure serializer — GatewayFrame to JSON string
// ---------------------------------------------------------------------------

export function serializeFrame(frame: GatewayFrame): string {
  return JSON.stringify(frame);
}
