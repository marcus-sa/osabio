/**
 * Regression Tests: Server Deletion Cascades to Provider
 *
 * Bug: Deleting an MCP server with auth_mode "oauth" left orphaned
 * credential_provider and connected_account records in the database.
 *
 * The fix cascades deletion to the provider (and its accounts) when no
 * other mcp_server references the same provider. When a provider is
 * shared across multiple servers, it is preserved until the last server
 * referencing it is deleted.
 */
import { describe, expect, it } from "bun:test";
import { RecordId } from "surrealdb";
import {
  setupMcpServerAuthSuite,
  createTestUserWithMcp,
} from "./mcp-server-auth-test-kit";

const getRuntime = setupMcpServerAuthSuite("mcp_server_delete_cascade");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createServerWithProvider(
  user: Awaited<ReturnType<typeof createTestUserWithMcp>>,
  surreal: ReturnType<typeof getRuntime>["surreal"],
  serverName: string,
) {
  const serverId = crypto.randomUUID();
  const providerId = crypto.randomUUID();
  const workspaceRecord = new RecordId("workspace", user.workspaceId);
  const serverRecord = new RecordId("mcp_server", serverId);
  const providerRecord = new RecordId("credential_provider", providerId);

  // Create provider
  await surreal.query("CREATE $provider CONTENT $content;", {
    provider: providerRecord,
    content: {
      name: serverName,
      display_name: serverName,
      auth_method: "oauth2",
      authorization_url: "https://auth.example.com/authorize",
      token_url: "https://auth.example.com/token",
      discovery_source: `https://${serverName}.example.com`,
      workspace: workspaceRecord,
      created_at: new Date(),
    },
  });

  // Create server linked to provider
  await surreal.query("CREATE $server CONTENT $content;", {
    server: serverRecord,
    content: {
      name: serverName,
      url: `https://${serverName}.example.com`,
      transport: "streamable-http",
      auth_mode: "oauth",
      provider: providerRecord,
      workspace: workspaceRecord,
      tool_count: 0,
      created_at: new Date(),
    },
  });

  return { serverId, providerId, serverRecord, providerRecord };
}

async function createConnectedAccount(
  surreal: ReturnType<typeof getRuntime>["surreal"],
  providerId: string,
  workspaceId: string,
  identityId: string,
) {
  const accountId = crypto.randomUUID();
  const accountRecord = new RecordId("connected_account", accountId);

  await surreal.query("CREATE $acct CONTENT $content;", {
    acct: accountRecord,
    content: {
      provider: new RecordId("credential_provider", providerId),
      workspace: new RecordId("workspace", workspaceId),
      identity: new RecordId("identity", identityId),
      status: "active",
      access_token_encrypted: "encrypted-token-placeholder",
      connected_at: new Date(),
    },
  });

  return accountId;
}

async function recordExists(
  surreal: ReturnType<typeof getRuntime>["surreal"],
  table: string,
  id: string,
): Promise<boolean> {
  const record = new RecordId(table, id);
  const [rows] = await surreal.query<[Array<{ id: RecordId }>]>(
    "SELECT id FROM $record;",
    { record },
  );
  return (rows ?? []).length > 0;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Server deletion cascades to orphaned provider", () => {
  it("deletes the provider when the only referencing server is deleted", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUserWithMcp(baseUrl, surreal, `ws-dc-${crypto.randomUUID()}`);

    const { serverId, providerId } = await createServerWithProvider(
      user, surreal, "solo-server",
    );

    // Verify both exist
    expect(await recordExists(surreal, "mcp_server", serverId)).toBe(true);
    expect(await recordExists(surreal, "credential_provider", providerId)).toBe(true);

    // Delete the server via API
    const response = await user.mcpFetch(
      `/api/workspaces/${user.workspaceId}/mcp-servers/${serverId}`,
      { method: "DELETE" },
    );
    expect(response.status).toBe(200);

    // Server should be gone
    expect(await recordExists(surreal, "mcp_server", serverId)).toBe(false);

    // Provider should also be gone (cascade)
    expect(await recordExists(surreal, "credential_provider", providerId)).toBe(false);
  });

  it("deletes connected_accounts when orphaned provider is cascade-deleted", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUserWithMcp(baseUrl, surreal, `ws-dc-${crypto.randomUUID()}`);

    const { serverId, providerId } = await createServerWithProvider(
      user, surreal, "acct-server",
    );

    // Create a connected_account linked to the provider
    const accountId = await createConnectedAccount(
      surreal, providerId, user.workspaceId, user.identityId,
    );

    expect(await recordExists(surreal, "connected_account", accountId)).toBe(true);

    // Delete the server
    const response = await user.mcpFetch(
      `/api/workspaces/${user.workspaceId}/mcp-servers/${serverId}`,
      { method: "DELETE" },
    );
    expect(response.status).toBe(200);

    // Provider and account should both be gone
    expect(await recordExists(surreal, "credential_provider", providerId)).toBe(false);
    expect(await recordExists(surreal, "connected_account", accountId)).toBe(false);
  });

  it("preserves shared provider when another server still references it", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUserWithMcp(baseUrl, surreal, `ws-dc-${crypto.randomUUID()}`);

    // Create two servers sharing the same provider
    const { serverId: serverId1, providerId } = await createServerWithProvider(
      user, surreal, "shared-a",
    );

    // Create second server pointing to the same provider
    const serverId2 = crypto.randomUUID();
    await surreal.query("CREATE $server CONTENT $content;", {
      server: new RecordId("mcp_server", serverId2),
      content: {
        name: "shared-b",
        url: "https://shared-b.example.com",
        transport: "streamable-http",
        auth_mode: "oauth",
        provider: new RecordId("credential_provider", providerId),
        workspace: new RecordId("workspace", user.workspaceId),
        tool_count: 0,
        created_at: new Date(),
      },
    });

    // Delete first server
    const response = await user.mcpFetch(
      `/api/workspaces/${user.workspaceId}/mcp-servers/${serverId1}`,
      { method: "DELETE" },
    );
    expect(response.status).toBe(200);

    // Server 1 gone, but provider should still exist (server 2 needs it)
    expect(await recordExists(surreal, "mcp_server", serverId1)).toBe(false);
    expect(await recordExists(surreal, "credential_provider", providerId)).toBe(true);

    // Delete second server — now provider should be cleaned up
    const response2 = await user.mcpFetch(
      `/api/workspaces/${user.workspaceId}/mcp-servers/${serverId2}`,
      { method: "DELETE" },
    );
    expect(response2.status).toBe(200);

    expect(await recordExists(surreal, "mcp_server", serverId2)).toBe(false);
    expect(await recordExists(surreal, "credential_provider", providerId)).toBe(false);
  });

  it("does not cascade for servers without a provider", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUserWithMcp(baseUrl, surreal, `ws-dc-${crypto.randomUUID()}`);

    // Create server with no provider (auth_mode: "none")
    const serverId = crypto.randomUUID();
    await surreal.query("CREATE $server CONTENT $content;", {
      server: new RecordId("mcp_server", serverId),
      content: {
        name: "no-auth-server",
        url: "https://no-auth.example.com",
        transport: "streamable-http",
        auth_mode: "none",
        workspace: new RecordId("workspace", user.workspaceId),
        tool_count: 0,
        created_at: new Date(),
      },
    });

    const response = await user.mcpFetch(
      `/api/workspaces/${user.workspaceId}/mcp-servers/${serverId}`,
      { method: "DELETE" },
    );
    expect(response.status).toBe(200);
    expect(await recordExists(surreal, "mcp_server", serverId)).toBe(false);
  });
});
