/**
 * Milestone 11: MCP Server Soft-Delete & Re-Enable
 *
 * Tests that removing an MCP server soft-deletes (disables) both the server
 * and its tools instead of hard-deleting them. Re-adding a server with the
 * same URL re-enables the existing record, preserving grants and governance.
 *
 * Driving ports:
 *   DELETE /api/workspaces/:wsId/mcp-servers/:serverId   (soft-delete)
 *   POST   /api/workspaces/:wsId/mcp-servers             (re-enable on same URL)
 *   GET    /api/workspaces/:wsId/mcp-servers              (list active only)
 *   GET    /api/workspaces/:wsId/tools                    (tools list)
 */
import { describe, expect, it } from "bun:test";
import { RecordId } from "surrealdb";
import {
  setupToolRegistrySuite,
  createTestUserWithMcp,
  seedMcpServer,
  seedDiscoveredTool,
  listMcpServers,
  removeMcpServer,
  addMcpServer,
  listTools,
} from "./tool-registry-ui-test-kit";

const getRuntime = setupToolRegistrySuite("tool_registry_ui_server_soft_delete");

// ---------------------------------------------------------------------------
// Soft-delete: removing a server disables it and its tools
// ---------------------------------------------------------------------------
describe("Removing an MCP server soft-deletes it", () => {
  it("sets server status to disabled and hides it from listing", async () => {
    const { baseUrl, surreal } = getRuntime();
    const admin = await createTestUserWithMcp(baseUrl, surreal, `ws-sd-${crypto.randomUUID()}`);

    const { serverId } = await seedMcpServer(surreal, admin.workspaceId, {
      name: "Linear",
      url: "https://mcp.linear.app/mcp",
      toolCount: 2,
    });

    // Seed tools linked to this server
    await seedDiscoveredTool(surreal, admin.workspaceId, serverId, {
      name: "create_issue",
      toolkit: "Linear",
    });
    await seedDiscoveredTool(surreal, admin.workspaceId, serverId, {
      name: "list_issues",
      toolkit: "Linear",
    });

    // When: remove the server
    const deleteRes = await removeMcpServer(baseUrl, admin, admin.workspaceId, serverId);
    expect(deleteRes.status).toBe(200);

    const deleteBody = await deleteRes.json() as { disabled: boolean };
    expect(deleteBody.disabled).toBe(true);

    // Then: server is no longer listed
    const listRes = await listMcpServers(baseUrl, admin, admin.workspaceId);
    const listBody = await listRes.json() as { servers: Array<{ id: string }> };
    expect(listBody.servers.find((s) => s.id === serverId)).toBeUndefined();

    // And: server still exists in DB with status = "disabled"
    const [rows] = await surreal.query<[Array<{ status: string }>]>(
      `SELECT status FROM $server;`,
      { server: new RecordId("mcp_server", serverId) },
    );
    expect(rows[0]?.status).toBe("disabled");
  });

  it("disables all tools linked to the removed server", async () => {
    const { baseUrl, surreal } = getRuntime();
    const admin = await createTestUserWithMcp(baseUrl, surreal, `ws-sd-tools-${crypto.randomUUID()}`);

    const { serverId } = await seedMcpServer(surreal, admin.workspaceId, {
      name: "GitHub",
      url: "https://mcp.github.dev/tools",
      toolCount: 2,
    });

    const { toolId: tool1 } = await seedDiscoveredTool(surreal, admin.workspaceId, serverId, {
      name: "github.create_pr",
      toolkit: "GitHub",
    });
    const { toolId: tool2 } = await seedDiscoveredTool(surreal, admin.workspaceId, serverId, {
      name: "github.list_repos",
      toolkit: "GitHub",
    });

    // When: remove the server
    await removeMcpServer(baseUrl, admin, admin.workspaceId, serverId);

    // Then: both tools are disabled
    const [toolRows] = await surreal.query<[Array<{ id: RecordId; status: string }>]>(
      `SELECT id, status FROM mcp_tool WHERE source_server = $server;`,
      { server: new RecordId("mcp_server", serverId) },
    );
    expect(toolRows.length).toBe(2);
    for (const row of toolRows) {
      expect(row.status).toBe("disabled");
    }
  });

  it("preserves can_use grants on disabled tools", async () => {
    const { baseUrl, surreal } = getRuntime();
    const admin = await createTestUserWithMcp(baseUrl, surreal, `ws-sd-grants-${crypto.randomUUID()}`);

    const { serverId } = await seedMcpServer(surreal, admin.workspaceId, {
      name: "Jira",
      url: "https://mcp.jira.dev/tools",
      toolCount: 1,
    });

    const { toolId } = await seedDiscoveredTool(surreal, admin.workspaceId, serverId, {
      name: "jira.create_ticket",
      toolkit: "Jira",
    });

    // Grant access to the tool
    const toolRecord = new RecordId("mcp_tool", toolId);
    const identityRecord = new RecordId("identity", admin.identityId);
    await surreal.query(
      `RELATE $identity->can_use->$tool SET granted_at = time::now();`,
      { identity: identityRecord, tool: toolRecord },
    );

    // When: remove the server
    await removeMcpServer(baseUrl, admin, admin.workspaceId, serverId);

    // Then: grant edge still exists
    const [edges] = await surreal.query<[Array<{ id: RecordId }>]>(
      `SELECT id FROM can_use WHERE out = $tool;`,
      { tool: toolRecord },
    );
    expect(edges.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Re-enable: adding a server with the same URL resurrects it
// ---------------------------------------------------------------------------
describe("Re-adding a server with the same URL re-enables it", () => {
  it("re-enables the disabled server instead of creating a new one", async () => {
    const { baseUrl, surreal } = getRuntime();
    const admin = await createTestUserWithMcp(baseUrl, surreal, `ws-re-${crypto.randomUUID()}`);
    const serverUrl = `https://mcp.example.dev/${crypto.randomUUID()}`;

    const { serverId } = await seedMcpServer(surreal, admin.workspaceId, {
      name: "Example",
      url: serverUrl,
    });

    // Disable via remove
    await removeMcpServer(baseUrl, admin, admin.workspaceId, serverId);

    // When: re-add with same URL but different name
    const addRes = await addMcpServer(baseUrl, admin, admin.workspaceId, {
      name: "Example (Reconnected)",
      url: serverUrl,
    });
    expect(addRes.status).toBe(200);

    const addBody = await addRes.json() as { id: string; re_enabled: boolean; name: string };
    expect(addBody.re_enabled).toBe(true);
    expect(addBody.id).toBe(serverId); // Same record, not a new one
    expect(addBody.name).toBe("Example (Reconnected)");

    // And: server is active again
    const [rows] = await surreal.query<[Array<{ status: string; name: string }>]>(
      `SELECT status, name FROM $server;`,
      { server: new RecordId("mcp_server", serverId) },
    );
    expect(rows[0]?.status).toBe("active");
    expect(rows[0]?.name).toBe("Example (Reconnected)");
  });

  it("does not re-enable when URL differs (creates new server)", async () => {
    const { baseUrl, surreal } = getRuntime();
    const admin = await createTestUserWithMcp(baseUrl, surreal, `ws-re-diff-${crypto.randomUUID()}`);

    const { serverId } = await seedMcpServer(surreal, admin.workspaceId, {
      name: "Old Server",
      url: "https://mcp.old.dev/tools",
    });

    // Disable
    await removeMcpServer(baseUrl, admin, admin.workspaceId, serverId);

    // When: add with different URL
    const addRes = await addMcpServer(baseUrl, admin, admin.workspaceId, {
      name: "New Server",
      url: "https://mcp.new.dev/tools",
    });
    expect(addRes.status).toBe(201); // 201 = newly created

    const addBody = await addRes.json() as { id: string };
    expect(addBody.id).not.toBe(serverId); // Different record
  });
});
