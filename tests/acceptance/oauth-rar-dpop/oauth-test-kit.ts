/**
 * OAuth RAR+DPoP Acceptance Test Kit
 *
 * Extends the shared acceptance-test-kit with OAuth-specific helpers.
 * All helpers use business language -- no technical jargon in function names.
 *
 * Driving ports:
 *   POST /api/auth/intents              (intent submission with DPoP binding)
 *   POST /api/auth/token                (Custom AS token endpoint)
 *   POST /api/auth/bridge/exchange      (session-to-token Bridge)
 *   GET  /api/auth/osabio/.well-known/jwks (AS public keys)
 *   All /api/mcp/* routes               (DPoP-protected Brain endpoints)
 */
import { RecordId, type Surreal } from "surrealdb";
import * as jose from "jose";
import {
  generateKeyPair,
  computeJwkThumbprint,
  createDPoPProof,
  type DPoPKeyPair as SharedDPoPKeyPair,
} from "../../../app/shared/dpop";
import {
  setupAcceptanceSuite,
  createTestUser,
  fetchRaw,
  type AcceptanceTestRuntime,
  type TestUser as BaseTestUser,
} from "../acceptance-test-kit";

// Re-export shared kit essentials
export {
  setupAcceptanceSuite,
  createTestUser,
  fetchRaw,
  type AcceptanceTestRuntime,
  type TestUser as BaseTestUser,
} from "../acceptance-test-kit";

// ---------------------------------------------------------------------------
// Types -- Business Language
// ---------------------------------------------------------------------------

export type DPoPKeyPair = SharedDPoPKeyPair;

export type OsabioAction = {
  type: "osabio_action";
  action: string;
  resource: string;
  constraints?: Record<string, unknown>;
};

export type IntentSubmissionResult = {
  intent_id: string;
  status: string;
};

export type TokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
};

export type TokenErrorResponse = {
  error: string;
  error_description?: string;
};

export type BridgeExchangeResult = {
  access_token: string;
  token_type: string;
  expires_in: number;
};

export type OAuthTestRuntime = AcceptanceTestRuntime;

export type TestUserWithSession = BaseTestUser & {
  userId: string;
};

// ---------------------------------------------------------------------------
// Suite Setup
// ---------------------------------------------------------------------------

/**
 * Sets up an acceptance test suite with OAuth-specific configuration.
 * Boots in-process server with isolated SurrealDB namespace.
 */
export function setupOAuthSuite(
  suiteName: string,
): () => OAuthTestRuntime {
  return setupAcceptanceSuite(suiteName);
}

// ---------------------------------------------------------------------------
// DPoP Key Pair Lifecycle Helpers
// ---------------------------------------------------------------------------

/**
 * Generates an ES256 key pair for DPoP proof signing.
 * Delegates to shared generateKeyPair from app/shared/dpop.
 */
export async function generateActorKeyPair(): Promise<DPoPKeyPair> {
  return generateKeyPair();
}

/**
 * Computes JWK thumbprint per RFC 7638.
 * Delegates to shared computeJwkThumbprint from app/shared/dpop.
 */
export async function computeKeyThumbprint(publicJwk: JsonWebKey): Promise<string> {
  return computeJwkThumbprint(publicJwk);
}

// ---------------------------------------------------------------------------
// DPoP Proof Construction
// ---------------------------------------------------------------------------

/**
 * Creates a signed DPoP proof for a specific request.
 * Delegates to shared createDPoPProof from app/shared/dpop.
 */
export async function createProofForRequest(
  keyPair: DPoPKeyPair,
  method: string,
  targetUri: string,
): Promise<string> {
  return createDPoPProof(keyPair.privateKey, keyPair.publicJwk, method, targetUri);
}

/**
 * Creates a DPoP proof with tampered claims for error path testing.
 */
