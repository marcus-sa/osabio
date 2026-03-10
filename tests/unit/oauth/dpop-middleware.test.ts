/**
 * Unit tests for DPoP verification middleware.
 *
 * Tests the authenticateDPoPRequest pipeline:
 * - Missing auth rejected with 401
 * - Bearer tokens rejected with 401 dpop_required
 * - Session cookies rejected with 401 dpop_required
 * - Missing DPoP proof header rejected with 401
 * - Invalid access token signature rejected with 401
 * - Invalid DPoP proof (wrong method/URI) rejected with 401
 * - DPoP binding mismatch (different key) rejected with 401
 * - Valid DPoP request returns DPoPAuthResult
 *
 * Acceptance criteria traced: M3-V1 through M3-V4
 */
import { describe, expect, it, beforeAll } from "bun:test";
import * as jose from "jose";
import { generateKeyPair } from "../../../app/src/server/oauth/dpop";
import { generateAsSigningKey } from "../../../app/src/server/oauth/as-key-management";
import type { AsSigningKey } from "../../../app/src/server/oauth/as-key-management";
import type { KeyPair } from "../../../app/src/server/oauth/dpop";
import { createNonceCache } from "../../../app/src/server/oauth/nonce-cache";
import { authenticateDPoPRequest } from "../../../app/src/server/oauth/dpop-middleware";
import type { DPoPAuthResult, BrainAction } from "../../../app/src/server/oauth/types";
import type { LookupIdentity, LookupManager, ResolvedIdentity, ResolvedManager } from "../../../app/src/server/oauth/identity-lifecycle";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

let asKey: AsSigningKey;
let agentKeyPair: KeyPair;
let differentKeyPair: KeyPair;

const TEST_WORKSPACE_ID = "ws-test-123";
const TEST_WORKSPACE_NAME = "Test Workspace";
const TEST_IDENTITY_ID = "id-test-456";
const TEST_INTENT_ID = "intent-test-789";
const TEST_SUBJECT = "person:user-001";
const TEST_URI = "https://brain.local/api/mcp";
const TEST_METHOD = "POST";

const TEST_ACTIONS: BrainAction[] = [
  { type: "brain_action", action: "read", resource: "graph" },
];

