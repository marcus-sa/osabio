/**
 * Milestone 8: Tool Discovery and Import
 *
 * Traces: US-UI-10 (Tool Discovery and Import)
 *
 * Tests the discovery and sync endpoints that enable admins to import
 * tools from connected MCP servers. Covers dry-run discovery, selective
 * import, re-sync with diff, risk level inference from MCP annotations,
 * and edge cases like empty server and server errors.
 *
 * Driving ports:
 *   POST /api/workspaces/:wsId/mcp-servers/:serverId/discover  (trigger discovery)
 *   POST /api/workspaces/:wsId/mcp-servers/:serverId/sync      (apply sync)
 *   GET  /api/workspaces/:wsId/tools                            (verify imported tools)
 */
import { describe, expect, it } from "bun:test";
import {
  setupToolRegistrySuite,
  createTestUserWithMcp,
  createMockMcpClientFactory,
  discoverTools,
  syncServerTools,
  listTools,
  listMcpServers,
  seedMcpServer,
  seedDiscoveredTool,
} from "./tool-registry-ui-test-kit";

// Mock MCP server with GitHub-like tools including annotations
const mockFactory = createMockMcpClientFactory({
  tools: [
    {
      name: "github.create_issue",
      description: "Create a GitHub issue",
      inputSchema: { type: "object", properties: { title: { type: "string" } }, required: ["title"] },
      annotations: { destructiveHint: false, idempotentHint: false },
    },
    {
      name: "github.list_repos",
      description: "List repositories",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true },
    },
    {
      name: "github.delete_branch",
      description: "Delete a git branch",
      inputSchema: { type: "object", properties: { branch: { type: "string" } } },
      annotations: { destructiveHint: true },
    },
  ],
});

const getRuntime = setupToolRegistrySuite("tool_registry_ui_tool_discovery", {
  mcpClientFactory: mockFactory,
});

