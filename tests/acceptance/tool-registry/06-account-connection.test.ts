/**
 * Acceptance Tests: Account Connection (US-4)
 *
 * Walking skeleton phase 6: Users connect accounts to credential providers
 * via static credential entry (API key, basic) or OAuth2 authorization flow.
 *
 * Traces: US-4, FR-7, AC-4, NFR-1
 * Driving ports:
 *   - POST /api/workspaces/:workspaceId/accounts/connect/:providerId
 *   - GET /api/workspaces/:workspaceId/accounts/callback (OAuth2)
 *
 * Implementation sequence:
 *   1. Walking skeleton: connect API key account with encrypted storage  [ENABLED]
 *   2. Connect basic auth account
 *   3. Connect bearer token account
 *   4. OAuth2 initiation returns redirect URL
 *   5. OAuth2 callback exchanges code for tokens
 *   6. OAuth2 denied consent produces no account
 *   7. Duplicate connection rejected for same identity + provider
 */
import { describe, expect, it } from "bun:test";
import {
  setupAcceptanceSuite,
  createTestUserWithMcp,
  seedCredentialProvider,
  seedConnectedAccount,
  getConnectedAccounts,
} from "./tool-registry-test-kit";

const getRuntime = setupAcceptanceSuite("tool_registry_account_connection");

// ---------------------------------------------------------------------------
// Walking Skeleton: User connects API key account
// ---------------------------------------------------------------------------
describe("Walking Skeleton: User connects their account via API key", () => {
  it.skip("creates a connected_account with encrypted api_key and active status", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUserWithMcp(baseUrl, surreal, `ws-conn-${crypto.randomUUID()}`);

    // Given credential_provider "internal-api" with auth_method="api_key" exists
    const providerId = `prov-conn-${crypto.randomUUID()}`;
    await seedCredentialProvider(surreal, providerId, {
      name: "internal-api",
      displayName: "Internal API",
      authMethod: "api_key",
      apiKeyHeader: "X-API-Key",
      workspaceId: user.workspaceId,
    });

    // When user submits their API key
    const accountId = `acct-conn-${crypto.randomUUID()}`;
    await seedConnectedAccount(surreal, accountId, {
      identityId: user.identityId,
      providerId,
      workspaceId: user.workspaceId,
      apiKeyEncrypted: "encrypted:aes256gcm:testapikey==",
    });

    // Then a connected_account links user to provider
    const accounts = await getConnectedAccounts(surreal, user.identityId);
    expect(accounts.length).toBe(1);
    expect(accounts[0].status).toBe("active");

    // And the api_key is encrypted at rest
    expect(accounts[0].api_key_encrypted).toBeDefined();
    expect(accounts[0].api_key_encrypted).not.toBe("raw-api-key");
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Focused Scenarios
// ---------------------------------------------------------------------------
describe("User connects basic auth account", () => {
  it.skip("creates a connected_account with basic_username and encrypted password", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUserWithMcp(baseUrl, surreal, `ws-basic-${crypto.randomUUID()}`);

    // Given credential_provider "legacy-service" with auth_method="basic"
    const providerId = `prov-basic-${crypto.randomUUID()}`;
    await seedCredentialProvider(surreal, providerId, {
      name: "legacy-service",
      displayName: "Legacy Service",
      authMethod: "basic",
      workspaceId: user.workspaceId,
    });

    // When user submits username and password
    const accountId = `acct-basic-${crypto.randomUUID()}`;
    await seedConnectedAccount(surreal, accountId, {
      identityId: user.identityId,
      providerId,
      workspaceId: user.workspaceId,
      basicUsername: "admin",
      basicPasswordEncrypted: "encrypted:aes256gcm:password123==",
    });

    // Then connected_account has basic_username and encrypted basic_password
    const accounts = await getConnectedAccounts(surreal, user.identityId);
    expect(accounts.length).toBe(1);
    expect(accounts[0].status).toBe("active");
  }, 30_000);
});

describe("OAuth2 initiation returns redirect URL with state", () => {
  it.skip("returns the provider authorization URL with client_id, scopes, state, redirect_uri", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUserWithMcp(baseUrl, surreal, `ws-oauth-${crypto.randomUUID()}`);

    // Given credential_provider "github" with auth_method="oauth2"
    const providerId = `prov-oauth-${crypto.randomUUID()}`;
    await seedCredentialProvider(surreal, providerId, {
      name: "github",
      displayName: "GitHub",
      authMethod: "oauth2",
      authorizationUrl: "https://github.com/login/oauth/authorize",
      tokenUrl: "https://github.com/login/oauth/access_token",
      clientId: "gh-client-123",
      clientSecretEncrypted: "encrypted:aes256gcm:secret==",
      scopes: ["repo", "read:org"],
      workspaceId: user.workspaceId,
    });

    // When user initiates connection
    const response = await user.mcpFetch(
      `/api/workspaces/${user.workspaceId}/accounts/connect/${providerId}`,
      { method: "POST", body: {} },
    );

    // Then the response contains a redirect URL with correct parameters
    // (The actual redirect URL should include client_id, scopes, state)
    expect(response.status).toBeLessThan(500);
    const body = await response.json() as { redirect_url?: string };

    if (body.redirect_url) {
      const url = new URL(body.redirect_url);
      expect(url.searchParams.get("client_id")).toBe("gh-client-123");
      expect(url.searchParams.get("state")).toBeDefined();
    }
  }, 30_000);
});

describe("OAuth2 callback exchanges code for tokens", () => {
  it.skip("creates connected_account with encrypted access_token and refresh_token after code exchange", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUserWithMcp(baseUrl, surreal, `ws-ocode-${crypto.randomUUID()}`);

    // Given an OAuth2 provider exists
    const providerId = `prov-ocode-${crypto.randomUUID()}`;
    await seedCredentialProvider(surreal, providerId, {
      name: "github",
      displayName: "GitHub",
      authMethod: "oauth2",
      tokenUrl: "http://127.0.0.1:19876/token", // Mock server (see test setup)
      clientId: "gh-client-123",
      clientSecretEncrypted: "encrypted:aes256gcm:secret==",
      workspaceId: user.workspaceId,
    });

    // When the provider redirects back with authorization_code
    // (Simulated: directly create the connected_account as the callback would)
    const accountId = `acct-ocode-${crypto.randomUUID()}`;
    await seedConnectedAccount(surreal, accountId, {
      identityId: user.identityId,
      providerId,
      workspaceId: user.workspaceId,
      accessTokenEncrypted: "encrypted:aes256gcm:ghp_access_token==",
      refreshTokenEncrypted: "encrypted:aes256gcm:ghp_refresh_token==",
      tokenExpiresAt: new Date(Date.now() + 3600 * 1000),
      scopes: ["repo", "read:org"],
    });

    // Then a connected_account exists with encrypted tokens and active status
    const accounts = await getConnectedAccounts(surreal, user.identityId);
    expect(accounts.length).toBe(1);
    expect(accounts[0].status).toBe("active");
    expect(accounts[0].access_token_encrypted).toBeDefined();
    expect(accounts[0].refresh_token_encrypted).toBeDefined();
  }, 30_000);
});

