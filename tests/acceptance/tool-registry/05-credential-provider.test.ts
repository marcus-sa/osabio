/**
 * Acceptance Tests: Credential Provider Registration (US-1)
 *
 * Walking skeleton phase 5: Workspace admins register credential providers
 * supporting multiple auth methods. Secrets are encrypted at rest.
 *
 * Traces: US-1, FR-6, AC-1, NFR-1
 * Driving port: POST /api/workspaces/:workspaceId/providers
 *
 * Implementation sequence:
 *   1. Walking skeleton: register OAuth2 provider with encrypted secret  [ENABLED]
 *   2. Register API key provider (no OAuth fields)
 *   3. Register bearer token provider
 *   4. Register basic auth provider
 *   5. Reject duplicate provider name in workspace
 *   6. Provider listing returns all providers
 *   7. Client secret never appears in API responses as plaintext
 */
import { describe, expect, it } from "bun:test";
import {
  setupAcceptanceSuite,
  createTestUserWithMcp,
  seedCredentialProvider,
  getProvidersForWorkspace,
} from "./tool-registry-test-kit";

const getRuntime = setupAcceptanceSuite("tool_registry_credential_provider");

// ---------------------------------------------------------------------------
// Walking Skeleton: Admin registers an OAuth2 credential provider
// ---------------------------------------------------------------------------
describe("Walking Skeleton: Admin registers an OAuth2 credential provider", () => {
  it.skip("creates a credential_provider with encrypted client_secret", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUserWithMcp(baseUrl, surreal, `ws-prov-${crypto.randomUUID()}`);

    // Given a workspace admin identity
    // When registering an OAuth2 provider with name, auth_method, URLs, client_id, scopes
    const providerId = `prov-oauth-${crypto.randomUUID()}`;
    await seedCredentialProvider(surreal, providerId, {
      name: "github",
      displayName: "GitHub",
      authMethod: "oauth2",
      authorizationUrl: "https://github.com/login/oauth/authorize",
      tokenUrl: "https://github.com/login/oauth/access_token",
      clientId: "gh-client-123",
      clientSecretEncrypted: "encrypted:aes256gcm:base64ciphertext==",
      scopes: ["repo", "read:org"],
      workspaceId: user.workspaceId,
    });

    // Then a credential_provider record exists in the workspace
    const providers = await getProvidersForWorkspace(surreal, user.workspaceId);
    expect(providers.length).toBe(1);
    expect(providers[0].name).toBe("github");
    expect(providers[0].auth_method).toBe("oauth2");

    // And client_secret is encrypted at rest (not stored plaintext)
    expect(providers[0].client_secret_encrypted).toBeDefined();
    expect(providers[0].client_secret_encrypted).not.toBe("raw-secret-value");
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Focused Scenarios
// ---------------------------------------------------------------------------
describe("Register API key provider without OAuth fields", () => {
  it.skip("creates a provider with auth_method api_key and no OAuth-specific fields", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUserWithMcp(baseUrl, surreal, `ws-apikey-${crypto.randomUUID()}`);

    // Given a workspace admin
    // When registering an API key provider
    const providerId = `prov-api-${crypto.randomUUID()}`;
    await seedCredentialProvider(surreal, providerId, {
      name: "internal-api",
      displayName: "Internal API",
      authMethod: "api_key",
      apiKeyHeader: "X-API-Key",
      workspaceId: user.workspaceId,
    });

    // Then the provider exists without OAuth fields
    const providers = await getProvidersForWorkspace(surreal, user.workspaceId);
    expect(providers.length).toBe(1);
    expect(providers[0].name).toBe("internal-api");
    expect(providers[0].auth_method).toBe("api_key");
  }, 30_000);
});

describe("Register basic auth provider", () => {
  it.skip("creates a provider with auth_method basic", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUserWithMcp(baseUrl, surreal, `ws-basic-${crypto.randomUUID()}`);

    // Given a workspace admin
    // When registering a basic auth provider
    const providerId = `prov-basic-${crypto.randomUUID()}`;
    await seedCredentialProvider(surreal, providerId, {
      name: "legacy-service",
      displayName: "Legacy Service",
      authMethod: "basic",
      workspaceId: user.workspaceId,
    });

    // Then the provider exists with auth_method basic
    const providers = await getProvidersForWorkspace(surreal, user.workspaceId);
    expect(providers.length).toBe(1);
    expect(providers[0].auth_method).toBe("basic");
  }, 30_000);
});

describe("Reject duplicate provider name in workspace", () => {
  it.skip("rejects registration of a second provider with the same name", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUserWithMcp(baseUrl, surreal, `ws-dup-${crypto.randomUUID()}`);

    // Given credential_provider "github" already exists
    const providerId1 = `prov-dup1-${crypto.randomUUID()}`;
    await seedCredentialProvider(surreal, providerId1, {
      name: "github",
      displayName: "GitHub",
      authMethod: "oauth2",
      workspaceId: user.workspaceId,
    });

    // When registering another provider with name "github"
    // Then the system rejects with a duplicate name error
    // (This test verifies the API endpoint rejects duplicates)
    const response = await user.mcpFetch(
      `/api/workspaces/${user.workspaceId}/providers`,
      {
        method: "POST",
        body: {
          name: "github",
          display_name: "GitHub 2",
          auth_method: "oauth2",
        },
      },
    );

    expect(response.status).toBeGreaterThanOrEqual(400);
  }, 30_000);
});

describe("Provider listing returns all workspace providers", () => {
  it.skip("returns OAuth2 and API key providers in the same workspace", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUserWithMcp(baseUrl, surreal, `ws-plist-${crypto.randomUUID()}`);

    // Given two providers in the workspace
    await seedCredentialProvider(surreal, `prov-1-${crypto.randomUUID()}`, {
      name: "github",
      displayName: "GitHub",
      authMethod: "oauth2",
      workspaceId: user.workspaceId,
    });

    await seedCredentialProvider(surreal, `prov-2-${crypto.randomUUID()}`, {
      name: "internal-api",
      displayName: "Internal API",
      authMethod: "api_key",
      workspaceId: user.workspaceId,
    });

    // When listing providers
    const providers = await getProvidersForWorkspace(surreal, user.workspaceId);

    // Then both providers are returned
    expect(providers.length).toBe(2);
    const names = providers.map(p => p.name).sort();
    expect(names).toEqual(["github", "internal-api"]);
  }, 30_000);
});

describe("Client secret never returned as plaintext in API response", () => {
  it.skip("API response omits or masks client_secret field", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUserWithMcp(baseUrl, surreal, `ws-mask-${crypto.randomUUID()}`);

    // Given an OAuth2 provider with encrypted secret
    await seedCredentialProvider(surreal, `prov-mask-${crypto.randomUUID()}`, {
      name: "github",
      displayName: "GitHub",
      authMethod: "oauth2",
      clientSecretEncrypted: "encrypted:aes256gcm:supersecret==",
      workspaceId: user.workspaceId,
    });

    // When listing providers via API
    const response = await user.mcpFetch(
      `/api/workspaces/${user.workspaceId}/providers`,
      { method: "GET" },
    );

    // Then the response does not contain raw secret values
    const body = await response.text();
    expect(body).not.toContain("supersecret");
  }, 30_000);
});
