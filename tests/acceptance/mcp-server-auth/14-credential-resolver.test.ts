/**
 * Acceptance Tests: Credential Resolver Dispatch (US-1, US-3)
 *
 * Milestone 4: The credential resolver dispatches on auth_mode to produce
 * the correct HTTP headers for MCP client connections.
 *
 * Traces: US-1, US-3, FR-1, FR-3
 * Driving port: MCP client factory (internal — resolver is called before transport creation)
 *
 * Implementation sequence:
 *   1. No-auth server resolves to empty headers                    [ENABLED]
 *   2. Static headers server resolves to decrypted headers         [ENABLED]
 *   3. OAuth server resolves to Bearer token                       [ENABLED]
 *   4. Provider server resolves via existing credential flow       [ENABLED]
 */
import { describe, expect, it } from "bun:test";
import { RecordId } from "surrealdb";
import {
  setupMcpServerAuthSuite,
  createTestUserWithMcp,
  seedMcpServer,
} from "./mcp-server-auth-test-kit";
import { encryptSecret } from "../../../app/src/server/tool-registry/encryption";
import { encryptHeaders } from "../../../app/src/server/tool-registry/static-headers";
import { resolveAuthForMcpServer } from "../../../app/src/server/proxy/credential-resolver";
import type { McpServerRecord } from "../../../app/src/server/tool-registry/types";

/** Test encryption key (64 hex chars = 256 bits). Must match setupMcpServerAuthSuite. */
const TEST_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const getRuntime = setupMcpServerAuthSuite("mcp_server_auth_credential_resolver");

// ---------------------------------------------------------------------------
// Seed helpers — produce SCHEMAFULL-compliant content for workspace / identity
// ---------------------------------------------------------------------------

function seedWorkspace() {
  return {
    name: "test-ws",
    status: "active",
    onboarding_complete: true,
    onboarding_turn_count: 0,
    onboarding_summary_pending: false,
    onboarding_started_at: new Date(),
    created_at: new Date(),
  };
}

function seedIdentity(wsRecord: RecordId<"workspace", string>) {
  return {
    name: "Test User",
    type: "human",
    workspace: wsRecord,
    created_at: new Date(),
  };
}

// ---------------------------------------------------------------------------
// Milestone 4: Credential Resolver Dispatch
// ---------------------------------------------------------------------------
describe("No-auth server resolves to empty headers", () => {
  it("resolveAuthForMcpServer returns {} for auth_mode none", async () => {
    const { surreal } = getRuntime();
    const serverId = crypto.randomUUID();
    const workspaceId = crypto.randomUUID();

    // Given MCP server with auth_mode = "none"
    const wsRecord = new RecordId("workspace", workspaceId);
    await surreal.query("CREATE $ws CONTENT $content;", {
      ws: wsRecord,
      content: seedWorkspace(),
    });
    await seedMcpServer(surreal, serverId, {
      name: "no-auth-server",
      url: "https://mcp.example.com",
      authMode: "none",
      workspaceId,
    });

    // Load seeded server as McpServerRecord
    const [rows] = await surreal.query<[McpServerRecord[]]>(
      "SELECT * FROM $server;",
      { server: new RecordId("mcp_server", serverId) },
    );
    const server = rows[0]!;

    // When credential resolver resolves auth
    const headers = await resolveAuthForMcpServer(server, TEST_ENCRYPTION_KEY);

    // Then returned headers map is empty
    expect(headers).toEqual({});
  }, 30_000);
});

describe("Static headers server resolves to decrypted headers", () => {
  it("resolveAuthForMcpServer decrypts and returns stored headers", async () => {
    const { surreal } = getRuntime();
    const serverId = crypto.randomUUID();
    const workspaceId = crypto.randomUUID();

    // Given MCP server with auth_mode = "static_headers"
    // And static_headers = [{ name: "Authorization", value_encrypted: "..." }]
    const wsRecord = new RecordId("workspace", workspaceId);
    await surreal.query("CREATE $ws CONTENT $content;", {
      ws: wsRecord,
      content: seedWorkspace(),
    });

    const encryptedHeaders = encryptHeaders(
      [{ name: "Authorization", value: "Bearer ghp_test123" }],
      TEST_ENCRYPTION_KEY,
    );

    await seedMcpServer(surreal, serverId, {
      name: "static-header-server",
      url: "https://mcp.github.com",
      authMode: "static_headers",
      staticHeaders: encryptedHeaders,
      workspaceId,
    });

    // Load seeded server
    const [rows] = await surreal.query<[McpServerRecord[]]>(
      "SELECT * FROM $server;",
      { server: new RecordId("mcp_server", serverId) },
    );
    const server = rows[0]!;

    // When credential resolver resolves auth
    const headers = await resolveAuthForMcpServer(server, TEST_ENCRYPTION_KEY);

    // Then returned headers = { "Authorization": "Bearer ghp_test123" }
    expect(headers).toEqual({ Authorization: "Bearer ghp_test123" });
  }, 30_000);
});

