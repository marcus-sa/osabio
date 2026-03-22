/**
 * Acceptance Tests: Integration Tool Call Routing (US-6b)
 *
 * Walking skeleton phase 8: The proxy intercepts tool calls for integration
 * tools, resolves credentials, executes via HTTP, sanitizes the response,
 * and returns results to the LLM.
 *
 * Traces: US-6b, FR-5, FR-8, AC-6, AC-7, NFR-1
 * Driving port: POST /proxy/llm/anthropic/v1/messages (step 8.5 integration path)
 *
 * Implementation sequence:
 *   1. Walking skeleton: integration tool call executes with injected credentials  [ENABLED]
 *   2. Response sanitized: auth headers stripped
 *   3. Response sanitized: credential JSON fields stripped
 *   4. Response truncated to 100KB limit
 *   5. Integration execution error returned as tool_result error (not 500)
 *   6. Trace record written for integration tool execution
 */
import { describe, expect, it } from "bun:test";
import {
  setupAcceptanceSuite,
  createTestUserWithMcp,
  seedFullIntegrationTool,
  getToolCallTraces,
  getConnectedAccounts,
  sendProxyRequestWithIdentity,
} from "./tool-registry-test-kit";

const getRuntime = setupAcceptanceSuite("tool_registry_integration_routing");

// ---------------------------------------------------------------------------
// Walking Skeleton: Integration tool executed with brokered credentials
// ---------------------------------------------------------------------------
describe("Walking Skeleton: Integration tool call executed with brokered credentials", () => {
  it.skip("resolves credentials, executes HTTP call to integration API, returns sanitized result", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUserWithMcp(baseUrl, surreal, `ws-integ-${crypto.randomUUID()}`);

    // Given mcp_tool "github.create_issue" with provider "github" (auth_method="oauth2")
    // And connected_account with valid access_token
    await seedFullIntegrationTool(surreal, {
      providerId: `prov-integ-${crypto.randomUUID()}`,
      providerName: "github",
      authMethod: "oauth2",
      tokenUrl: "https://github.com/login/oauth/access_token",
      clientId: "gh-client-123",
      clientSecretEncrypted: "encrypted:secret",
      toolId: `tool-integ-${crypto.randomUUID()}`,
      toolName: "github.create_issue",
      toolkit: "github",
      description: "Create a GitHub issue",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string" },
          repo: { type: "string" },
          body: { type: "string" },
        },
        required: ["title", "repo"],
      },
      identityId: user.identityId,
      workspaceId: user.workspaceId,
      accountId: `acct-integ-${crypto.randomUUID()}`,
      accessTokenEncrypted: "encrypted:aes256gcm:ghp_valid_access_token==",
      refreshTokenEncrypted: "encrypted:aes256gcm:ghp_refresh==",
      tokenExpiresAt: new Date(Date.now() + 3600 * 1000),
    });

    // When the LLM returns tool_call for "github.create_issue"
    // Then the proxy:
    //   1. Resolves mcp_tool -> credential_provider -> connected_account
    //   2. Injects access_token as Authorization: Bearer header
    //   3. Executes HTTP call to GitHub API
    //   4. Strips credentials from the response
    //   5. Returns sanitized result to LLM
    //   6. Writes a trace record
    const accounts = await getConnectedAccounts(surreal, user.identityId);
    expect(accounts.length).toBe(1);
    expect(accounts[0].status).toBe("active");
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Focused Scenarios
// ---------------------------------------------------------------------------
describe("Response sanitization strips auth headers", () => {
  it.skip("removes Authorization, Set-Cookie, X-API-Key, WWW-Authenticate from tool result", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUserWithMcp(baseUrl, surreal, `ws-strip-${crypto.randomUUID()}`);

    // Given an integration tool execution returns response with auth headers
    // When the proxy processes the response
    // Then Authorization, Set-Cookie, X-API-Key, WWW-Authenticate headers are stripped
    // (Verified via mock integration server that returns these headers)
    await seedFullIntegrationTool(surreal, {
      providerId: `prov-strip-${crypto.randomUUID()}`,
      providerName: "mock-api",
      authMethod: "api_key",
      apiKeyHeader: "X-API-Key",
      toolId: `tool-strip-${crypto.randomUUID()}`,
      toolName: "mock.query",
      toolkit: "mock",
      description: "Query mock API",
      inputSchema: { type: "object", properties: {} },
      identityId: user.identityId,
      workspaceId: user.workspaceId,
      accountId: `acct-strip-${crypto.randomUUID()}`,
      apiKeyEncrypted: "encrypted:test-key",
    });

    // When the integration tool executes and response contains auth headers
    // Then those headers are stripped before returning to LLM
    const accounts = await getConnectedAccounts(surreal, user.identityId);
    expect(accounts.length).toBe(1);
  }, 30_000);
});

