/**
 * Connect method handler — skeleton auth + Ed25519 device authentication.
 *
 * The connect handler authenticates the client and transitions the connection
 * to active state. Two auth paths:
 * 1. Skeleton auth: recognizes hardcoded "skeleton-test-token" (walking skeleton)
 * 2. Ed25519 auth: verifies signed nonce, resolves or registers device identity
 *
 * Returns a HelloOk payload with protocol info, policy, and auth details.
 */
import type { MethodHandler, ResponsePayload } from "../method-dispatch";
import {
  verifyEd25519Signature,
  computeDeviceFingerprint,
} from "../device-auth";
import {
  resolveDeviceIdentity,
  registerNewDevice,
} from "../identity-bridge";

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

export type HelloOkPayload = {
  readonly type: "hello-ok";
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
  readonly isNewDevice?: boolean;
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
  deviceToken: string,
  isNewDevice?: boolean,
): HelloOkPayload {
  return {
    type: "hello-ok",
    protocol: 3,
    policy: { tickIntervalMs: 15_000 },
    auth: {
      deviceToken,
      role,
      scopes,
    },
    workspace: { id: workspaceId },
    identity: { id: identityId, agentId },
    ...(isNewDevice !== undefined ? { isNewDevice } : {}),
  };
}

function generateDeviceToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

/**
 * Handle the connect method. Returns both a response payload and an optional
 * connection state update for the caller to apply.
 */
export function createConnectHandler(): {
  handler: MethodHandler;
} {
  const handler: MethodHandler = async (connection, params, deps) => {
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
        "skeleton-device-token",
      );
      return { ok: true, payload };
    }

    // Ed25519 device authentication
    return authenticateWithEd25519(connection, connectParams, deps);
  };

  return { handler };
}

// ---------------------------------------------------------------------------
// Ed25519 authentication flow
// ---------------------------------------------------------------------------

async function authenticateWithEd25519(
  connection: { readonly challenge?: { readonly nonce: string; readonly ts: number } },
  connectParams: ConnectParams,
  deps: { readonly surreal: unknown },
): Promise<ResponsePayload> {
  const { device } = connectParams;

  // Validate required device fields
  if (!device?.publicKey || !device?.signature || !device?.nonce) {
    return {
      ok: false,
      error: {
        code: "DEVICE_AUTH_NONCE_REQUIRED",
        message: "Device publicKey, signature, and nonce are required",
      },
    };
  }

  // Verify the nonce matches the pending challenge
  if (!connection.challenge) {
    return {
      ok: false,
      error: {
        code: "DEVICE_AUTH_NONCE_MISMATCH",
        message: "No pending challenge on this connection",
      },
    };
  }

  if (device.nonce !== connection.challenge.nonce) {
    return {
      ok: false,
      error: {
        code: "DEVICE_AUTH_NONCE_MISMATCH",
        message: "Nonce does not match the pending challenge",
      },
    };
  }

  // Verify Ed25519 signature over the nonce
  const signatureValid = await verifyEd25519Signature(
    device.publicKey,
    device.nonce,
    device.signature,
  );

  if (!signatureValid) {
    return {
      ok: false,
      error: {
        code: "DEVICE_AUTH_SIGNATURE_INVALID",
        message: "Ed25519 signature verification failed",
      },
    };
  }

  // Compute device fingerprint from public key
  const fingerprint = await computeDeviceFingerprint(device.publicKey);

  // Resolve or register device identity
  const surreal = deps.surreal as import("surrealdb").Surreal;
  const existingIdentity = await resolveDeviceIdentity(fingerprint, surreal);

  if (existingIdentity) {
    const role = connectParams.role ?? "operator";
    const scopes = connectParams.scopes ?? [];
    const payload = buildHelloOkPayload(
      role,
      scopes,
      existingIdentity.workspaceId,
      existingIdentity.identityId,
      existingIdentity.agentId,
      generateDeviceToken(),
      false,
    );
    return { ok: true, payload };
  }

  // New device — register in the graph
  const newIdentity = await registerNewDevice(
    {
      publicKeyBase64: device.publicKey,
      fingerprint,
      platform: connectParams.client?.platform ?? "unknown",
      family: connectParams.client?.id ?? "unknown",
    },
    surreal,
  );

  const role = connectParams.role ?? "operator";
  const scopes = connectParams.scopes ?? [];
  const payload = buildHelloOkPayload(
    role,
    scopes,
    newIdentity.workspaceId,
    newIdentity.identityId,
    newIdentity.agentId,
    generateDeviceToken(),
    true,
  );
  return { ok: true, payload };
}

/**
 * Extract connection update from a successful connect response payload.
 * Works for both skeleton auth and Ed25519 auth by reading from the hello-ok payload.
 */
export function resolveConnectionUpdate(
  params: unknown,
  responsePayload?: unknown,
): ConnectionUpdate | undefined {
  const connectParams = (params ?? {}) as ConnectParams;

  // Skeleton auth path — static identity
  if (isSkeletonAuth(connectParams)) {
    return {
      state: "active",
      identityId: SKELETON_IDENTITY_ID,
      workspaceId: SKELETON_WORKSPACE_ID,
      agentId: SKELETON_AGENT_ID,
    };
  }

  // Ed25519 auth path — extract from hello-ok payload
  const helloOk = responsePayload as HelloOkPayload | undefined;
  if (helloOk?.type === "hello-ok") {
    return {
      state: "active",
      identityId: helloOk.identity.id,
      workspaceId: helloOk.workspace.id,
      agentId: helloOk.identity.agentId,
    };
  }

  return undefined;
}