describe("OAuth server resolves to Bearer token", () => {
  it("resolveAuthForMcpServer returns Authorization: Bearer from connected_account", async () => {
    const { surreal } = getRuntime();
    const workspaceId = crypto.randomUUID();
    const serverId = crypto.randomUUID();
    const accountId = crypto.randomUUID();
    const providerId = crypto.randomUUID();
    const identityId = crypto.randomUUID();

    // Given workspace + identity
    const wsRecord = new RecordId("workspace", workspaceId);
    const identityRecord = new RecordId("identity", identityId);
    await surreal.query("CREATE $ws CONTENT $content;", {
      ws: wsRecord,
      content: seedWorkspace(),
    });
    await surreal.query("CREATE $id CONTENT $content;", {
      id: identityRecord,
      content: seedIdentity(wsRecord),
    });

    // Given credential_provider for oauth
    const providerRecord = new RecordId("credential_provider", providerId);
    await surreal.query("CREATE $provider CONTENT $content;", {
      provider: providerRecord,
      content: {
        name: "test-oauth-provider",
        display_name: "Test OAuth",
        auth_method: "oauth2",
        workspace: wsRecord,
        token_url: "https://auth.example.com/token",
        created_at: new Date(),
      },
    });

    // Given connected_account with valid access_token_encrypted
    const plainAccessToken = "oauth-access-token-abc123";
    const encryptedAccessToken = encryptSecret(plainAccessToken, TEST_ENCRYPTION_KEY);
    const accountRecord = new RecordId("connected_account", accountId);
    // Token expires far in the future so no refresh is needed
    const futureExpiry = new Date(Date.now() + 3600 * 1000);
    await surreal.query("CREATE $acct CONTENT $content;", {
      acct: accountRecord,
      content: {
        identity: identityRecord,
        provider: providerRecord,
        workspace: wsRecord,
        status: "active",
        access_token_encrypted: encryptedAccessToken,
        token_expires_at: futureExpiry,
        connected_at: new Date(),
        updated_at: new Date(),
      },
    });

    // Given MCP server with auth_mode = "oauth" linked to the connected_account
    await seedMcpServer(surreal, serverId, {
      name: "oauth-server",
      url: "https://mcp.oauth-example.com",
      authMode: "oauth",
      workspaceId,
    });
    // Patch oauth_account onto seeded server
    await surreal.query("UPDATE $server SET oauth_account = $acct;", {
      server: new RecordId("mcp_server", serverId),
      acct: accountRecord,
    });

    // Load seeded server
    const [rows] = await surreal.query<[McpServerRecord[]]>(
      "SELECT * FROM $server;",
      { server: new RecordId("mcp_server", serverId) },
    );
    const server = rows[0]!;

    // When credential resolver resolves auth
    const headers = await resolveAuthForMcpServer(server, TEST_ENCRYPTION_KEY, {
      surreal,
      toolEncryptionKey: TEST_ENCRYPTION_KEY,
    });

    // Then returned headers = { "Authorization": "Bearer <decrypted_token>" }
    expect(headers).toEqual({ Authorization: `Bearer ${plainAccessToken}` });
  }, 30_000);
});

describe("Provider server resolves via existing credential flow", () => {
  it("resolveAuthForMcpServer delegates to existing credential_provider logic", async () => {
    const { surreal } = getRuntime();
    const workspaceId = crypto.randomUUID();
    const serverId = crypto.randomUUID();
    const providerId = crypto.randomUUID();
    const accountId = crypto.randomUUID();
    const identityId = crypto.randomUUID();

    // Given workspace + identity
    const wsRecord = new RecordId("workspace", workspaceId);
    const identityRecord = new RecordId("identity", identityId);
    await surreal.query("CREATE $ws CONTENT $content;", {
      ws: wsRecord,
      content: seedWorkspace(),
    });
    await surreal.query("CREATE $id CONTENT $content;", {
      id: identityRecord,
      content: seedIdentity(wsRecord),
    });

    // Given credential_provider with auth_method = "bearer"
    const providerRecord = new RecordId("credential_provider", providerId);
    await surreal.query("CREATE $provider CONTENT $content;", {
      provider: providerRecord,
      content: {
        name: "test-bearer-provider",
        display_name: "Test Bearer Provider",
        auth_method: "bearer",
        workspace: wsRecord,
        created_at: new Date(),
      },
    });

    // Given connected_account with bearer_token_encrypted
    const plainBearerToken = "provider-bearer-token-xyz789";
    const encryptedBearerToken = encryptSecret(plainBearerToken, TEST_ENCRYPTION_KEY);
    const accountRecord = new RecordId("connected_account", accountId);
    await surreal.query("CREATE $acct CONTENT $content;", {
      acct: accountRecord,
      content: {
        identity: identityRecord,
        provider: providerRecord,
        workspace: wsRecord,
        status: "active",
        bearer_token_encrypted: encryptedBearerToken,
        connected_at: new Date(),
        updated_at: new Date(),
      },
    });

    // Given MCP server with auth_mode = "provider" linked to the credential_provider
    await seedMcpServer(surreal, serverId, {
      name: "provider-server",
      url: "https://mcp.provider-example.com",
      authMode: "provider",
      workspaceId,
    });
    // Patch provider onto seeded server
    await surreal.query("UPDATE $server SET provider = $prov;", {
      server: new RecordId("mcp_server", serverId),
      prov: providerRecord,
    });

    // Load seeded server
    const [rows] = await surreal.query<[McpServerRecord[]]>(
      "SELECT * FROM $server;",
      { server: new RecordId("mcp_server", serverId) },
    );
    const server = rows[0]!;

    // When credential resolver resolves auth
    const headers = await resolveAuthForMcpServer(server, TEST_ENCRYPTION_KEY, {
      surreal,
      toolEncryptionKey: TEST_ENCRYPTION_KEY,
    });

    // Then returned headers match existing credential resolution behavior
    expect(headers).toEqual({ Authorization: `Bearer ${plainBearerToken}` });
  }, 30_000);
});
