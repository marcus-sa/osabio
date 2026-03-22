/**
 * Milestone 2: Account Connection (Static + OAuth2 Initiation)
 *
 * Traces: US-UI-04 (static credentials), US-UI-06 (OAuth2 flow)
 *
 * Tests the account connection endpoints that power the Connect Account
 * dialog and OAuth2 redirect flow. Covers API key, bearer, basic auth
 * connections plus OAuth2 initiation (redirect URL generation).
 *
 * Driving ports:
 *   POST /api/workspaces/:wsId/accounts/connect/:providerId  (connect account)
 *   GET  /api/workspaces/:wsId/accounts                       (list accounts)
 */
import { describe, expect, it } from "bun:test";
import {
  setupToolRegistrySuite,
  createTestUserWithMcp,
  connectAccount,
  listAccounts,
  seedProvider,
  seedAccount,
} from "./tool-registry-ui-test-kit";

const getRuntime = setupToolRegistrySuite("tool_registry_ui_account_connection");

// ---------------------------------------------------------------------------
// Happy Path: Static Credential Connections
// ---------------------------------------------------------------------------
describe("Member connects accounts with static credentials", () => {
  it.skip("connects account with API key", async () => {
    const { baseUrl, surreal } = getRuntime();
    const member = await createTestUserWithMcp(baseUrl, surreal, `ws-apikey-${crypto.randomUUID()}`);

    // Given an API key provider exists
    const { providerId } = await seedProvider(surreal, member.workspaceId, {
      name: "internal-api",
      displayName: "Internal API",
      authMethod: "api_key",
      apiKeyHeader: "X-API-Key",
    });

    // When member submits their API key
    const res = await connectAccount(baseUrl, member, member.workspaceId, providerId, {
      api_key: "sk-test-12345-abcdef",
    });

    // Then the account is connected
    expect(res.status).toBe(201);
    const body = await res.json() as { status: string; has_api_key: boolean };
    expect(body.status).toBe("active");
    expect(body.has_api_key).toBe(true);
  }, 60_000);

  it.skip("connects account with bearer token", async () => {
    const { baseUrl, surreal } = getRuntime();
    const member = await createTestUserWithMcp(baseUrl, surreal, `ws-bearer-${crypto.randomUUID()}`);

    // Given a bearer token provider exists
    const { providerId } = await seedProvider(surreal, member.workspaceId, {
      name: "monitoring-api",
      displayName: "Monitoring API",
      authMethod: "bearer",
    });

    // When member submits their bearer token
    const res = await connectAccount(baseUrl, member, member.workspaceId, providerId, {
      bearer_token: "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.test",
    });

    // Then the account is connected with bearer indicator
    expect(res.status).toBe(201);
    const body = await res.json() as { status: string; has_bearer_token: boolean };
    expect(body.status).toBe("active");
    expect(body.has_bearer_token).toBe(true);
  }, 60_000);

  it.skip("connects account with basic auth credentials", async () => {
    const { baseUrl, surreal } = getRuntime();
    const member = await createTestUserWithMcp(baseUrl, surreal, `ws-basic-${crypto.randomUUID()}`);

    // Given a basic auth provider exists
    const { providerId } = await seedProvider(surreal, member.workspaceId, {
      name: "legacy-service",
      displayName: "Legacy Service",
      authMethod: "basic",
    });

    // When member submits username and password
    const res = await connectAccount(baseUrl, member, member.workspaceId, providerId, {
      basic_username: "carlos",
      basic_password: "secure-password-123",
    });

    // Then the account is connected with basic credential indicator
    expect(res.status).toBe(201);
    const body = await res.json() as { status: string; has_basic_credentials: boolean };
    expect(body.status).toBe("active");
    expect(body.has_basic_credentials).toBe(true);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// OAuth2 Initiation
// ---------------------------------------------------------------------------
describe("Member initiates OAuth2 connection", () => {
  it.skip("returns redirect URL with state parameter for OAuth2 provider", async () => {
    const { baseUrl, surreal } = getRuntime();
    const member = await createTestUserWithMcp(baseUrl, surreal, `ws-oauth-${crypto.randomUUID()}`);

    // Given an OAuth2 provider with authorization URL and scopes
    const { providerId } = await seedProvider(surreal, member.workspaceId, {
      name: "github",
      displayName: "GitHub",
      authMethod: "oauth2",
      authorizationUrl: "https://github.com/login/oauth/authorize",
      tokenUrl: "https://github.com/login/oauth/access_token",
      clientId: "gh-client-123",
      clientSecretEncrypted: "encrypted:aes256gcm:test",
      scopes: ["repo", "read:org"],
    });

    // When member initiates OAuth2 connection
    const res = await connectAccount(baseUrl, member, member.workspaceId, providerId);

    // Then the response contains a redirect URL to the provider
    expect(res.status).toBe(200);
    const body = await res.json() as { redirect_url: string; state: string };
    expect(body.redirect_url).toContain("https://github.com/login/oauth/authorize");
    expect(body.redirect_url).toContain("client_id=gh-client-123");
    expect(body.state).toBeTruthy();
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Error Paths: Credential Validation
// ---------------------------------------------------------------------------
describe("Account connection validates credentials", () => {
  it.skip("rejects empty API key submission", async () => {
    const { baseUrl, surreal } = getRuntime();
    const member = await createTestUserWithMcp(baseUrl, surreal, `ws-empty-${crypto.randomUUID()}`);

    const { providerId } = await seedProvider(surreal, member.workspaceId, {
      name: "internal-api",
      displayName: "Internal API",
      authMethod: "api_key",
    });

    // When member submits without API key
    const res = await connectAccount(baseUrl, member, member.workspaceId, providerId, {});

    // Then validation rejects the request
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("api_key");
  }, 60_000);

  it.skip("rejects empty basic auth credentials", async () => {
    const { baseUrl, surreal } = getRuntime();
    const member = await createTestUserWithMcp(baseUrl, surreal, `ws-emptybasic-${crypto.randomUUID()}`);

    const { providerId } = await seedProvider(surreal, member.workspaceId, {
      name: "legacy",
      displayName: "Legacy",
      authMethod: "basic",
    });

    // When member submits without username and password
    const res = await connectAccount(baseUrl, member, member.workspaceId, providerId, {});

    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("basic_username");
  }, 60_000);

  it.skip("rejects empty bearer token submission", async () => {
    const { baseUrl, surreal } = getRuntime();
    const member = await createTestUserWithMcp(baseUrl, surreal, `ws-emptybearer-${crypto.randomUUID()}`);

    const { providerId } = await seedProvider(surreal, member.workspaceId, {
      name: "monitoring",
      displayName: "Monitoring",
      authMethod: "bearer",
    });

    const res = await connectAccount(baseUrl, member, member.workspaceId, providerId, {});

    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("bearer_token");
  }, 60_000);

  it.skip("rejects connection to nonexistent provider", async () => {
    const { baseUrl, surreal } = getRuntime();
    const member = await createTestUserWithMcp(baseUrl, surreal, `ws-noprov-${crypto.randomUUID()}`);

    // When member tries to connect to a provider that does not exist
    const res = await connectAccount(
      baseUrl,
      member,
      member.workspaceId,
      "nonexistent-provider-id",
      { api_key: "key" },
    );

    expect(res.status).toBe(404);
  }, 60_000);

  it.skip("rejects duplicate connection for same identity and provider", async () => {
    const { baseUrl, surreal } = getRuntime();
    const member = await createTestUserWithMcp(baseUrl, surreal, `ws-dup-${crypto.randomUUID()}`);

    const { providerId } = await seedProvider(surreal, member.workspaceId, {
      name: "internal-api",
      displayName: "Internal API",
      authMethod: "api_key",
    });

    // Given member already has an active connection to this provider
    await seedAccount(surreal, {
      identityId: member.identityId,
      providerId,
      workspaceId: member.workspaceId,
      apiKeyEncrypted: "encrypted:existing-key",
    });

    // When member tries to connect again
    const res = await connectAccount(baseUrl, member, member.workspaceId, providerId, {
      api_key: "new-key",
    });

    // Then the duplicate is rejected
    expect(res.status).toBe(409);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("already exists");
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Security: Credentials Never in Responses
// ---------------------------------------------------------------------------
describe("Account API never exposes credentials", () => {
  it.skip("API key is not returned in account creation response", async () => {
    const { baseUrl, surreal } = getRuntime();
    const member = await createTestUserWithMcp(baseUrl, surreal, `ws-seckey-${crypto.randomUUID()}`);

    const { providerId } = await seedProvider(surreal, member.workspaceId, {
      name: "internal-api",
      displayName: "Internal API",
      authMethod: "api_key",
    });

    const res = await connectAccount(baseUrl, member, member.workspaceId, providerId, {
      api_key: "secret-api-key-value",
    });

    const bodyText = await res.text();
    expect(bodyText).not.toContain("secret-api-key-value");
  }, 60_000);

  it.skip("credentials are not returned in account list response", async () => {
    const { baseUrl, surreal } = getRuntime();
    const member = await createTestUserWithMcp(baseUrl, surreal, `ws-seclist-${crypto.randomUUID()}`);

    const { providerId } = await seedProvider(surreal, member.workspaceId, {
      name: "internal-api",
      displayName: "Internal API",
      authMethod: "api_key",
    });

    await seedAccount(surreal, {
      identityId: member.identityId,
      providerId,
      workspaceId: member.workspaceId,
      apiKeyEncrypted: "encrypted:secret-cipher",
    });

    const res = await listAccounts(baseUrl, member, member.workspaceId);
    const bodyText = await res.text();
    expect(bodyText).not.toContain("encrypted:secret-cipher");
  }, 60_000);
});
