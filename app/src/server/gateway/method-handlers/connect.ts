/**
 * Connect method handler — skeleton auth support.
 *
 * The connect handler authenticates the client and transitions the connection
 * to active state. For the walking skeleton, it recognizes a hardcoded
 * "skeleton-test-token" and bypasses Ed25519 verification.
 *
 * Returns a HelloOk payload with protocol info, policy, and auth details.
 */
import type { MethodHandler, ResponsePayload } from "../method-dispatch";

// ---------------------------------------------------------------------------
// Skeleton auth constants
// ---------------------------------------------------------------------------

const SKELETON_AUTH_TOKEN = "skeleton-test-token";
const SKELETON_WORKSPACE_ID = "skeleton-test-ws";
const SKELETON_IDENTITY_ID = "skeleton-test-identity";
const SKELETON_AGENT_ID = "skeleton-test-agent";

// ---------------------------------------------------------------------------
// Connect params shape
// ---------------------------------------------------------------------------

type ConnectParams = {
  readonly minProtocol?: number;
  readonly maxProtocol?: number;
  readonly client?: {
    readonly id?: string;
    readonly version?: string;
    readonly platform?: string;
    readonly mode?: string;
  };
  readonly role?: string;
  readonly scopes?: readonly string[];
  readonly auth?: {
    readonly token?: string;
  };
  readonly device?: {
    readonly id?: string;
    readonly publicKey?: string;
    readonly signature?: string;
    readonly signedAt?: number;
    readonly nonce?: string;
  };
};

// ---------------------------------------------------------------------------
// HelloOk payload
// ---------------------------------------------------------------------------

type HelloOkPayload = {
  readonly protocol: number;
  readonly policy: {
    readonly tickIntervalMs: number;
  };
  readonly auth: {
    readonly deviceToken: string;
    readonly role: string;
    readonly scopes: readonly string[];
  };
  readonly workspace: {
    readonly id: string;
  };
  readonly identity: {
    readonly id: string;
    readonly agentId: string;
  };
};

// ---------------------------------------------------------------------------
// Connection state transition helper
// ---------------------------------------------------------------------------

export type ConnectionUpdate = {
  readonly state: "active";
  readonly identityId: string;
  readonly workspaceId: string;
  readonly agentId: string;
};

export type ConnectResult = {
  readonly response: ResponsePayload;
  readonly connectionUpdate?: ConnectionUpdate;
};

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

function isSkeletonAuth(params: ConnectParams): boolean {
  return params.auth?.token === SKELETON_AUTH_TOKEN;
}

function buildHelloOkPayload(
  role: string,
  scopes: readonly string[],
  workspaceId: string,
  identityId: string,
  agentId: string,
): HelloOkPayload {
  return {
    protocol: 3,
    policy: { tickIntervalMs: 15_000 },
    auth: {
      deviceToken: "skeleton-device-token",
      role,
      scopes,
    },
    workspace: { id: workspaceId },
    identity: { id: identityId, agentId },
  };
}

/**
 * Handle the connect method. Returns both a response payload and an optional
 * connection state update for the caller to apply.
 */
export function createConnectHandler(): {
  handler: MethodHandler;
} {
  const handler: MethodHandler = async (connection, params, _deps) => {
    const connectParams = (params ?? {}) as ConnectParams;

    // Already authenticated — reject duplicate connect
    if (connection.state === "active") {
      return {
        ok: false,
        error: {
          code: "already_authenticated",
          message: "Connection is already authenticated",
        },
      };
    }

    // Skeleton auth bypass
    if (isSkeletonAuth(connectParams)) {
      const role = connectParams.role ?? "operator";
      const scopes = connectParams.scopes ?? [];
      const payload = buildHelloOkPayload(
        role,
        scopes,
        SKELETON_WORKSPACE_ID,
        SKELETON_IDENTITY_ID,
        SKELETON_AGENT_ID,
      );
      return { ok: true, payload };
    }

    // Real Ed25519 auth — not yet implemented
    return {
      ok: false,
      error: {
        code: "auth_failed",
        message: "Ed25519 authentication not yet implemented",
      },
    };
  };

  return { handler };
}

/**
 * Determine connection state update from connect params.
 * Separated from handler for pure state machine usage.
 */
export function resolveConnectionUpdate(
  params: unknown,
): ConnectionUpdate | undefined {
  const connectParams = (params ?? {}) as ConnectParams;
  if (isSkeletonAuth(connectParams)) {
    return {
      state: "active",
      identityId: SKELETON_IDENTITY_ID,
      workspaceId: SKELETON_WORKSPACE_ID,
      agentId: SKELETON_AGENT_ID,
    };
  }
  return undefined;
}