// ---------------------------------------------------------------------------
// Happy Path: First Discovery
// ---------------------------------------------------------------------------
describe("Admin discovers tools from MCP server", () => {
  it("dry-run discovery returns tools with actions and risk levels", async () => {
    const { baseUrl, surreal } = getRuntime();
    const admin = await createTestUserWithMcp(baseUrl, surreal, `ws-disc-${crypto.randomUUID()}`);

    // Given an MCP server is registered
    const { serverId } = await seedMcpServer(surreal, admin.workspaceId, {
      name: "GitHub Tools",
      url: "https://mcp.test.local/github",
      lastStatus: "ok",
    });

    // When admin triggers dry-run discovery
    const res = await discoverTools(baseUrl, admin, admin.workspaceId, serverId, {
      dryRun: true,
    });

    // Then the discovery result shows tools with planned actions
    expect(res.status).toBe(200);
    const body = await res.json() as {
      created: number;
      updated: number;
      disabled: number;
      unchanged: number;
      tools: Array<{
        name: string;
        description: string;
        action: string;
        risk_level: string;
      }>;
    };
    expect(body.tools.length).toBe(3);

    // And all tools show action "create" (first discovery)
    for (const tool of body.tools) {
      expect(tool.action).toBe("create");
      expect(tool.name).toBeTruthy();
      expect(tool.risk_level).toBeTruthy();
    }
  }, 60_000);

  it("full sync creates mcp_tool records linked to server", async () => {
    const { baseUrl, surreal } = getRuntime();
    const admin = await createTestUserWithMcp(baseUrl, surreal, `ws-sync-${crypto.randomUUID()}`);

    const { serverId } = await seedMcpServer(surreal, admin.workspaceId, {
      name: "GitHub Tools",
      url: "https://mcp.test.local/github",
      lastStatus: "ok",
    });

    // When admin syncs all tools
    const syncRes = await syncServerTools(baseUrl, admin, admin.workspaceId, serverId);

    // Then sync result shows created tools
    expect(syncRes.status).toBe(200);
    const syncBody = await syncRes.json() as { created: number };
    expect(syncBody.created).toBe(3);

    // And tools appear in the workspace tool list
    const listRes = await listTools(baseUrl, admin, admin.workspaceId);
    const listBody = await listRes.json() as {
      tools: Array<{ name: string }>;
    };
    expect(listBody.tools.length).toBe(3);
    const toolNames = listBody.tools.map((t) => t.name);
    expect(toolNames).toContain("github.create_issue");
    expect(toolNames).toContain("github.list_repos");
    expect(toolNames).toContain("github.delete_branch");
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Selective Import
// ---------------------------------------------------------------------------
describe("Admin selectively imports tools", () => {
  it("imports only selected tools and skips unselected", async () => {
    const { baseUrl, surreal } = getRuntime();
    const admin = await createTestUserWithMcp(baseUrl, surreal, `ws-select-${crypto.randomUUID()}`);

    const { serverId } = await seedMcpServer(surreal, admin.workspaceId, {
      name: "GitHub Tools",
      url: "https://mcp.test.local/github",
      lastStatus: "ok",
    });

    // When admin syncs only specific tools
    const syncRes = await syncServerTools(
      baseUrl, admin, admin.workspaceId, serverId,
      ["github.create_issue", "github.list_repos"],
    );

    // Then only selected tools are imported
    expect(syncRes.status).toBe(200);

    const listRes = await listTools(baseUrl, admin, admin.workspaceId);
    const listBody = await listRes.json() as { tools: Array<{ name: string }> };
    const toolNames = listBody.tools.map((t) => t.name);
    expect(toolNames).toContain("github.create_issue");
    expect(toolNames).toContain("github.list_repos");
    expect(toolNames).not.toContain("github.delete_branch");
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Re-sync with Changes
// ---------------------------------------------------------------------------
describe("Admin re-syncs server to detect changes", () => {
  it("re-sync detects existing tools as unchanged", async () => {
    const { baseUrl, surreal } = getRuntime();
    const admin = await createTestUserWithMcp(baseUrl, surreal, `ws-resync-${crypto.randomUUID()}`);

    // Given a server with previously imported tools that match the mock
    const { serverId } = await seedMcpServer(surreal, admin.workspaceId, {
      name: "GitHub Tools",
      url: "https://mcp.test.local/github",
      lastStatus: "ok",
      toolCount: 2,
      lastDiscovery: new Date("2026-03-01"),
    });
    // Seed tools matching mock's output exactly
    await seedDiscoveredTool(surreal, admin.workspaceId, serverId, {
      name: "github.create_issue",
      toolkit: "github",
      description: "Create a GitHub issue",
      inputSchema: { type: "object", properties: { title: { type: "string" } }, required: ["title"] },
    });
    await seedDiscoveredTool(surreal, admin.workspaceId, serverId, {
      name: "github.list_repos",
      toolkit: "github",
      description: "List repositories",
      inputSchema: { type: "object", properties: {} },
    });

    // When admin triggers dry-run re-sync
    const res = await discoverTools(baseUrl, admin, admin.workspaceId, serverId, {
      dryRun: true,
    });

    // Then the result shows existing tools as unchanged or update + new tool as create
    expect(res.status).toBe(200);
    const body = await res.json() as {
      tools: Array<{ name: string; action: string }>;
    };
    // Existing tools should not be "create" — they are "unchanged" or "update"
    const existingActions = body.tools
      .filter((t) => t.name === "github.create_issue" || t.name === "github.list_repos")
      .map((t) => t.action);
    for (const action of existingActions) {
      expect(["unchanged", "update"]).toContain(action);
    }
    // New tool should be "create"
    const deleteBranch = body.tools.find((t) => t.name === "github.delete_branch");
    expect(deleteBranch).toBeDefined();
    expect(deleteBranch!.action).toBe("create");
  }, 60_000);

  it("re-sync detects removed tools as action 'disable'", async () => {
    const { baseUrl, surreal } = getRuntime();
    const admin = await createTestUserWithMcp(baseUrl, surreal, `ws-disable-${crypto.randomUUID()}`);

    // Given a server with an imported tool that no longer exists on the server
    const { serverId } = await seedMcpServer(surreal, admin.workspaceId, {
      name: "GitHub Tools",
      url: "https://mcp.test.local/github",
      lastStatus: "ok",
      toolCount: 1,
    });
    await seedDiscoveredTool(surreal, admin.workspaceId, serverId, {
      name: "github.legacy_search",
      toolkit: "github",
    });

    // When admin triggers dry-run re-sync
    const res = await discoverTools(baseUrl, admin, admin.workspaceId, serverId, {
      dryRun: true,
    });

    // Then the removed tool shows action "disable"
    expect(res.status).toBe(200);
    const body = await res.json() as {
      disabled: number;
      tools: Array<{ name: string; action: string }>;
    };
    const disabled = body.tools.find((t) => t.name === "github.legacy_search");
    expect(disabled).toBeDefined();
    expect(disabled!.action).toBe("disable");
  }, 60_000);

  it("sync updates server tool_count and last_discovery after apply", async () => {
    const { baseUrl, surreal } = getRuntime();
    const admin = await createTestUserWithMcp(baseUrl, surreal, `ws-count-${crypto.randomUUID()}`);

    const { serverId } = await seedMcpServer(surreal, admin.workspaceId, {
      name: "GitHub Tools",
      url: "https://mcp.test.local/github",
      lastStatus: "ok",
      toolCount: 0,
    });

    // When admin syncs tools
    await syncServerTools(baseUrl, admin, admin.workspaceId, serverId);

    // Then the server record is updated
    const listRes = await listMcpServers(baseUrl, admin, admin.workspaceId);
    const body = await listRes.json() as {
      servers: Array<{ name: string; tool_count: number; last_discovery?: string }>;
    };
    const server = body.servers.find((s) => s.name === "GitHub Tools");
    expect(server).toBeDefined();
    expect(server!.tool_count).toBeGreaterThan(0);
    expect(server!.last_discovery).toBeTruthy();
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Risk Level Inference
// ---------------------------------------------------------------------------
describe("Discovery infers risk level from MCP annotations", () => {
  it("read-only tool inferred as low risk, destructive as high", async () => {
    const { baseUrl, surreal } = getRuntime();
    const admin = await createTestUserWithMcp(baseUrl, surreal, `ws-risk-${crypto.randomUUID()}`);

    const { serverId } = await seedMcpServer(surreal, admin.workspaceId, {
      name: "Annotated Server",
      url: "https://mcp.test.local/annotated",
      lastStatus: "ok",
    });

    // When admin triggers discovery
    const res = await discoverTools(baseUrl, admin, admin.workspaceId, serverId, {
      dryRun: true,
    });

    // Then tools with readOnlyHint are low risk, destructiveHint are high
    expect(res.status).toBe(200);
    const body = await res.json() as {
      tools: Array<{ name: string; risk_level: string }>;
    };
    const listRepos = body.tools.find((t) => t.name === "github.list_repos");
    expect(listRepos!.risk_level).toBe("low");

    const deleteBranch = body.tools.find((t) => t.name === "github.delete_branch");
    expect(deleteBranch!.risk_level).toBe("high");

    const createIssue = body.tools.find((t) => t.name === "github.create_issue");
    expect(createIssue!.risk_level).toBe("medium");
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Error Paths
// ---------------------------------------------------------------------------
describe("Discovery error handling", () => {
  it("returns 404 for discovery on nonexistent server", async () => {
    const { baseUrl, surreal } = getRuntime();
    const admin = await createTestUserWithMcp(baseUrl, surreal, `ws-nosvr-${crypto.randomUUID()}`);

    const res = await discoverTools(
      baseUrl, admin, admin.workspaceId, "nonexistent-server-id",
      { dryRun: true },
    );

    expect(res.status).toBe(404);
  }, 60_000);

  it("returns 404 for sync on nonexistent server", async () => {
    const { baseUrl, surreal } = getRuntime();
    const admin = await createTestUserWithMcp(baseUrl, surreal, `ws-nosync-${crypto.randomUUID()}`);

    const res = await syncServerTools(
      baseUrl, admin, admin.workspaceId, "nonexistent-server-id",
    );

    expect(res.status).toBe(404);
  }, 60_000);

  it("dry-run does not modify database state", async () => {
    const { baseUrl, surreal } = getRuntime();
    const admin = await createTestUserWithMcp(baseUrl, surreal, `ws-dryrun-${crypto.randomUUID()}`);

    const { serverId } = await seedMcpServer(surreal, admin.workspaceId, {
      name: "GitHub Tools",
      url: "https://mcp.test.local/github",
      lastStatus: "ok",
      toolCount: 0,
    });

    // When admin runs dry-run discovery
    await discoverTools(baseUrl, admin, admin.workspaceId, serverId, { dryRun: true });

    // Then no tools were created
    const listRes = await listTools(baseUrl, admin, admin.workspaceId);
    const body = await listRes.json() as { tools: Array<unknown> };
    expect(body.tools.length).toBe(0);

    // And server tool_count is unchanged
    const serverRes = await listMcpServers(baseUrl, admin, admin.workspaceId);
    const servers = await serverRes.json() as {
      servers: Array<{ name: string; tool_count: number }>;
    };
    const server = servers.servers.find((s) => s.name === "GitHub Tools");
    expect(server!.tool_count).toBe(0);
  }, 60_000);
});