export async function createMalformedProof(
  keyPair: DPoPKeyPair,
  overrides: {
    typ?: string;
    alg?: string;
    htm?: string;
    htu?: string;
    iat?: number;
    jti?: string;
    omitJwk?: boolean;
  },
): Promise<string> {
  const header: Record<string, unknown> = {
    typ: overrides.typ ?? "dpop+jwt",
    alg: overrides.alg ?? "ES256",
  };

  if (!overrides.omitJwk) {
    header.jwk = {
      kty: keyPair.publicJwk.kty,
      crv: keyPair.publicJwk.crv,
      x: keyPair.publicJwk.x,
      y: keyPair.publicJwk.y,
    };
  }

  const payload = {
    jti: overrides.jti ?? crypto.randomUUID(),
    htm: overrides.htm ?? "POST",
    htu: overrides.htu ?? "http://127.0.0.1/test",
    iat: overrides.iat ?? Math.floor(Date.now() / 1000),
  };

  const importedKey = await jose.importJWK(
    await crypto.subtle.exportKey("jwk", keyPair.privateKey),
    "ES256",
  );

  return await new jose.SignJWT(payload)
    .setProtectedHeader(header as jose.JWTHeaderParameters)
    .sign(importedKey);
}

// ---------------------------------------------------------------------------
// Intent Submission (Driving Port: POST /api/auth/intents)
// ---------------------------------------------------------------------------

/**
 * Submits an intent with DPoP thumbprint binding through the driving port.
 * This is how agents declare what they want to do.
 */
export async function submitIntentWithDPoP(
  baseUrl: string,
  workspaceId: string,
  identityId: string,
  osabioAction: OsabioAction,
  thumbprint: string,
  options?: {
    goal?: string;
    reasoning?: string;
    priority?: number;
  },
): Promise<Response> {
  return fetch(`${baseUrl}/api/auth/intents`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      workspace_id: workspaceId,
      identity_id: identityId,
      authorization_details: [osabioAction],
      dpop_jwk_thumbprint: thumbprint,
      goal: options?.goal ?? "Perform authorized operation",
      reasoning: options?.reasoning ?? "Operation required for task completion",
      priority: options?.priority ?? 50,
    }),
  });
}

// ---------------------------------------------------------------------------
// Token Acquisition (Driving Port: POST /api/auth/token)
// ---------------------------------------------------------------------------

/**
 * Requests a DPoP-bound access token from the Custom AS.
 * The agent presents proof of key possession along with an authorized intent.
 */
export async function requestAccessToken(
  baseUrl: string,
  intentId: string,
  keyPair: DPoPKeyPair,
  authorizationDetails: OsabioAction[],
): Promise<Response> {
  const tokenUri = `${baseUrl}/api/auth/token`;
  const dpopProof = await createProofForRequest(keyPair, "POST", tokenUri);

  return fetch(tokenUri, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      DPoP: dpopProof,
    },
    body: JSON.stringify({
      grant_type: "urn:osabio:intent-authorization",
      intent_id: intentId,
      authorization_details: authorizationDetails,
    }),
  });
}

// ---------------------------------------------------------------------------
// Bridge Exchange (Driving Port: POST /api/auth/bridge/exchange)
// ---------------------------------------------------------------------------

/**
 * Exchanges a human session for a DPoP-bound token via the Bridge.
 * This is how dashboard users get tokens for Brain operations.
 */
export async function exchangeSessionForToken(
  baseUrl: string,
  sessionHeaders: Record<string, string>,
  keyPair: DPoPKeyPair,
  osabioAction: OsabioAction,
): Promise<Response> {
  const bridgeUri = `${baseUrl}/api/auth/bridge/exchange`;
  const dpopProof = await createProofForRequest(keyPair, "POST", bridgeUri);

  return fetch(bridgeUri, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      DPoP: dpopProof,
      ...sessionHeaders,
    },
    body: JSON.stringify({
      authorization_details: [osabioAction],
    }),
  });
}

// ---------------------------------------------------------------------------
// DPoP-Protected Request (Brain Resource Server)
// ---------------------------------------------------------------------------

/**
 * Makes a DPoP-protected request to the Brain resource server.
 * Presents access token and fresh DPoP proof for the specific request.
 */
export async function makeDPoPProtectedRequest(
  baseUrl: string,
  path: string,
  accessToken: string,
  keyPair: DPoPKeyPair,
  options?: {
    method?: string;
    body?: unknown;
  },
): Promise<Response> {
  const method = options?.method ?? "POST";
  const requestUri = `${baseUrl}${path}`;
  const dpopProof = await createProofForRequest(keyPair, method, requestUri);

  const headers: Record<string, string> = {
    Authorization: `DPoP ${accessToken}`,
    DPoP: dpopProof,
    "Content-Type": "application/json",
  };

  const body = options?.body ?? {};

  return fetch(requestUri, {
    method,
    headers,
    body: JSON.stringify(body),
  });
}

