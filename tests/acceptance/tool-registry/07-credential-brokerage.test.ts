/**
 * Acceptance Tests: Credential Brokerage (US-7)
 *
 * Walking skeleton phase 7: The proxy resolves credentials at tool call time
 * and injects auth headers by provider auth method. OAuth2 tokens are refreshed
 * when expired. Credentials never leak to the LLM.
 *
 * Traces: US-7, FR-8, FR-9, AC-7, NFR-1
 * Driving port: POST /proxy/llm/anthropic/v1/messages (step 8.5 credential path)
 *
 * Implementation sequence:
 *   1. Walking skeleton: API key credential injected into tool execution  [ENABLED]
 *   2. Bearer token credential injection
 *   3. Basic auth credential injection (base64 encoded)
 *   4. OAuth2 token injection (valid token)
 *   5. OAuth2 expired token triggers refresh before execution
 *   6. Refresh failure marks account as expired
 *   7. Missing connected_account returns "not connected" error
 *   8. Revoked account returns "account disconnected" error
 *   9. Credentials stripped from integration tool response
 */
import { describe, expect, it } from "bun:test";
import {
  setupAcceptanceSuite,
  createTestUserWithMcp,
  seedCredentialProvider,
  seedFullIntegrationTool,
  seedConnectedAccount,
  getConnectedAccounts,
  seedToolWithGrant,
  sendProxyRequestWithIdentity,
} from "./tool-registry-test-kit";
import { resolveCredentialsForTool } from "../../../app/src/server/proxy/credential-resolver";
import { encryptSecret } from "../../../app/src/server/tool-registry/encryption";

const TEST_ENCRYPTION_KEY = "0".repeat(64); // 256-bit test key

const getRuntime = setupAcceptanceSuite("tool_registry_credential_brokerage");

// ---------------------------------------------------------------------------
// Walking Skeleton: API key credential resolved and injected at execution
// ---------------------------------------------------------------------------
describe("Walking Skeleton: API key credential injected into tool execution", () => {
  it("resolves connected_account and attaches api_key as provider-specific header", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUserWithMcp(baseUrl, surreal, `ws-broker-${crypto.randomUUID()}`);

    // Given mcp_tool "internal.query" with provider "internal-api" (auth_method="api_key")
    // And connected_account for identity + provider with api_key
    await seedFullIntegrationTool(surreal, {
      providerId: `prov-brok-${crypto.randomUUID()}`,
      providerName: "internal-api",
      authMethod: "api_key",
      apiKeyHeader: "X-API-Key",
      toolId: `tool-brok-${crypto.randomUUID()}`,
      toolName: "internal.query",
      toolkit: "internal",
      description: "Query internal API",
      inputSchema: { type: "object", properties: { query: { type: "string" } } },
      identityId: user.identityId,
      workspaceId: user.workspaceId,
      accountId: `acct-brok-${crypto.randomUUID()}`,
      apiKeyEncrypted: encryptSecret("my-secret-api-key", TEST_ENCRYPTION_KEY),
    });

    // When the credential resolver resolves auth headers for the tool
    const result = await resolveCredentialsForTool(
      "internal.query",
      user.identityId,
      { surreal, toolEncryptionKey: TEST_ENCRYPTION_KEY },
    );

    // Then the api_key is attached as the provider-specific header (X-API-Key)
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.headers["X-API-Key"]).toBe("my-secret-api-key");
    }

    // And the connected_account exists in the DB with correct state
    const accounts = await getConnectedAccounts(surreal, user.identityId);
    expect(accounts.length).toBe(1);
    expect(accounts[0].status).toBe("active");
    expect(accounts[0].api_key_encrypted).toBeDefined();
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Focused Scenarios
// ---------------------------------------------------------------------------
describe("Basic auth credential injected as Authorization header", () => {
  it.skip("constructs Basic base64(username:password) header for basic auth providers", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUserWithMcp(baseUrl, surreal, `ws-basic-${crypto.randomUUID()}`);

    // Given mcp_tool "legacy.fetch" with auth_method="basic"
    // And connected_account with basic_username and basic_password
    await seedFullIntegrationTool(surreal, {
      providerId: `prov-basic-${crypto.randomUUID()}`,
      providerName: "legacy-service",
      authMethod: "basic",
      toolId: `tool-basic-${crypto.randomUUID()}`,
      toolName: "legacy.fetch",
      toolkit: "legacy",
      description: "Fetch from legacy service",
      inputSchema: { type: "object", properties: { endpoint: { type: "string" } } },
      identityId: user.identityId,
      workspaceId: user.workspaceId,
      accountId: `acct-basic-${crypto.randomUUID()}`,
      basicUsername: "admin",
      basicPasswordEncrypted: "encrypted:aes256gcm:password123==",
    });

    // Then credential resolution should produce Authorization: Basic header
    const accounts = await getConnectedAccounts(surreal, user.identityId);
    expect(accounts.length).toBe(1);
    expect(accounts[0].status).toBe("active");
  }, 30_000);
});

