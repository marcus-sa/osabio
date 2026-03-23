/**
 * Milestone 10: MCP Server Management
 *
 * Traces: US-UI-12 (MCP Server Management)
 *
 * Tests the server monitoring and management endpoints that power the
 * MCP Servers section at the top of the Tools tab. Covers server listing
 * with status indicators, re-sync triggering, server removal with tool
 * disabling, and empty state.
 *
 * Note: Some scenarios overlap with milestone-7 (server CRUD) and
 * milestone-8 (discovery). This file focuses on the management view
 * and lifecycle operations specific to US-UI-12.
 *
 * Driving ports:
 *   GET    /api/workspaces/:wsId/mcp-servers               (list with status)
 *   GET    /api/workspaces/:wsId/mcp-servers/:serverId      (server detail)
 *   DELETE /api/workspaces/:wsId/mcp-servers/:serverId      (remove server)
 *   POST   /api/workspaces/:wsId/mcp-servers/:serverId/discover (re-sync trigger)
 */
import { describe, expect, it } from "bun:test";
import {
  setupToolRegistrySuite,
  createTestUserWithMcp,
  listMcpServers,
  getMcpServerDetail,
  removeMcpServer,
  discoverTools,
  listTools,
  seedMcpServer,
  seedDiscoveredTool,
} from "./tool-registry-ui-test-kit";

const getRuntime = setupToolRegistrySuite("tool_registry_ui_server_management");