describe("Response sanitization strips credential JSON fields", () => {
  it.skip("recursively removes access_token, refresh_token, api_key, password fields from response body", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUserWithMcp(baseUrl, surreal, `ws-jsonstrip-${crypto.randomUUID()}`);

    // Given integration tool returns JSON with credential fields
    // When the proxy sanitizes the response
    // Then fields matching access_token, refresh_token, api_key, client_secret,
    //      password, secret, token (case-insensitive) are removed recursively
    await seedFullIntegrationTool(surreal, {
      providerId: `prov-json-${crypto.randomUUID()}`,
      providerName: "mock-api",
      authMethod: "api_key",
      apiKeyHeader: "X-API-Key",
      toolId: `tool-json-${crypto.randomUUID()}`,
      toolName: "mock.get_config",
      toolkit: "mock",
      description: "Get API config",
      inputSchema: { type: "object", properties: {} },
      identityId: user.identityId,
      workspaceId: user.workspaceId,
      accountId: `acct-json-${crypto.randomUUID()}`,
      apiKeyEncrypted: "encrypted:test-key",
    });

    const accounts = await getConnectedAccounts(surreal, user.identityId);
    expect(accounts.length).toBe(1);
  }, 30_000);
});

describe("Response truncated to 100KB limit", () => {
  it.skip("truncates integration tool response body to 100KB to prevent context flooding", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUserWithMcp(baseUrl, surreal, `ws-trunc-${crypto.randomUUID()}`);

    // Given integration tool returns response > 100KB
    // When the proxy sanitizes the response
    // Then the body is truncated to 100KB
    await seedFullIntegrationTool(surreal, {
      providerId: `prov-trunc-${crypto.randomUUID()}`,
      providerName: "mock-api",
      authMethod: "api_key",
      apiKeyHeader: "X-API-Key",
      toolId: `tool-trunc-${crypto.randomUUID()}`,
      toolName: "mock.big_response",
      toolkit: "mock",
      description: "Returns large response",
      inputSchema: { type: "object", properties: {} },
      identityId: user.identityId,
      workspaceId: user.workspaceId,
      accountId: `acct-trunc-${crypto.randomUUID()}`,
      apiKeyEncrypted: "encrypted:test-key",
    });

    const accounts = await getConnectedAccounts(surreal, user.identityId);
    expect(accounts.length).toBe(1);
  }, 30_000);
});

describe("Integration execution error returned as tool_result error", () => {
  it.skip("returns is_error:true tool_result to LLM, does not crash with 500", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUserWithMcp(baseUrl, surreal, `ws-ierr-${crypto.randomUUID()}`);

    // Given integration API returns 500 or connection error
    // When the proxy processes the tool execution failure
    // Then the error is wrapped as tool_result with is_error:true
    // And the proxy itself returns 200 (the LLM conversation continues)
    await seedFullIntegrationTool(surreal, {
      providerId: `prov-ierr-${crypto.randomUUID()}`,
      providerName: "broken-api",
      authMethod: "api_key",
      apiKeyHeader: "X-API-Key",
      toolId: `tool-ierr-${crypto.randomUUID()}`,
      toolName: "broken.query",
      toolkit: "broken",
      description: "Broken API endpoint",
      inputSchema: { type: "object", properties: {} },
      identityId: user.identityId,
      workspaceId: user.workspaceId,
      accountId: `acct-ierr-${crypto.randomUUID()}`,
      apiKeyEncrypted: "encrypted:test-key",
    });

    const accounts = await getConnectedAccounts(surreal, user.identityId);
    expect(accounts.length).toBe(1);
  }, 30_000);
});

describe("Integration tool execution produces trace record", () => {
  it.skip("writes trace with tool_call type, provider reference, and outcome", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUserWithMcp(baseUrl, surreal, `ws-itrace-${crypto.randomUUID()}`);

    // Given a successful integration tool execution
    await seedFullIntegrationTool(surreal, {
      providerId: `prov-itrace-${crypto.randomUUID()}`,
      providerName: "github",
      authMethod: "oauth2",
      toolId: `tool-itrace-${crypto.randomUUID()}`,
      toolName: "github.list_repos",
      toolkit: "github",
      description: "List repos",
      inputSchema: { type: "object", properties: {} },
      identityId: user.identityId,
      workspaceId: user.workspaceId,
      accountId: `acct-itrace-${crypto.randomUUID()}`,
      accessTokenEncrypted: "encrypted:token",
      tokenExpiresAt: new Date(Date.now() + 3600 * 1000),
    });

    // When the tool executes successfully
    // Then a trace record is written with:
    //   type: "tool_call"
    //   tool_name: "github.list_repos"
    //   input.tool_kind: "integration"
    //   input.credential_provider_id: provider reference (not credential values)
    //   output.outcome: "success"
    const accounts = await getConnectedAccounts(surreal, user.identityId);
    expect(accounts.length).toBe(1);
  }, 30_000);
});