/**
 * Makes a Bearer-token request (should be rejected by DPoP-protected endpoints).
 */
export async function makeBearerRequest(
  baseUrl: string,
  path: string,
  token: string,
  options?: { method?: string; body?: unknown },
): Promise<Response> {
  const method = options?.method ?? "POST";
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };

  if (options?.body) {
    headers["Content-Type"] = "application/json";
  }

  return fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: options?.body ? JSON.stringify(options.body) : undefined,
  });
}

/**
 * Makes a session-cookie request (should be rejected by DPoP-protected endpoints).
 */
export async function makeSessionCookieRequest(
  baseUrl: string,
  path: string,
  sessionHeaders: Record<string, string>,
  options?: { method?: string; body?: unknown },
): Promise<Response> {
  const method = options?.method ?? "POST";
  const headers: Record<string, string> = { ...sessionHeaders };

  if (options?.body) {
    headers["Content-Type"] = "application/json";
  }

  return fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: options?.body ? JSON.stringify(options.body) : undefined,
  });
}

// ---------------------------------------------------------------------------
// Test Data Setup Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a test identity for an agent in the workspace.
 */
export async function createAgentIdentity(
  surreal: Surreal,
  workspaceId: string,
  name: string,
): Promise<string> {
  const identityId = `agent-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const identityRecord = new RecordId("identity", identityId);
  const workspaceRecord = new RecordId("workspace", workspaceId);

  await surreal.query(`CREATE $identity CONTENT $content;`, {
    identity: identityRecord,
    content: {
      name,
      type: "agent",
      workspace: workspaceRecord,
      created_at: new Date(),
    },
  });

  return identityId;
}

/**
 * Creates a test identity for a managed agent with a human owner.
 */
export async function createManagedAgentIdentity(
  surreal: Surreal,
  workspaceId: string,
  name: string,
  managedByUserId: string,
): Promise<string> {
  const identityId = `managed-agent-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const identityRecord = new RecordId("identity", identityId);
  const workspaceRecord = new RecordId("workspace", workspaceId);

  await surreal.query(`CREATE $identity CONTENT $content;`, {
    identity: identityRecord,
    content: {
      name,
      type: "agent",
      managed_by: managedByUserId,
      workspace: workspaceRecord,
      created_at: new Date(),
    },
  });

  return identityId;
}

/**
 * Creates a test workspace for OAuth scenarios.
 */
