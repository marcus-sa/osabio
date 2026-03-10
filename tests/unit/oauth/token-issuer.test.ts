/**
 * Unit tests for DPoP-bound token issuer.
 *
 * Tests:
 * - Token contains cnf.jkt matching actor thumbprint
 * - Token embeds authorization_details and urn:brain:intent_id
 * - Token TTL is at most 300 seconds
 * - Token signed with AS ES256 key, verifiable via AS public key
 *
 * Step: 02-02
 */
import { describe, expect, it } from "bun:test";
import * as jose from "jose";
import { generateAsSigningKey } from "../../../app/src/server/oauth/as-key-management";
import { issueAccessToken } from "../../../app/src/server/oauth/token-issuer";
import type { BrainAction } from "../../../app/src/server/oauth/types";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createTestInput() {
  return {
    sub: "identity:actor-123",
    thumbprint: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
    authorizationDetails: [
      {
        type: "brain_action" as const,
        action: "evaluate",
        resource: "intent:eval-001",
      },
    ] satisfies BrainAction[],
    intentId: "intent-abc-123",
    workspace: "workspace-xyz-456",
    actorType: "agent" as const,
  };
}

async function createTestSigningKey() {
  return generateAsSigningKey();
}

async function decodeToken(token: string, signingKey: Awaited<ReturnType<typeof createTestSigningKey>>) {
  const publicKey = await jose.importJWK(signingKey.publicJwk, "ES256");
  return jose.jwtVerify(token, publicKey, {
    algorithms: ["ES256"],
  });
}

// ===========================================================================
// issueAccessToken: DPoP-bound access token issuance
// ===========================================================================

describe("issueAccessToken", () => {
  // -------------------------------------------------------------------------
  // AC: Issued token contains cnf.jkt matching actor thumbprint
  // -------------------------------------------------------------------------

  it("includes cnf.jkt matching the provided DPoP thumbprint", async () => {
    const signingKey = await createTestSigningKey();
    const input = createTestInput();

    const result = await issueAccessToken(signingKey, input);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { payload } = await decodeToken(result.token, signingKey);
    expect(payload.cnf).toEqual({ jkt: input.thumbprint });
  });

  // -------------------------------------------------------------------------
  // AC: Token embeds authorization_details and urn:brain:intent_id
  // -------------------------------------------------------------------------

  it("embeds authorization_details array in the token payload", async () => {
    const signingKey = await createTestSigningKey();
    const input = createTestInput();

    const result = await issueAccessToken(signingKey, input);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { payload } = await decodeToken(result.token, signingKey);
    expect(payload.authorization_details).toEqual(input.authorizationDetails);
  });

  it("embeds urn:brain:intent_id in the token payload", async () => {
    const signingKey = await createTestSigningKey();
    const input = createTestInput();

    const result = await issueAccessToken(signingKey, input);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { payload } = await decodeToken(result.token, signingKey);
    expect(payload["urn:brain:intent_id"]).toBe(input.intentId);
  });

  it("embeds urn:brain:workspace in the token payload", async () => {
    const signingKey = await createTestSigningKey();
    const input = createTestInput();

    const result = await issueAccessToken(signingKey, input);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { payload } = await decodeToken(result.token, signingKey);
    expect(payload["urn:brain:workspace"]).toBe(input.workspace);
  });

  it("embeds urn:brain:actor_type when provided", async () => {
    const signingKey = await createTestSigningKey();
    const input = createTestInput();

    const result = await issueAccessToken(signingKey, input);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { payload } = await decodeToken(result.token, signingKey);
    expect(payload["urn:brain:actor_type"]).toBe("agent");
  });

  // -------------------------------------------------------------------------
  // AC: Token TTL is at most 300 seconds
  // -------------------------------------------------------------------------

  it("defaults TTL to 300 seconds", async () => {
    const signingKey = await createTestSigningKey();
    const input = createTestInput();

    const result = await issueAccessToken(signingKey, input);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { payload } = await decodeToken(result.token, signingKey);
    const ttl = payload.exp! - payload.iat!;
    expect(ttl).toBe(300);
  });

  it("respects custom TTL when under 300 seconds", async () => {
    const signingKey = await createTestSigningKey();
    const input = createTestInput();

    const result = await issueAccessToken(signingKey, input, { ttlSeconds: 120 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { payload } = await decodeToken(result.token, signingKey);
    const ttl = payload.exp! - payload.iat!;
    expect(ttl).toBe(120);
  });

  it("clamps TTL to 300 seconds when requested TTL exceeds maximum", async () => {
    const signingKey = await createTestSigningKey();
    const input = createTestInput();

    const result = await issueAccessToken(signingKey, input, { ttlSeconds: 600 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { payload } = await decodeToken(result.token, signingKey);
    const ttl = payload.exp! - payload.iat!;
    expect(ttl).toBe(300);
  });

  it("returns expiresAt matching the token exp claim", async () => {
    const signingKey = await createTestSigningKey();
    const input = createTestInput();

    const result = await issueAccessToken(signingKey, input);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { payload } = await decodeToken(result.token, signingKey);
    const expectedExpiresAt = new Date(payload.exp! * 1000);
    expect(result.expiresAt.getTime()).toBe(expectedExpiresAt.getTime());
  });

  // -------------------------------------------------------------------------
  // AC: Token signed with AS ES256 key, verifiable via AS public key
  // -------------------------------------------------------------------------

  it("signs the token with ES256 and sets at+jwt type header", async () => {
    const signingKey = await createTestSigningKey();
    const input = createTestInput();

    const result = await issueAccessToken(signingKey, input);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { protectedHeader } = await decodeToken(result.token, signingKey);
    expect(protectedHeader.alg).toBe("ES256");
    expect(protectedHeader.typ).toBe("at+jwt");
    expect(protectedHeader.kid).toBe(signingKey.kid);
  });

  it("is verifiable using the AS public key via JWKS", async () => {
    const signingKey = await createTestSigningKey();
    const input = createTestInput();

    const result = await issueAccessToken(signingKey, input);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Verify via local JWKS (same path as /.well-known/jwks)
    const jwks = jose.createLocalJWKSet({
      keys: [signingKey.publicJwk as jose.JWK],
    });

    const { payload } = await jose.jwtVerify(result.token, jwks);
    expect(payload.sub).toBe(input.sub);
  });

  // -------------------------------------------------------------------------
  // Token payload completeness
  // -------------------------------------------------------------------------

  it("sets sub and standard JWT claims (iss, aud, iat)", async () => {
    const signingKey = await createTestSigningKey();
    const input = createTestInput();

    const result = await issueAccessToken(signingKey, input, {
      issuer: "https://brain.example.com",
      audience: "https://api.brain.example.com",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { payload } = await decodeToken(result.token, signingKey);
    expect(payload.sub).toBe(input.sub);
    expect(payload.iss).toBe("https://brain.example.com");
    expect(payload.aud).toBe("https://api.brain.example.com");
    expect(payload.iat).toBeDefined();
  });
});