describe("OAuth2 valid token injected as Bearer header", () => {
  it.skip("attaches access_token as Authorization: Bearer header when token is valid", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUserWithMcp(baseUrl, surreal, `ws-oauth-${crypto.randomUUID()}`);

    // Given mcp_tool "github.create_issue" with OAuth2 provider
    // And connected_account with valid (non-expired) access_token
    await seedFullIntegrationTool(surreal, {
      providerId: `prov-oauth-${crypto.randomUUID()}`,
      providerName: "github",
      authMethod: "oauth2",
      tokenUrl: "https://github.com/login/oauth/access_token",
      clientId: "gh-client-123",
      clientSecretEncrypted: "encrypted:secret",
      toolId: `tool-oauth-${crypto.randomUUID()}`,
      toolName: "github.create_issue",
      toolkit: "github",
      description: "Create a GitHub issue",
      inputSchema: { type: "object", properties: { title: { type: "string" }, repo: { type: "string" } } },
      identityId: user.identityId,
      workspaceId: user.workspaceId,
      accountId: `acct-oauth-${crypto.randomUUID()}`,
      accessTokenEncrypted: "encrypted:aes256gcm:ghp_valid_token==",
      refreshTokenEncrypted: "encrypted:aes256gcm:ghp_refresh==",
      tokenExpiresAt: new Date(Date.now() + 3600 * 1000), // 1 hour from now
    });

    // Then credential resolution should produce Authorization: Bearer header
    const accounts = await getConnectedAccounts(surreal, user.identityId);
    expect(accounts.length).toBe(1);
    expect(accounts[0].access_token_encrypted).toBeDefined();
  }, 30_000);
});

describe("OAuth2 expired token triggers refresh before execution", () => {
  it.skip("refreshes expired access_token using refresh_token and proceeds with new token", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUserWithMcp(baseUrl, surreal, `ws-refresh-${crypto.randomUUID()}`);

    // Given connected_account with expired access_token and valid refresh_token
    await seedFullIntegrationTool(surreal, {
      providerId: `prov-ref-${crypto.randomUUID()}`,
      providerName: "github",
      authMethod: "oauth2",
      tokenUrl: "http://127.0.0.1:19877/token", // Mock token server
      clientId: "gh-client-123",
      clientSecretEncrypted: "encrypted:secret",
      toolId: `tool-ref-${crypto.randomUUID()}`,
      toolName: "github.list_repos",
      toolkit: "github",
      description: "List repositories",
      inputSchema: { type: "object", properties: {} },
      identityId: user.identityId,
      workspaceId: user.workspaceId,
      accountId: `acct-ref-${crypto.randomUUID()}`,
      accessTokenEncrypted: "encrypted:expired_token",
      refreshTokenEncrypted: "encrypted:valid_refresh_token",
      tokenExpiresAt: new Date(Date.now() - 3600 * 1000), // 1 hour ago (expired)
    });

    // When the proxy detects token_expires_at is past
    // Then it calls the credential_provider.token_url with refresh_token
    // And updates connected_account with new access_token
    // (Verified via mock token server in integration test)
    const accounts = await getConnectedAccounts(surreal, user.identityId);
    expect(accounts.length).toBe(1);
    // Token is expired - the proxy should detect this at execution time
    expect(new Date(accounts[0].token_expires_at as unknown as string).getTime()).toBeLessThan(Date.now());
  }, 30_000);
});