export async function createTestWorkspace(
  baseUrl: string,
  user: BaseTestUser,
  name?: string,
): Promise<{ workspaceId: string }> {
  const response = await fetch(`${baseUrl}/api/workspaces`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...user.headers },
    body: JSON.stringify({
      name: name ?? `OAuth Test ${Date.now()}`,
      repoPath: process.cwd(),
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to create workspace (${response.status}): ${body}`);
  }

  const result = (await response.json()) as { workspaceId: string };
  return result;
}

/**
 * Seeds an intent record directly in the database with "authorized" status.
 * Used as a Given-step precondition for token issuance tests.
 */
export async function seedAuthorizedIntent(
  surreal: Surreal,
  workspaceId: string,
  identityId: string,
  osabioAction: OsabioAction,
  thumbprint: string,
): Promise<string> {
  const intentId = `intent-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const intentRecord = new RecordId("intent", intentId);
  const workspaceRecord = new RecordId("workspace", workspaceId);
  const requesterRecord = new RecordId("identity", identityId);

  const traceRecord = new RecordId("trace", `trace-${intentId}`);
  await surreal.query(`CREATE $trace CONTENT $traceContent;`, {
    trace: traceRecord,
    traceContent: { type: "intent_submission", actor: requesterRecord, workspace: workspaceRecord, created_at: new Date() },
  });

  await surreal.query(`CREATE $intent CONTENT $content;`, {
    intent: intentRecord,
    content: {
      goal: "Authorized test operation",
      reasoning: "Pre-authorized for acceptance testing",
      status: "authorized",
      priority: 50,
      authorization_details: [osabioAction],
      dpop_jwk_thumbprint: thumbprint,
      action_spec: {
        provider: "test",
        action: osabioAction.action,
        params: { resource: osabioAction.resource },
      },
      trace_id: traceRecord,
      requester: requesterRecord,
      workspace: workspaceRecord,
      evaluation: {
        decision: "APPROVE",
        risk_score: 10,
        reason: "Pre-authorized for testing",
        evaluated_at: new Date(),
        policy_only: true,
      },
      created_at: new Date(),
    },
  });

  return intentId;
}

/**
 * Seeds an intent record with a specific status.
 * Flexible precondition setup for various test scenarios.
 */
export async function seedIntentWithStatus(
  surreal: Surreal,
  workspaceId: string,
  identityId: string,
  osabioAction: OsabioAction,
  thumbprint: string,
  status: string,
): Promise<string> {
  const intentId = `intent-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const intentRecord = new RecordId("intent", intentId);
  const workspaceRecord = new RecordId("workspace", workspaceId);
  const requesterRecord = new RecordId("identity", identityId);

  const traceRecord = new RecordId("trace", `trace-${intentId}`);
  await surreal.query(`CREATE $trace CONTENT $traceContent;`, {
    trace: traceRecord,
    traceContent: { type: "intent_submission", actor: requesterRecord, workspace: workspaceRecord, created_at: new Date() },
  });

  await surreal.query(`CREATE $intent CONTENT $content;`, {
    intent: intentRecord,
    content: {
      goal: `Test operation (${status})`,
      reasoning: `Seeded for acceptance testing with status: ${status}`,
      status,
      priority: 50,
      authorization_details: [osabioAction],
      dpop_jwk_thumbprint: thumbprint,
      action_spec: {
        provider: "test",
        action: osabioAction.action,
        params: { resource: osabioAction.resource },
      },
      trace_id: traceRecord,
      requester: requesterRecord,
      workspace: workspaceRecord,
      created_at: new Date(),
    },
  });

  return intentId;
}

/**
 * Queries the identity ID for the first user in the database.
 */
export async function getIdentityId(surreal: Surreal): Promise<string> {
  const rows = (await surreal.query(
    `SELECT id FROM identity LIMIT 1;`,
  )) as Array<Array<{ id: RecordId<"identity"> }>>;
  const result = rows[0]?.[0];
  if (!result) {
    throw new Error("No identity found -- create a test user first");
  }
  return result.id.id as string;
}

/**
 * Reads a osabio_action for common low-risk workspace read operations.
 */
export function readWorkspaceAction(workspaceId: string): OsabioAction {
  return {
    type: "osabio_action",
    action: "read",
    resource: "workspace",
  };
}

/**
 * Creates a osabio_action for task status update operations.
 */
export function updateTaskAction(taskId?: string): OsabioAction {
  return {
    type: "osabio_action",
    action: "update",
    resource: "task",
    constraints: taskId ? { task_id: taskId } : undefined,
  };
}

/**
 * Creates a osabio_action for creating a new decision.
 */
export function createDecisionAction(): OsabioAction {
  return {
    type: "osabio_action",
    action: "create",
    resource: "decision",
  };
}

/**
 * Waits for an intent to reach a target status by polling the database.
 */
export async function waitForIntentStatus(
  surreal: Surreal,
  intentId: string,
  targetStatuses: string[],
  timeoutMs = 30_000,
): Promise<string> {
  const intentRecord = new RecordId("intent", intentId);
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const rows = (await surreal.query(`SELECT status FROM $intent;`, {
      intent: intentRecord,
    })) as Array<Array<{ status: string }>>;

    const status = rows[0]?.[0]?.status;
    if (status && targetStatuses.includes(status)) {
      return status;
    }

    await Bun.sleep(250);
  }

  const rows = (await surreal.query(`SELECT status FROM $intent;`, {
    intent: intentRecord,
  })) as Array<Array<{ status: string }>>;

  throw new Error(
    `Intent ${intentId} did not reach ${targetStatuses.join("|")} within ${timeoutMs}ms. ` +
    `Current status: ${rows[0]?.[0]?.status ?? "not found"}`,
  );
}

