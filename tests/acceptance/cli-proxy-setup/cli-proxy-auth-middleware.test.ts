/**
 * Acceptance Tests: Proxy Auth Middleware
 *
 * Milestone 2: Brain auth validation at the proxy layer
 *
 * Tests the dual-mode proxy authentication:
 *   - Brain auth (X-Brain-Auth) validates token, uses server API key
 *   - Direct auth (x-api-key) still works (backward compatibility)
 *   - Rejects invalid/expired/revoked Brain tokens
 *   - Derives workspace + identity from token (not from headers)
 *
 * Driving port: POST /proxy/llm/anthropic/v1/messages
 */
import { describe, expect, it } from "bun:test";
import {
  setupAcceptanceSuite,
  createProxyTestWorkspace,
  createProxyTestIdentity,
  requestProxyToken,
  sendBrainAuthProxyRequest,
  seedExpiredProxyToken,
} from "./cli-proxy-test-kit";
import { sendProxyRequest } from "../llm-proxy/llm-proxy-test-kit";

const getRuntime = setupAcceptanceSuite("cli_proxy_auth_mw");

// ---------------------------------------------------------------------------
// Scenario: Proxy rejects request with missing Brain auth headers
// ---------------------------------------------------------------------------
describe("Proxy rejects unauthenticated requests", () => {
  it("returns 401 when neither X-Brain-Auth nor x-api-key is present", async () => {
    const { baseUrl } = getRuntime();

    // Given a request to the LLM proxy with no auth headers
    const response = await fetch(`${baseUrl}/proxy/llm/anthropic/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 20,
        messages: [{ role: "user", content: "test" }],
      }),
    });

    // Then the proxy returns 401 with a clear error
    expect(response.status).toBe(401);
    const body = await response.json() as { error?: { message: string } };
    expect(body.error?.message).toBeDefined();
  }, 10_000);
});

// ---------------------------------------------------------------------------
// Scenario: Proxy rejects invalid Brain auth token
// ---------------------------------------------------------------------------
describe("Proxy rejects invalid tokens", () => {
  it("returns 401 for a fabricated X-Brain-Auth token", async () => {
    const { baseUrl } = getRuntime();

    // Given a request with a fabricated Brain auth token
    const response = await sendBrainAuthProxyRequest(baseUrl, "brp_totally_fake_token_1234");

    // Then the proxy returns 401
    expect(response.status).toBe(401);
  }, 10_000);

  it("returns 401 for an expired proxy token", async () => {
    const { baseUrl, surreal } = getRuntime();

    const workspaceId = `ws-expired-${crypto.randomUUID()}`;
    const identityId = `id-expired-${crypto.randomUUID()}`;

    await createProxyTestWorkspace(surreal, workspaceId);
    await createProxyTestIdentity(surreal, { identityId, workspaceId });

    // Given a proxy token that expired 1 day ago
    // (We seed the token directly in DB since the endpoint won't issue expired tokens)
    const tokenHash = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode("brp_expired_test_token"),
    ).then((buf) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join(""));

    await seedExpiredProxyToken(surreal, `pt-expired-${crypto.randomUUID()}`, {
      tokenHash,
      workspaceId,
      identityId,
      expiredDaysAgo: 1,
    });

    // When a request uses the expired token
    const response = await sendBrainAuthProxyRequest(baseUrl, "brp_expired_test_token");

    // Then the proxy returns 401
    expect(response.status).toBe(401);
  }, 10_000);

  it("returns 401 for a revoked proxy token", async () => {
    const { baseUrl, surreal } = getRuntime();

    const workspaceId = `ws-revoked-${crypto.randomUUID()}`;
    const identityId = `id-revoked-${crypto.randomUUID()}`;

    await createProxyTestWorkspace(surreal, workspaceId);
    await createProxyTestIdentity(surreal, { identityId, workspaceId });

    // Given Priya had a proxy token that was then revoked by re-issuance
    const firstResponse = await requestProxyToken(baseUrl, "test-access-token", workspaceId);
    const { proxy_token: firstToken } = await firstResponse.json() as { proxy_token: string };

    // Re-issue to revoke the first token
    await requestProxyToken(baseUrl, "test-access-token", workspaceId);

    // When a request uses the revoked (first) token
    const proxyResponse = await sendBrainAuthProxyRequest(baseUrl, firstToken);

    // Then the proxy returns 401
    expect(proxyResponse.status).toBe(401);
  }, 15_000);
});

// ---------------------------------------------------------------------------
// Scenario: Direct auth (backward compatibility) still works
// ---------------------------------------------------------------------------
describe("Proxy backward compatibility", () => {
  it("still accepts x-api-key auth when no X-Brain-Auth is present", async () => {
    const { baseUrl, surreal } = getRuntime();

    const workspaceId = `ws-direct-${crypto.randomUUID()}`;
    await createProxyTestWorkspace(surreal, workspaceId);

    // Given an existing user who brings their own Anthropic API key (pre-Brain-auth flow)
    // Note: OPENROUTER_API_KEY won't work here — direct auth sends x-api-key to Anthropic's API
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.warn("Skipping direct auth test: no ANTHROPIC_API_KEY");
      return;
    }

    // When they send a request with x-api-key (no X-Brain-Auth)
    const response = await sendProxyRequest(baseUrl, {
      model: "claude-sonnet-4-20250514",
      stream: false,
      maxTokens: 20,
      messages: [{ role: "user", content: "Say exactly: test" }],
      apiKey,
      workspaceHeader: workspaceId,
    });

    // Then the proxy forwards using the client's API key as before
    expect(response.status).toBe(200);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Scenario: Brain auth derives workspace from token, not from headers
// ---------------------------------------------------------------------------
describe("Proxy workspace derivation from token", () => {
  it("uses workspace from the token record, ignoring X-Brain-Workspace header", async () => {
    const { baseUrl, surreal } = getRuntime();

    const realWorkspaceId = `ws-real-${crypto.randomUUID()}`;
    const spoofedWorkspaceId = `ws-spoofed-${crypto.randomUUID()}`;
    const identityId = `id-derive-${crypto.randomUUID()}`;

    await createProxyTestWorkspace(surreal, realWorkspaceId);
    await createProxyTestWorkspace(surreal, spoofedWorkspaceId);
    await createProxyTestIdentity(surreal, { identityId, workspaceId: realWorkspaceId });

    // Given Priya has a proxy token bound to workspace A
    const tokenResponse = await requestProxyToken(baseUrl, "test-access-token", realWorkspaceId);
    const { proxy_token } = await tokenResponse.json() as { proxy_token: string };

    // When she sends a request with X-Brain-Workspace pointing to workspace B (spoofed)
    const response = await fetch(`${baseUrl}/proxy/llm/anthropic/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
        "X-Brain-Auth": proxy_token,
        "X-Brain-Workspace": spoofedWorkspaceId,
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 20,
        messages: [{ role: "user", content: "Say exactly: test" }],
      }),
    });

    // Then the request succeeds (workspace is derived from token, header ignored)
    // And traces are attributed to workspace A (the real one), not B
    // Note: If the server has no ANTHROPIC_API_KEY, it returns 500 — skip LLM assertions.
    if (response.status === 500) {
      const errBody = await response.json() as { error?: { message?: string } };
      if (errBody.error?.message?.includes("API key not configured")) {
        console.warn("Skipping workspace derivation LLM test: server has no ANTHROPIC_API_KEY");
        return;
      }
    }

    expect(response.status).toBe(200);

    // Note: Trace attribution verification is covered in integration checkpoint tests
  }, 30_000);
});