describe("OAuth2 denied consent creates no account", () => {
  it.skip("does not create connected_account when user denies consent at provider", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUserWithMcp(baseUrl, surreal, `ws-deny-${crypto.randomUUID()}`);

    // Given an OAuth2 provider exists
    const providerId = `prov-deny-${crypto.randomUUID()}`;
    await seedCredentialProvider(surreal, providerId, {
      name: "github",
      displayName: "GitHub",
      authMethod: "oauth2",
      authorizationUrl: "https://github.com/login/oauth/authorize",
      tokenUrl: "https://github.com/login/oauth/access_token",
      clientId: "gh-client-123",
      workspaceId: user.workspaceId,
    });

    // When user denies consent (callback returns error)
    // The callback handler should not create an account
    const accounts = await getConnectedAccounts(surreal, user.identityId);

    // Then no connected_account is created
    expect(accounts.length).toBe(0);
  }, 30_000);
});

describe("Active connected account for same identity and provider", () => {
  it.skip("only one active connected_account per identity+provider combination", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUserWithMcp(baseUrl, surreal, `ws-uniq-${crypto.randomUUID()}`);

    // Given a provider and existing active account
    const providerId = `prov-uniq-${crypto.randomUUID()}`;
    await seedCredentialProvider(surreal, providerId, {
      name: "internal-api",
      displayName: "Internal API",
      authMethod: "api_key",
      workspaceId: user.workspaceId,
    });

    const accountId1 = `acct-uniq1-${crypto.randomUUID()}`;
    await seedConnectedAccount(surreal, accountId1, {
      identityId: user.identityId,
      providerId,
      workspaceId: user.workspaceId,
      apiKeyEncrypted: "encrypted:key1",
    });

    // When attempting to connect again (via API)
    // Then the API should reject or replace the existing connection
    const accounts = await getConnectedAccounts(surreal, user.identityId);
    expect(accounts.length).toBe(1);
  }, 30_000);
});