// ---------------------------------------------------------------------------
// Happy Path: Server Status Dashboard
// ---------------------------------------------------------------------------
describe("Admin views MCP server status dashboard", () => {
  it("lists servers with status indicators and tool counts", async () => {
    const { baseUrl, surreal } = getRuntime();
    const admin = await createTestUserWithMcp(baseUrl, surreal, `ws-dash-${crypto.randomUUID()}`);

    // Given servers with different statuses
    await seedMcpServer(surreal, admin.workspaceId, {
      name: "GitHub Tools",
      url: "https://mcp.acme.dev/github",
      lastStatus: "ok",
      toolCount: 11,
      lastDiscovery: new Date("2026-03-21T10:00:00Z"),
    });
    await seedMcpServer(surreal, admin.workspaceId, {
      name: "Jira Tools",
      url: "https://mcp.acme.dev/jira",
      lastStatus: "ok",
      toolCount: 8,
      lastDiscovery: new Date("2026-03-22T14:30:00Z"),
    });
    await seedMcpServer(surreal, admin.workspaceId, {
      name: "Legacy API",
      url: "https://mcp.acme.dev/legacy",
      lastStatus: "error",
      toolCount: 0,
      lastError: "Connection refused",
    });

    // When admin lists servers
    const res = await listMcpServers(baseUrl, admin, admin.workspaceId);

    // Then all servers appear with complete status data
    expect(res.status).toBe(200);
    const body = await res.json() as {
      servers: Array<{
        name: string;
        url: string;
        last_status: string;
        tool_count: number;
        last_discovery?: string;
        last_error?: string;
      }>;
    };
    expect(body.servers.length).toBe(3);

    // And each server has the data needed for the dashboard
    const github = body.servers.find((s) => s.name === "GitHub Tools");
    expect(github!.last_status).toBe("ok");
    expect(github!.tool_count).toBe(11);
    expect(github!.last_discovery).toBeTruthy();

    const legacy = body.servers.find((s) => s.name === "Legacy API");
    expect(legacy!.last_status).toBe("error");
    expect(legacy!.last_error).toBe("Connection refused");
  }, 60_000);

  it("server detail includes transport and creation timestamp", async () => {
    const { baseUrl, surreal } = getRuntime();
    const admin = await createTestUserWithMcp(baseUrl, surreal, `ws-det-${crypto.randomUUID()}`);

    const { serverId } = await seedMcpServer(surreal, admin.workspaceId, {
      name: "GitHub Tools",
      url: "https://mcp.acme.dev/github",
      transport: "streamable-http",
      lastStatus: "ok",
    });

    const res = await getMcpServerDetail(baseUrl, admin, admin.workspaceId, serverId);

    expect(res.status).toBe(200);
    const body = await res.json() as {
      name: string;
      transport: string;
      created_at: string;
    };
    expect(body.transport).toBe("streamable-http");
    expect(body.created_at).toBeTruthy();
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Re-Sync Flow
// ---------------------------------------------------------------------------
// Requires mock MCP server infrastructure (step 03-05)
describe.skip("Admin re-syncs server tools", () => {
  it("re-sync triggers discovery review flow", async () => {
    const { baseUrl, surreal } = getRuntime();
    const admin = await createTestUserWithMcp(baseUrl, surreal, `ws-resync-${crypto.randomUUID()}`);

    // Given a server that was synced 7 days ago
    const { serverId } = await seedMcpServer(surreal, admin.workspaceId, {
      name: "GitHub Tools",
      url: "https://mcp.test.local/github",
      lastStatus: "ok",
      toolCount: 5,
      lastDiscovery: new Date("2026-03-16T10:00:00Z"),
    });
    await seedDiscoveredTool(surreal, admin.workspaceId, serverId, {
      name: "github.create_issue",
      toolkit: "github",
    });

    // When admin triggers re-sync (same as discovery)
    const res = await discoverTools(baseUrl, admin, admin.workspaceId, serverId, {
      dryRun: true,
    });

    // Then the review panel data is returned with diff information
    expect(res.status).toBe(200);
    const body = await res.json() as {
      tools: Array<{ name: string; action: string }>;
    };
    expect(body.tools.length).toBeGreaterThan(0);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Server Removal with Tool Disabling
// ---------------------------------------------------------------------------
describe("Admin removes MCP server and discovered tools are disabled", () => {
  it("removal disables all discovered tools for the server", async () => {
    const { baseUrl, surreal } = getRuntime();
    const admin = await createTestUserWithMcp(baseUrl, surreal, `ws-rmall-${crypto.randomUUID()}`);

    // Given a server with 3 discovered tools
    const { serverId } = await seedMcpServer(surreal, admin.workspaceId, {
      name: "Jira Tools",
      url: "https://mcp.acme.dev/jira",
      lastStatus: "ok",
      toolCount: 3,
    });
    await seedDiscoveredTool(surreal, admin.workspaceId, serverId, {
      name: "jira.create_ticket",
      toolkit: "jira",
      status: "active",
    });
    await seedDiscoveredTool(surreal, admin.workspaceId, serverId, {
      name: "jira.list_boards",
      toolkit: "jira",
      status: "active",
    });
    await seedDiscoveredTool(surreal, admin.workspaceId, serverId, {
      name: "jira.update_ticket",
      toolkit: "jira",
      status: "active",
    });

    // When admin removes the server
    const removeRes = await removeMcpServer(baseUrl, admin, admin.workspaceId, serverId);
    expect(removeRes.status).toBe(200);

    // Then all 3 tools are disabled (not deleted)
    const toolsRes = await listTools(baseUrl, admin, admin.workspaceId);
    const body = await toolsRes.json() as {
      tools: Array<{ name: string; status: string }>;
    };
    const jiraTools = body.tools.filter((t) => t.name.startsWith("jira."));
    expect(jiraTools.length).toBe(3);
    for (const tool of jiraTools) {
      expect(tool.status).toBe("disabled");
    }
  }, 60_000);

  it("removal does not affect tools from other servers", async () => {
    const { baseUrl, surreal } = getRuntime();
    const admin = await createTestUserWithMcp(baseUrl, surreal, `ws-rmiso-${crypto.randomUUID()}`);

    // Given two servers with tools
    const { serverId: s1 } = await seedMcpServer(surreal, admin.workspaceId, {
      name: "GitHub Tools",
      url: "https://mcp.acme.dev/github",
      lastStatus: "ok",
      toolCount: 1,
    });
    await seedDiscoveredTool(surreal, admin.workspaceId, s1, {
      name: "github.create_issue",
      toolkit: "github",
      status: "active",
    });

    const { serverId: s2 } = await seedMcpServer(surreal, admin.workspaceId, {
      name: "Jira Tools",
      url: "https://mcp.acme.dev/jira",
      lastStatus: "ok",
      toolCount: 1,
    });
    await seedDiscoveredTool(surreal, admin.workspaceId, s2, {
      name: "jira.create_ticket",
      toolkit: "jira",
      status: "active",
    });

    // When admin removes only the Jira server
    await removeMcpServer(baseUrl, admin, admin.workspaceId, s2);

    // Then GitHub tools remain active
    const toolsRes = await listTools(baseUrl, admin, admin.workspaceId);
    const body = await toolsRes.json() as {
      tools: Array<{ name: string; status: string }>;
    };
    const githubTool = body.tools.find((t) => t.name === "github.create_issue");
    expect(githubTool).toBeDefined();
    expect(githubTool!.status).toBe("active");

    // And Jira tools are disabled
    const jiraTool = body.tools.find((t) => t.name === "jira.create_ticket");
    expect(jiraTool).toBeDefined();
    expect(jiraTool!.status).toBe("disabled");
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Empty State
// ---------------------------------------------------------------------------
describe("MCP server empty state", () => {
  it("returns empty server list for workspace with no servers", async () => {
    const { baseUrl, surreal } = getRuntime();
    const admin = await createTestUserWithMcp(baseUrl, surreal, `ws-nosvr-${crypto.randomUUID()}`);

    const res = await listMcpServers(baseUrl, admin, admin.workspaceId);

    expect(res.status).toBe(200);
    const body = await res.json() as { servers: Array<unknown> };
    expect(body.servers.length).toBe(0);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Error Paths
// ---------------------------------------------------------------------------
describe("Server management error handling", () => {
  it("returns 404 when viewing detail of nonexistent server", async () => {
    const { baseUrl, surreal } = getRuntime();
    const admin = await createTestUserWithMcp(baseUrl, surreal, `ws-nodet-${crypto.randomUUID()}`);

    const res = await getMcpServerDetail(
      baseUrl, admin, admin.workspaceId, "nonexistent-server-id",
    );

    expect(res.status).toBe(404);
  }, 60_000);

  it("returns 404 when removing nonexistent server", async () => {
    const { baseUrl, surreal } = getRuntime();
    const admin = await createTestUserWithMcp(baseUrl, surreal, `ws-rmnone-${crypto.randomUUID()}`);

    const res = await removeMcpServer(
      baseUrl, admin, admin.workspaceId, "nonexistent-server-id",
    );

    expect(res.status).toBe(404);
  }, 60_000);

  it("only returns servers belonging to the requesting workspace", async () => {
    const { baseUrl, surreal } = getRuntime();
    const admin1 = await createTestUserWithMcp(baseUrl, surreal, `ws-ws1-${crypto.randomUUID()}`);
    const admin2 = await createTestUserWithMcp(baseUrl, surreal, `ws-ws2-${crypto.randomUUID()}`);

    await seedMcpServer(surreal, admin1.workspaceId, {
      name: "Workspace 1 Server",
      url: "https://mcp.ws1.dev/tools",
    });
    await seedMcpServer(surreal, admin2.workspaceId, {
      name: "Workspace 2 Server",
      url: "https://mcp.ws2.dev/tools",
    });

    // When admin1 lists servers
    const res = await listMcpServers(baseUrl, admin1, admin1.workspaceId);
    const body = await res.json() as { servers: Array<{ name: string }> };

    // Then only workspace 1 server appears
    expect(body.servers.length).toBe(1);
    expect(body.servers[0].name).toBe("Workspace 1 Server");
  }, 60_000);
});