beforeAll(async () => {
  asKey = await generateAsSigningKey();
  agentKeyPair = await generateKeyPair();
  differentKeyPair = await generateKeyPair();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Issue a DPoP-bound access token signed by the AS key. */
async function issueTestToken(overrides?: {
  sub?: string;
  thumbprint?: string;
  workspace?: string;
  intentId?: string;
  actions?: BrainAction[];
  actorType?: string;
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  return await new jose.SignJWT({
    cnf: { jkt: overrides?.thumbprint ?? agentKeyPair.thumbprint },
    authorization_details: overrides?.actions ?? TEST_ACTIONS,
    "urn:brain:intent_id": overrides?.intentId ?? TEST_INTENT_ID,
    "urn:brain:workspace": overrides?.workspace ?? TEST_WORKSPACE_ID,
    "urn:brain:actor_type": overrides?.actorType ?? "agent",
  })
    .setProtectedHeader({ alg: "ES256", typ: "at+jwt", kid: asKey.kid })
    .setSubject(overrides?.sub ?? TEST_SUBJECT)
    .setIssuer("https://brain.local")
    .setAudience("https://brain.local")
    .setIssuedAt(now)
    .setExpirationTime(now + 300)
    .sign(asKey.privateKey);
}

/** Create a signed DPoP proof JWT. */
async function createDPoPProof(
  keyPair: KeyPair,
  overrides?: { htm?: string; htu?: string; iat?: number; jti?: string; omitJwk?: boolean },
): Promise<string> {
  const header: Record<string, unknown> = {
    typ: "dpop+jwt" as const,
    alg: "ES256" as const,
  };

  if (!overrides?.omitJwk) {
    header.jwk = {
      kty: keyPair.publicJwk.kty,
      crv: keyPair.publicJwk.crv,
      x: keyPair.publicJwk.x,
      y: keyPair.publicJwk.y,
    };
  }

  const payload = {
    jti: overrides?.jti ?? crypto.randomUUID(),
    htm: overrides?.htm ?? TEST_METHOD,
    htu: overrides?.htu ?? TEST_URI,
    iat: overrides?.iat ?? Math.floor(Date.now() / 1000),
  };

  const importedKey = await jose.importJWK(
    await crypto.subtle.exportKey("jwk", keyPair.privateKey),
    "ES256",
  );

  return await new jose.SignJWT(payload)
    .setProtectedHeader(header as jose.JWTHeaderParameters)
    .sign(importedKey);
}

/** Build a Request with specified headers. */
function buildRequest(options: {
  authorization?: string;
  dpopProof?: string;
  cookie?: string;
}): Request {
  const headers = new Headers();
  if (options.authorization) {
    headers.set("Authorization", options.authorization);
  }
  if (options.dpopProof) {
    headers.set("DPoP", options.dpopProof);
  }
  if (options.cookie) {
    headers.set("Cookie", options.cookie);
  }

  return new Request(TEST_URI, {
    method: TEST_METHOD,
    headers,
  });
}

/** Stub workspace lookup -- returns workspace data for known ID, undefined otherwise. */
function createWorkspaceLookupStub() {
  return async (workspaceId: string) => {
    if (workspaceId === TEST_WORKSPACE_ID) {
      return { name: TEST_WORKSPACE_NAME, identityId: TEST_IDENTITY_ID };
    }
    return undefined;
  };
}

function buildDeps() {
  return {
    asSigningKey: asKey,
    nonceCache: createNonceCache(),
    lookupWorkspace: createWorkspaceLookupStub(),
  };
}

/** Parse error response body. */
async function parseErrorBody(
  response: Response,
): Promise<{ error: string; error_description?: string }> {
  return await response.json();
}

// ===========================================================================
// M3-V1: Missing authentication rejected
// ===========================================================================

describe("authenticateDPoPRequest", () => {
  it("rejects request with no Authorization header as 401", async () => {
    const request = buildRequest({});
    const result = await authenticateDPoPRequest(request, buildDeps());

    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response.status).toBe(401);
    const body = await parseErrorBody(response);
    expect(body.error).toBe("dpop_required");
  });

  // ===========================================================================
  // M3-V2: Bearer tokens rejected
  // ===========================================================================

  it("rejects Bearer token with 401 dpop_required", async () => {
    const request = buildRequest({ authorization: "Bearer some-token-here" });
    const result = await authenticateDPoPRequest(request, buildDeps());

    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response.status).toBe(401);
    const body = await parseErrorBody(response);
    expect(body.error).toBe("dpop_required");
    expect(body.error_description).toContain("Bearer");
  });

  // ===========================================================================
  // M3-V2: Session cookies rejected
  // ===========================================================================

  it("rejects session cookie without DPoP as 401 dpop_required", async () => {
    const request = buildRequest({
      cookie: "better-auth.session_token=abc123",
    });
    const result = await authenticateDPoPRequest(request, buildDeps());

    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response.status).toBe(401);
    const body = await parseErrorBody(response);
    expect(body.error).toBe("dpop_required");
  });

  // ===========================================================================
  // M3-V3: Missing DPoP proof header rejected
  // ===========================================================================

  it("rejects DPoP token without DPoP proof header as 401", async () => {
    const token = await issueTestToken();
    const request = buildRequest({ authorization: `DPoP ${token}` });
    const result = await authenticateDPoPRequest(request, buildDeps());

    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response.status).toBe(401);
    const body = await parseErrorBody(response);
    expect(body.error).toBe("invalid_request");
    expect(body.error_description).toContain("DPoP proof");
  });

  // ===========================================================================
  // M3-V3: Invalid access token signature rejected
  // ===========================================================================

  it("rejects access token with invalid signature as 401", async () => {
    // Create a token signed by a different key (not the AS key)
    const fakeAsKey = await generateAsSigningKey();
    const fakeToken = await new jose.SignJWT({
      cnf: { jkt: agentKeyPair.thumbprint },
      authorization_details: TEST_ACTIONS,
      "urn:brain:intent_id": TEST_INTENT_ID,
      "urn:brain:workspace": TEST_WORKSPACE_ID,
    })
      .setProtectedHeader({ alg: "ES256", typ: "at+jwt", kid: fakeAsKey.kid })
      .setSubject(TEST_SUBJECT)
      .setIssuer("https://brain.local")
      .setAudience("https://brain.local")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(fakeAsKey.privateKey);

    const proof = await createDPoPProof(agentKeyPair);
    const request = buildRequest({
      authorization: `DPoP ${fakeToken}`,
      dpopProof: proof,
    });
    const result = await authenticateDPoPRequest(request, buildDeps());

    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response.status).toBe(401);
  });

  // ===========================================================================
  // M3-V4: Wrong method / wrong URI rejected
  // ===========================================================================

  it("rejects DPoP proof with wrong method or URI as 401", async () => {
    const token = await issueTestToken();
    const proof = await createDPoPProof(agentKeyPair, {
      htm: "GET",
      htu: "https://evil.example.com/steal",
    });
    const request = buildRequest({
      authorization: `DPoP ${token}`,
      dpopProof: proof,
    });
    const result = await authenticateDPoPRequest(request, buildDeps());

    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response.status).toBe(401);
  });

  // ===========================================================================
  // M3-V4: Binding mismatch (different key) rejected
  // ===========================================================================

  it("rejects when DPoP proof key differs from token cnf.jkt as 401", async () => {
    // Token bound to agentKeyPair, but proof signed by differentKeyPair
    const token = await issueTestToken({
      thumbprint: agentKeyPair.thumbprint,
    });
    const proof = await createDPoPProof(differentKeyPair);
    const request = buildRequest({
      authorization: `DPoP ${token}`,
      dpopProof: proof,
    });
    const result = await authenticateDPoPRequest(request, buildDeps());

    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response.status).toBe(401);
    const body = await parseErrorBody(response);
    expect(body.error).toBe("dpop_binding_mismatch");
  });

  // ===========================================================================
  // M3-V5: Replayed DPoP proof (same jti) rejected on second use
  // ===========================================================================

  it("rejects replayed DPoP proof with same jti on second use", async () => {
    const deps = buildDeps();
    const token = await issueTestToken();
    const fixedJti = crypto.randomUUID();
    const proof1 = await createDPoPProof(agentKeyPair, { jti: fixedJti });

    // First request succeeds
    const request1 = buildRequest({
      authorization: `DPoP ${token}`,
      dpopProof: proof1,
    });
    const result1 = await authenticateDPoPRequest(request1, deps);
    expect(result1).not.toBeInstanceOf(Response);

    // Second request with same jti rejected
    const proof2 = await createDPoPProof(agentKeyPair, { jti: fixedJti });
    const token2 = await issueTestToken();
    const request2 = buildRequest({
      authorization: `DPoP ${token2}`,
      dpopProof: proof2,
    });
    const result2 = await authenticateDPoPRequest(request2, deps);

    expect(result2).toBeInstanceOf(Response);
    const response = result2 as Response;
    expect(response.status).toBe(401);
    const body = await parseErrorBody(response);
    expect(body.error).toBe("dpop_proof_reused");
  });

  // ===========================================================================
  // M3-V6: Proof 120s in the past rejected (beyond 60s tolerance)
  // ===========================================================================

  it("rejects DPoP proof with iat 120s in the past", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await issueTestToken();
    const proof = await createDPoPProof(agentKeyPair, { iat: now - 120 });
    const request = buildRequest({
      authorization: `DPoP ${token}`,
      dpopProof: proof,
    });
    const result = await authenticateDPoPRequest(request, buildDeps());

    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response.status).toBe(401);
    const body = await parseErrorBody(response);
    expect(body.error).toBe("dpop_proof_expired");
  });

  // ===========================================================================
  // M3-V7: Proof 30s in the future rejected (beyond 5s tolerance)
  // ===========================================================================

  it("rejects DPoP proof with iat 30s in the future", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await issueTestToken();
    const proof = await createDPoPProof(agentKeyPair, { iat: now + 30 });
    const request = buildRequest({
      authorization: `DPoP ${token}`,
      dpopProof: proof,
    });
    const result = await authenticateDPoPRequest(request, buildDeps());

    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response.status).toBe(401);
    const body = await parseErrorBody(response);
    expect(body.error).toBe("dpop_proof_expired");
  });

  // ===========================================================================
  // M3-V8: Proof with missing JWK in header rejected
  // ===========================================================================

  it("rejects DPoP proof with missing JWK in header", async () => {
    const token = await issueTestToken();
    const proof = await createDPoPProof(agentKeyPair, { omitJwk: true });
    const request = buildRequest({
      authorization: `DPoP ${token}`,
      dpopProof: proof,
    });
    const result = await authenticateDPoPRequest(request, buildDeps());

    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response.status).toBe(401);
    const body = await parseErrorBody(response);
    expect(body.error).toBe("dpop_invalid_structure");
  });

  // ===========================================================================
  // M3-V1 through V4: Valid DPoP request grants access
  // ===========================================================================

  it("returns DPoPAuthResult for valid DPoP request", async () => {
    const token = await issueTestToken();
    const proof = await createDPoPProof(agentKeyPair);
    const request = buildRequest({
      authorization: `DPoP ${token}`,
      dpopProof: proof,
    });
    const result = await authenticateDPoPRequest(request, buildDeps());

    // Should NOT be a Response (not an error)
    expect(result).not.toBeInstanceOf(Response);

    const authResult = result as DPoPAuthResult;
    expect(authResult.workspaceRecord.table.name).toBe("workspace");
    expect(authResult.workspaceRecord.id).toBe(TEST_WORKSPACE_ID);
    expect(authResult.workspaceName).toBe(TEST_WORKSPACE_NAME);
    expect(authResult.identityRecord.table.name).toBe("identity");
    expect(authResult.identityRecord.id).toBe(TEST_IDENTITY_ID);
    expect(authResult.actorType).toBe("agent");
    expect(authResult.authorizationDetails).toEqual(TEST_ACTIONS);
    expect(authResult.intentId).toBe(TEST_INTENT_ID);
    expect(authResult.dpopThumbprint).toBe(agentKeyPair.thumbprint);
  });

  // ===========================================================================
  // M5-I3/I4: Identity lifecycle checks at Brain boundary
  // ===========================================================================

  it("rejects request when identity is revoked", async () => {
    const token = await issueTestToken();
    const proof = await createDPoPProof(agentKeyPair);
    const request = buildRequest({
      authorization: `DPoP ${token}`,
      dpopProof: proof,
    });

    const revokedLookup: LookupIdentity = async (id: string) => ({
      identityId: id,
      identityType: "agent" as const,
      identityStatus: "revoked" as const,
      managedBy: "human-owner",
      revokedAt: new Date(),
    });

    const managerLookup: LookupManager = async () => ({
      identityId: "human-owner",
      identityStatus: "active" as const,
    });

    const deps = {
      ...buildDeps(),
      lookupIdentity: revokedLookup,
      lookupManager: managerLookup,
    };

    const result = await authenticateDPoPRequest(request, deps);
    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response.status).toBe(401);
    const body = await parseErrorBody(response);
    expect(body.error).toBe("identity_blocked");
    expect(body.error_description).toContain("revoked");
  });

  it("rejects request when managing human is inactive", async () => {
    const token = await issueTestToken();
    const proof = await createDPoPProof(agentKeyPair);
    const request = buildRequest({
      authorization: `DPoP ${token}`,
      dpopProof: proof,
    });

    const activeManagedAgent: LookupIdentity = async (id: string) => ({
      identityId: id,
      identityType: "agent" as const,
      identityStatus: "active" as const,
      managedBy: "human-inactive",
    });

    const inactiveManagerLookup: LookupManager = async () => ({
      identityId: "human-inactive",
      identityStatus: "revoked" as const,
    });

    const deps = {
      ...buildDeps(),
      lookupIdentity: activeManagedAgent,
      lookupManager: inactiveManagerLookup,
    };

    const result = await authenticateDPoPRequest(request, deps);
    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response.status).toBe(401);
    const body = await parseErrorBody(response);
    expect(body.error).toBe("identity_blocked");
    expect(body.error_description).toContain("inactive");
  });

  it("allows request when identity is active and manager is active", async () => {
    const token = await issueTestToken();
    const proof = await createDPoPProof(agentKeyPair);
    const request = buildRequest({
      authorization: `DPoP ${token}`,
      dpopProof: proof,
    });

    const activeAgentLookup: LookupIdentity = async (id: string) => ({
      identityId: id,
      identityType: "agent" as const,
      identityStatus: "active" as const,
      managedBy: "human-active",
    });

    const activeManagerLookup: LookupManager = async () => ({
      identityId: "human-active",
      identityStatus: "active" as const,
    });

    const deps = {
      ...buildDeps(),
      lookupIdentity: activeAgentLookup,
      lookupManager: activeManagerLookup,
    };

    const result = await authenticateDPoPRequest(request, deps);
    expect(result).not.toBeInstanceOf(Response);
    const authResult = result as DPoPAuthResult;
    expect(authResult.workspaceRecord.id).toBe(TEST_WORKSPACE_ID);
  });

  it("skips identity check when lookup ports not provided (backward compat)", async () => {
    const token = await issueTestToken();
    const proof = await createDPoPProof(agentKeyPair);
    const request = buildRequest({
      authorization: `DPoP ${token}`,
      dpopProof: proof,
    });

    // buildDeps() does not include lookupIdentity/lookupManager
    const result = await authenticateDPoPRequest(request, buildDeps());
    expect(result).not.toBeInstanceOf(Response);
  });
});
