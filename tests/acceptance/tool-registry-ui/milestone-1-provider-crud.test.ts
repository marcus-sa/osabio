/**
 * Milestone 1: Provider Registration and Listing
 *
 * Traces: US-UI-03 (register provider), US-UI-01 (empty state)
 *
 * Tests the credential provider CRUD endpoints that power the Providers tab.
 * Covers all four auth methods, duplicate name validation, error preservation,
 * and the empty state experience.
 *
 * Driving ports:
 *   POST /api/workspaces/:wsId/providers   (create provider)
 *   GET  /api/workspaces/:wsId/providers    (list providers)
 */
import { describe, expect, it } from "bun:test";
import {
  setupToolRegistrySuite,
  createTestUserWithMcp,
  createProvider,
  listProviders,
  seedProvider,
} from "./tool-registry-ui-test-kit";

const getRuntime = setupToolRegistrySuite("tool_registry_ui_provider_crud");

// ---------------------------------------------------------------------------
// Happy Path: Provider Registration per Auth Method
// ---------------------------------------------------------------------------
describe("Admin registers providers with different auth methods", () => {
  it.skip("registers an OAuth2 provider with all OAuth-specific fields", async () => {
    const { baseUrl, surreal } = getRuntime();
    const admin = await createTestUserWithMcp(baseUrl, surreal, `ws-oauth-${crypto.randomUUID()}`);

    // Given a workspace with no providers
    // When admin registers an OAuth2 provider
    const res = await createProvider(baseUrl, admin, admin.workspaceId, {
      name: "github",
      display_name: "GitHub",
      auth_method: "oauth2",
      authorization_url: "https://github.com/login/oauth/authorize",
      token_url: "https://github.com/login/oauth/access_token",
      client_id: "Ov23liABC123",
      client_secret: "secret-value-never-returned",
      scopes: ["repo", "read:org"],
    });

    // Then the provider is created with OAuth fields
    expect(res.status).toBe(201);
    const body = await res.json() as Record<string, unknown>;
    expect(body.name).toBe("github");
    expect(body.auth_method).toBe("oauth2");
    expect(body.client_id).toBe("Ov23liABC123");
    expect(body.scopes).toEqual(["repo", "read:org"]);

    // And client_secret is marked as present but never returned as plaintext
    expect(body.has_client_secret).toBe(true);
    expect(body.client_secret).toBeUndefined();
    expect(body.client_secret_encrypted).toBeUndefined();
  }, 60_000);

  it.skip("registers an API key provider with only base fields", async () => {
    const { baseUrl, surreal } = getRuntime();
    const admin = await createTestUserWithMcp(baseUrl, surreal, `ws-api-${crypto.randomUUID()}`);

    // When admin registers an API key provider
    const res = await createProvider(baseUrl, admin, admin.workspaceId, {
      name: "internal-api",
      display_name: "Internal API",
      auth_method: "api_key",
      api_key_header: "X-API-Key",
    });

    // Then only base fields are returned (no OAuth fields)
    expect(res.status).toBe(201);
    const body = await res.json() as Record<string, unknown>;
    expect(body.auth_method).toBe("api_key");
    expect(body.has_client_secret).toBe(false);
    expect(body.authorization_url).toBeUndefined();
    expect(body.token_url).toBeUndefined();
  }, 60_000);

  it.skip("registers a bearer token provider", async () => {
    const { baseUrl, surreal } = getRuntime();
    const admin = await createTestUserWithMcp(baseUrl, surreal, `ws-bearer-${crypto.randomUUID()}`);

    const res = await createProvider(baseUrl, admin, admin.workspaceId, {
      name: "monitoring-api",
      display_name: "Monitoring API",
      auth_method: "bearer",
    });

    expect(res.status).toBe(201);
    const body = await res.json() as Record<string, unknown>;
    expect(body.auth_method).toBe("bearer");
  }, 60_000);

  it.skip("registers a basic auth provider", async () => {
    const { baseUrl, surreal } = getRuntime();
    const admin = await createTestUserWithMcp(baseUrl, surreal, `ws-basic-${crypto.randomUUID()}`);

    const res = await createProvider(baseUrl, admin, admin.workspaceId, {
      name: "legacy-service",
      display_name: "Legacy Service",
      auth_method: "basic",
    });

    expect(res.status).toBe(201);
    const body = await res.json() as Record<string, unknown>;
    expect(body.auth_method).toBe("basic");
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Provider Listing
// ---------------------------------------------------------------------------
describe("Admin lists workspace providers", () => {
  it.skip("returns all providers in the workspace", async () => {
    const { baseUrl, surreal } = getRuntime();
    const admin = await createTestUserWithMcp(baseUrl, surreal, `ws-list-${crypto.randomUUID()}`);

    // Given two providers exist
    await seedProvider(surreal, admin.workspaceId, {
      name: "github",
      displayName: "GitHub",
      authMethod: "oauth2",
    });
    await seedProvider(surreal, admin.workspaceId, {
      name: "internal-api",
      displayName: "Internal API",
      authMethod: "api_key",
    });

    // When admin lists providers
    const res = await listProviders(baseUrl, admin, admin.workspaceId);

    // Then both providers appear
    expect(res.status).toBe(200);
    const body = await res.json() as { providers: Array<{ name: string; auth_method: string }> };
    expect(body.providers.length).toBe(2);
  }, 60_000);

  it.skip("returns empty list when no providers exist", async () => {
    const { baseUrl, surreal } = getRuntime();
    const admin = await createTestUserWithMcp(baseUrl, surreal, `ws-empty-${crypto.randomUUID()}`);

    // Given a workspace with no providers
    // When admin lists providers
    const res = await listProviders(baseUrl, admin, admin.workspaceId);

    // Then empty provider list is returned (empty state data)
    expect(res.status).toBe(200);
    const body = await res.json() as { providers: Array<unknown> };
    expect(body.providers.length).toBe(0);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Error Paths: Validation and Duplicates
// ---------------------------------------------------------------------------
describe("Provider registration validates input", () => {
  it.skip("rejects duplicate provider name within workspace", async () => {
    const { baseUrl, surreal } = getRuntime();
    const admin = await createTestUserWithMcp(baseUrl, surreal, `ws-dup-${crypto.randomUUID()}`);

    // Given provider "github" already exists
    await seedProvider(surreal, admin.workspaceId, {
      name: "github",
      displayName: "GitHub",
      authMethod: "oauth2",
    });

    // When admin tries to register another provider with the same name
    const res = await createProvider(baseUrl, admin, admin.workspaceId, {
      name: "github",
      display_name: "GitHub Duplicate",
      auth_method: "api_key",
    });

    // Then the request is rejected with a conflict error
    expect(res.status).toBe(409);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("github");
  }, 60_000);

  it.skip("rejects missing required name field", async () => {
    const { baseUrl, surreal } = getRuntime();
    const admin = await createTestUserWithMcp(baseUrl, surreal, `ws-noname-${crypto.randomUUID()}`);

    // When admin submits provider without name
    const res = await createProvider(baseUrl, admin, admin.workspaceId, {
      name: "",
      display_name: "No Name",
      auth_method: "api_key",
    });

    // Then the request is rejected
    expect(res.status).toBe(400);
  }, 60_000);

  it.skip("rejects missing required display_name field", async () => {
    const { baseUrl, surreal } = getRuntime();
    const admin = await createTestUserWithMcp(baseUrl, surreal, `ws-nodisp-${crypto.randomUUID()}`);

    const res = await createProvider(baseUrl, admin, admin.workspaceId, {
      name: "test-provider",
      display_name: "",
      auth_method: "api_key",
    });

    expect(res.status).toBe(400);
  }, 60_000);

  it.skip("rejects invalid auth_method value", async () => {
    const { baseUrl, surreal } = getRuntime();
    const admin = await createTestUserWithMcp(baseUrl, surreal, `ws-badauth-${crypto.randomUUID()}`);

    const res = await createProvider(baseUrl, admin, admin.workspaceId, {
      name: "test-provider",
      display_name: "Test",
      auth_method: "invalid_method" as "api_key",
    });

    expect(res.status).toBe(400);
  }, 60_000);

  it.skip("rejects malformed JSON body", async () => {
    const { baseUrl, surreal } = getRuntime();
    const admin = await createTestUserWithMcp(baseUrl, surreal, `ws-badjson-${crypto.randomUUID()}`);

    // When admin sends invalid JSON
    const res = await fetch(
      `${baseUrl}/api/workspaces/${admin.workspaceId}/providers`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...admin.headers },
        body: "not valid json{",
      },
    );

    expect(res.status).toBe(400);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Security: Secret Masking
// ---------------------------------------------------------------------------
describe("Provider API never exposes secrets", () => {
  it.skip("client_secret is not returned in provider creation response", async () => {
    const { baseUrl, surreal } = getRuntime();
    const admin = await createTestUserWithMcp(baseUrl, surreal, `ws-sec-${crypto.randomUUID()}`);

    const res = await createProvider(baseUrl, admin, admin.workspaceId, {
      name: "github",
      display_name: "GitHub",
      auth_method: "oauth2",
      client_secret: "super-secret-value",
    });

    expect(res.status).toBe(201);
    const bodyText = await res.text();

    // Then the response does not contain the secret in any form
    expect(bodyText).not.toContain("super-secret-value");
  }, 60_000);

  it.skip("client_secret is not returned in provider list response", async () => {
    const { baseUrl, surreal } = getRuntime();
    const admin = await createTestUserWithMcp(baseUrl, surreal, `ws-seclist-${crypto.randomUUID()}`);

    // Given a provider with encrypted secret exists
    await seedProvider(surreal, admin.workspaceId, {
      name: "github",
      displayName: "GitHub",
      authMethod: "oauth2",
      clientSecretEncrypted: "encrypted:aes256gcm:someciphertext",
    });

    // When listing providers
    const res = await listProviders(baseUrl, admin, admin.workspaceId);
    const bodyText = await res.text();

    // Then encrypted value is not in the response
    expect(bodyText).not.toContain("encrypted:aes256gcm");
    expect(bodyText).not.toContain("someciphertext");
  }, 60_000);
});
