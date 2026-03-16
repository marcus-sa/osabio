/**
 * Acceptance Tests: Proxy Token Endpoint
 *
 * Milestone 1: POST /api/auth/proxy-token
 *
 * Tests the server-side proxy token lifecycle:
 *   - Issuance with workspace scoping
 *   - Token storage as SHA-256 hash
 *   - Re-issuance revokes previous tokens
 *   - Rejects unauthorized requests
 *
 * Driving port: POST /api/auth/proxy-token
 */
import { describe, expect, it } from "bun:test";
import {
  setupAcceptanceSuite,
  createProxyTestWorkspace,
  createProxyTestUser,
  requestProxyToken,
  getProxyTokensForIdentity,
  countActiveProxyTokens,
} from "./cli-proxy-test-kit";

const getRuntime = setupAcceptanceSuite("cli_proxy_token_ep");

// ---------------------------------------------------------------------------
// Scenario: Token is stored as SHA-256 hash (never plaintext)
// ---------------------------------------------------------------------------
describe("Proxy token storage", () => {
  it("stores the token as a SHA-256 hash, not plaintext", async () => {
    const { baseUrl, surreal } = getRuntime();

    const user = await createProxyTestUser(baseUrl, surreal, "hash");

    // Given Priya requests a proxy token
    const response = await requestProxyToken(baseUrl, user.sessionHeaders, user.workspaceId);
    expect(response.status).toBe(200);

    const { proxy_token } = await response.json() as { proxy_token: string };

    // When we inspect the stored token in the database
    const tokens = await getProxyTokensForIdentity(surreal, user.identityId, user.workspaceId);

    // Then the plaintext token does not appear in the record
    expect(tokens.length).toBeGreaterThanOrEqual(1);
    const stored = tokens[0];
    expect(stored.token_hash).not.toBe(proxy_token);
    expect(stored.token_hash).not.toContain("brp_");

    // And the hash is a 64-char hex string (SHA-256)
    expect(stored.token_hash).toMatch(/^[0-9a-f]{64}$/);
  }, 15_000);
});

// ---------------------------------------------------------------------------
// Scenario: Re-issuance revokes previous tokens
// ---------------------------------------------------------------------------
describe("Proxy token re-issuance", () => {
  it("revokes previous tokens for the same identity+workspace when a new one is issued", async () => {
    const { baseUrl, surreal } = getRuntime();

    const user = await createProxyTestUser(baseUrl, surreal, "reissue");

    // Given Priya already has a proxy token
    const firstResponse = await requestProxyToken(baseUrl, user.sessionHeaders, user.workspaceId);
    expect(firstResponse.status).toBe(200);
    const { proxy_token: firstToken } = await firstResponse.json() as { proxy_token: string };

    // When she runs brain init again and a new token is issued
    const secondResponse = await requestProxyToken(baseUrl, user.sessionHeaders, user.workspaceId);
    expect(secondResponse.status).toBe(200);
    const { proxy_token: secondToken } = await secondResponse.json() as { proxy_token: string };

    // Then the tokens are different
    expect(secondToken).not.toBe(firstToken);

    // And only one active token exists for this identity+workspace
    const activeCount = await countActiveProxyTokens(surreal, user.identityId, user.workspaceId);
    expect(activeCount).toBe(1);

    // And the old token is marked as revoked
    const allTokens = await getProxyTokensForIdentity(surreal, user.identityId, user.workspaceId);
    const revokedTokens = allTokens.filter((t) => t.revoked);
    expect(revokedTokens.length).toBeGreaterThanOrEqual(1);
  }, 15_000);
});

// ---------------------------------------------------------------------------
// Scenario: Rejects request without valid access token
// ---------------------------------------------------------------------------
describe("Proxy token auth enforcement", () => {
  it("rejects token request without a valid OAuth access token", async () => {
    const { baseUrl, surreal } = getRuntime();

    const workspaceId = `ws-noauth-${crypto.randomUUID()}`;
    await createProxyTestWorkspace(surreal, workspaceId);

    // Given a request with no Authorization header
    const response = await fetch(`${baseUrl}/api/auth/proxy-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspace_id: workspaceId }),
    });

    // Then the server returns 401
    expect(response.status).toBe(401);
  }, 10_000);

  it("rejects token request for a workspace the user does not belong to", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Priya has access to her own workspace (created by createProxyTestUser)
    const user = await createProxyTestUser(baseUrl, surreal, "noaccess");

    // Create another workspace that Priya is NOT a member of
    const otherWorkspaceId = `ws-other-${crypto.randomUUID()}`;
    await createProxyTestWorkspace(surreal, otherWorkspaceId);

    // Given Priya has access to workspace A but NOT workspace B
    // When she requests a proxy token for workspace B
    const response = await requestProxyToken(baseUrl, user.sessionHeaders, otherWorkspaceId);

    // Then the server returns 403
    expect(response.status).toBe(403);
  }, 10_000);
});