describe("Refresh failure marks account as expired", () => {
  it.skip("sets connected_account.status to expired when refresh_token is invalid", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUserWithMcp(baseUrl, surreal, `ws-reffail-${crypto.randomUUID()}`);

    // Given connected_account with expired access_token and invalid refresh_token
    const accountId = `acct-reffail-${crypto.randomUUID()}`;
    await seedFullIntegrationTool(surreal, {
      providerId: `prov-reffail-${crypto.randomUUID()}`,
      providerName: "github",
      authMethod: "oauth2",
      tokenUrl: "http://127.0.0.1:19878/token-fail", // Mock that rejects refresh
      clientId: "gh-client-123",
      clientSecretEncrypted: "encrypted:secret",
      toolId: `tool-reffail-${crypto.randomUUID()}`,
      toolName: "github.create_issue",
      toolkit: "github",
      description: "Create issue",
      inputSchema: { type: "object", properties: {} },
      identityId: user.identityId,
      workspaceId: user.workspaceId,
      accountId,
      accessTokenEncrypted: "encrypted:expired_token",
      refreshTokenEncrypted: "encrypted:invalid_refresh",
      tokenExpiresAt: new Date(Date.now() - 3600 * 1000), // Expired
    });

    // When proxy attempts refresh and it fails
    // Then connected_account.status is set to "expired"
    // And the proxy returns error: "credentials expired, please reconnect"
    // (Will be verified when credential-resolver is implemented)
    const accounts = await getConnectedAccounts(surreal, user.identityId);
    expect(accounts.length).toBe(1);
  }, 30_000);
});

describe("Missing connected_account returns error to LLM", () => {
  it.skip("returns 'Provider account not connected' when no account exists for identity+provider", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUserWithMcp(baseUrl, surreal, `ws-miss-${crypto.randomUUID()}`);

    // Given agent has can_use edge to "github.create_issue"
    // But no connected_account for provider "github"
    const providerId = `prov-miss-${crypto.randomUUID()}`;
    await seedCredentialProvider(surreal, providerId, {
      name: "github",
      displayName: "GitHub",
      authMethod: "oauth2",
      workspaceId: user.workspaceId,
    });

    await seedToolWithGrant(surreal, {
      toolId: `tool-miss-${crypto.randomUUID()}`,
      toolName: "github.create_issue",
      toolkit: "github",
      description: "Create a GitHub issue",
      inputSchema: { type: "object", properties: { title: { type: "string" } } },
      identityId: user.identityId,
      workspaceId: user.workspaceId,
      providerId,
    });

    // When the proxy intercepts a tool call for github.create_issue
    // Then the proxy returns error: "Provider account not connected."
    // And no API call is made
    const accounts = await getConnectedAccounts(surreal, user.identityId);
    expect(accounts.length).toBe(0);
  }, 30_000);
});

describe("Revoked account returns 'account disconnected' error", () => {
  it.skip("rejects tool execution when connected_account status is revoked", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUserWithMcp(baseUrl, surreal, `ws-revoked-${crypto.randomUUID()}`);

    // Given connected_account with status "revoked"
    const providerId = `prov-revoked-${crypto.randomUUID()}`;
    await seedFullIntegrationTool(surreal, {
      providerId,
      providerName: "github",
      authMethod: "oauth2",
      toolId: `tool-revoked-${crypto.randomUUID()}`,
      toolName: "github.create_issue",
      toolkit: "github",
      description: "Create issue",
      inputSchema: { type: "object", properties: {} },
      identityId: user.identityId,
      workspaceId: user.workspaceId,
      accountId: `acct-revoked-${crypto.randomUUID()}`,
      accessTokenEncrypted: "encrypted:token",
    });

    // Revoke the account
    const accounts = await getConnectedAccounts(surreal, user.identityId);
    const { RecordId: RId } = await import("surrealdb");
    await surreal.query(
      `UPDATE $acct SET status = 'revoked';`,
      { acct: accounts[0].id },
    );

    // When the proxy intercepts a tool call
    // Then it returns "account disconnected" error
    const updatedAccounts = await getConnectedAccounts(surreal, user.identityId);
    expect(updatedAccounts[0].status).toBe("revoked");
  }, 30_000);
});
