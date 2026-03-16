/**
 * Acceptance Tests: CLI Proxy Setup Walking Skeleton
 *
 * Two thinnest E2E slices proving the proxy auth flow works end-to-end:
 * 1. Token issuance — server issues a proxy token for a valid identity+workspace
 * 2. Proxy auth — request with Brain auth header succeeds through proxy
 *
 * Each skeleton builds on the previous. Implement in order.
 * Driving ports:
 *   - POST /api/auth/proxy-token
 *   - POST /proxy/llm/anthropic/v1/messages (with X-Brain-Auth)
 */
import { describe, expect, it } from "bun:test";
import {
  setupAcceptanceSuite,
  createProxyTestWorkspace,
  createProxyTestIdentity,
  requestProxyToken,
  sendBrainAuthProxyRequest,
} from "./cli-proxy-test-kit";

const getRuntime = setupAcceptanceSuite("cli_proxy_skeleton");

// ---------------------------------------------------------------------------
// Skeleton 1: Server issues a proxy token for a valid identity+workspace
// ---------------------------------------------------------------------------
describe("Skeleton 1: Proxy token issuance", () => {
  it("issues a brp_-prefixed token with 90-day expiry for an authenticated user", async () => {
    const { baseUrl, surreal } = getRuntime();

    const workspaceId = `ws-skel1-${crypto.randomUUID()}`;
    const identityId = `id-skel1-${crypto.randomUUID()}`;

    // Given Priya has completed OAuth and has a valid access token
    await createProxyTestWorkspace(surreal, workspaceId);
    await createProxyTestIdentity(surreal, { identityId, workspaceId });

    // When brain init Step 7 requests a proxy token
    const response = await requestProxyToken(baseUrl, "test-access-token", workspaceId);

    // Then the server returns a proxy token with brp_ prefix
    expect(response.status).toBe(200);

    const body = await response.json() as {
      proxy_token: string;
      expires_at: string;
      workspace_id: string;
    };

    expect(body.proxy_token).toMatch(/^brp_/);
    expect(body.workspace_id).toBe(workspaceId);

    // And the token expires at least 89 days from now (90-day TTL)
    const expiresAt = new Date(body.expires_at);
    const daysUntilExpiry = (expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    expect(daysUntilExpiry).toBeGreaterThan(89);
  }, 15_000);
});

// ---------------------------------------------------------------------------
// Skeleton 2: Proxy request with Brain auth header succeeds
// ---------------------------------------------------------------------------
describe("Skeleton 2: Brain-authenticated proxy request", () => {
  it("forwards a request to Anthropic using server-held API key when X-Brain-Auth is valid", async () => {
    const { baseUrl, surreal } = getRuntime();

    const workspaceId = `ws-skel2-${crypto.randomUUID()}`;
    const identityId = `id-skel2-${crypto.randomUUID()}`;

    // Given Priya has a valid proxy token from brain init
    await createProxyTestWorkspace(surreal, workspaceId);
    await createProxyTestIdentity(surreal, { identityId, workspaceId });

    const tokenResponse = await requestProxyToken(baseUrl, "test-access-token", workspaceId);
    expect(tokenResponse.status).toBe(200);
    const { proxy_token } = await tokenResponse.json() as { proxy_token: string };

    // When Claude Code sends a request through the proxy with X-Brain-Auth
    // (no x-api-key — the server uses its own Anthropic key)
    const proxyResponse = await sendBrainAuthProxyRequest(baseUrl, proxy_token, {
      model: "claude-sonnet-4-20250514",
      maxTokens: 20,
      messages: [{ role: "user", content: "Say exactly: test" }],
    });

    // Then the proxy forwards using the server's API key and returns the model response
    // Note: If the server has no ANTHROPIC_API_KEY configured, it returns 500.
    // Skip the LLM assertions in that case — the auth flow itself still works.
    if (proxyResponse.status === 500) {
      const errBody = await proxyResponse.json() as { error?: { message?: string } };
      if (errBody.error?.message?.includes("API key not configured")) {
        console.warn("Skipping Skeleton 2 LLM assertions: server has no ANTHROPIC_API_KEY");
        return;
      }
    }

    expect(proxyResponse.status).toBe(200);

    const body = await proxyResponse.json() as {
      type: string;
      role: string;
      content: Array<{ type: string; text: string }>;
    };

    expect(body.type).toBe("message");
    expect(body.role).toBe("assistant");
    expect(body.content.length).toBeGreaterThan(0);
  }, 30_000);
});
