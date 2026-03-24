/**
 * Tests: Server Soft-Delete Behavior
 *
 * Previously, deleting an MCP server hard-deleted it and cascaded to orphaned
 * credential_provider and connected_account records.
 *
 * Now, deletion is a soft-delete: the server is set to status="disabled" and
 * all linked tools are disabled. The server, provider, and account records
 * are preserved so they can be re-enabled if the same server URL is re-added.
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
      status: "active",
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

async function getServerStatus(
  surreal: ReturnType<typeof getRuntime>["surreal"],
  serverId: string,
): Promise<string | undefined> {
  const record = new RecordId("mcp_server", serverId);
  const [rows] = await surreal.query<[Array<{ status: string }>]>(
    "SELECT status FROM $record;",
    { record },
  );
  return (rows ?? [])[0]?.status;
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

describe("Server deletion soft-deletes and preserves provider", () => {
  it("preserves shared provider when server is soft-deleted", async () => {
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
        status: "active",
        auth_mode: "oauth",
        provider: new RecordId("credential_provider", providerId),
        workspace: new RecordId("workspace", user.workspaceId),
        tool_count: 0,
        created_at: new Date(),
      },
    });

    // Soft-delete first server
    const response = await user.mcpFetch(
      `/api/workspaces/${user.workspaceId}/mcp-servers/${serverId1}`,
      { method: "DELETE" },
    );
    expect(response.status).toBe(200);

    // Server 1 still exists but is disabled
    expect(await getServerStatus(surreal, serverId1)).toBe("disabled");
    // Provider preserved (still referenced by server 2)
    expect(await recordExists(surreal, "credential_provider", providerId)).toBe(true);
  });

  it("soft-deletes the server and preserves provider when only server is removed", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUserWithMcp(baseUrl, surreal, `ws-dc-${crypto.randomUUID()}`);

    const { serverId, providerId } = await createServerWithProvider(
      user, surreal, "solo-server",
    );

    // Verify both exist
    expect(await recordExists(surreal, "mcp_server", serverId)).toBe(true);
    expect(await recordExists(surreal, "credential_provider", providerId)).toBe(true);

    // Soft-delete the server
    const response = await user.mcpFetch(
      `/api/workspaces/${user.workspaceId}/mcp-servers/${serverId}`,
      { method: "DELETE" },
    );
    expect(response.status).toBe(200);

    // Server still exists but disabled
    expect(await getServerStatus(surreal, serverId)).toBe("disabled");
    // Provider preserved for potential re-enable
    expect(await recordExists(surreal, "credential_provider", providerId)).toBe(true);
  });

  it("does not hard-delete servers without a provider", async () => {
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
        status: "active",
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
    // Server still exists but disabled (soft-delete, not hard-delete)
    expect(await getServerStatus(surreal, serverId)).toBe("disabled");
  });

  it("preserves connected_accounts when server is soft-deleted", async () => {
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

    // Soft-delete the server
    const response = await user.mcpFetch(
      `/api/workspaces/${user.workspaceId}/mcp-servers/${serverId}`,
      { method: "DELETE" },
    );
    expect(response.status).toBe(200);

    // Provider and account preserved for potential re-enable
    expect(await recordExists(surreal, "credential_provider", providerId)).toBe(true);
    expect(await recordExists(surreal, "connected_account", accountId)).toBe(true);
  });
});
