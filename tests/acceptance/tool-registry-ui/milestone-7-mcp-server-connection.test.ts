/**
 * Milestone 7: MCP Server Connection
 *
 * Traces: US-UI-09 (MCP Server Connection)
 *
 * Tests the MCP server registration and connection endpoints that power
 * the MCP Servers section in the Tools tab. Covers server CRUD, transport
 * selection, credential provider linking, URL validation, duplicate name
 * detection, and connection failure handling.
 *
 * Driving ports:
 *   POST   /api/workspaces/:wsId/mcp-servers              (register server)
 *   GET    /api/workspaces/:wsId/mcp-servers               (list servers)
 *   GET    /api/workspaces/:wsId/mcp-servers/:serverId     (server detail)
 *   DELETE /api/workspaces/:wsId/mcp-servers/:serverId     (remove server)
 */
import { describe, expect, it } from "bun:test";
import {
  setupToolRegistrySuite,
  createTestUserWithMcp,
  addMcpServer,
  listMcpServers,
  getMcpServerDetail,
  removeMcpServer,
  seedMcpServer,
  seedProvider,
  seedAccount,
  seedDiscoveredTool,
  listTools,
} from "./tool-registry-ui-test-kit";

const getRuntime = setupToolRegistrySuite("tool_registry_ui_mcp_server_connection");

// ---------------------------------------------------------------------------
// Happy Path: Server Registration
// ---------------------------------------------------------------------------
describe("Admin registers MCP servers", () => {
  it("registers an unauthenticated MCP server with Streamable HTTP transport", async () => {
    const { baseUrl, surreal } = getRuntime();
    const admin = await createTestUserWithMcp(baseUrl, surreal, `ws-srv-${crypto.randomUUID()}`);

    // Given a workspace with no MCP servers
    // When admin registers an MCP server
    const res = await addMcpServer(baseUrl, admin, admin.workspaceId, {
      name: "GitHub Tools",
      url: "https://mcp.acme.dev/github",
      transport: "streamable-http",
    });

    // Then the server is created
    expect(res.status).toBe(201);
    const body = await res.json() as {
      id: string;
      name: string;
      url: string;
      transport: string;
      tool_count: number;
    };
    expect(body.name).toBe("GitHub Tools");
    expect(body.url).toBe("https://mcp.acme.dev/github");
    expect(body.transport).toBe("streamable-http");
    expect(body.tool_count).toBe(0);
  }, 60_000);

  it("registers an MCP server with SSE transport", async () => {
    const { baseUrl, surreal } = getRuntime();
    const admin = await createTestUserWithMcp(baseUrl, surreal, `ws-sse-${crypto.randomUUID()}`);

    const res = await addMcpServer(baseUrl, admin, admin.workspaceId, {
      name: "Jira Tools",
      url: "https://mcp.acme.dev/jira",
      transport: "sse",
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { transport: string };
    expect(body.transport).toBe("sse");
  }, 60_000);

  it("registers an authenticated MCP server linked to credential provider", async () => {
    const { baseUrl, surreal } = getRuntime();
    const admin = await createTestUserWithMcp(baseUrl, surreal, `ws-auth-${crypto.randomUUID()}`);

    // Given a credential provider exists
    const { providerId } = await seedProvider(surreal, admin.workspaceId, {
      name: "jira-api-key",
      displayName: "Jira API Key",
      authMethod: "api_key",
      apiKeyHeader: "X-API-Key",
    });

    // When admin registers an MCP server linked to the provider
    const res = await addMcpServer(baseUrl, admin, admin.workspaceId, {
      name: "Jira Tools",
      url: "https://mcp.acme.dev/jira",
      transport: "sse",
      provider_id: providerId,
    });

    // Then the server is created with the provider link
    expect(res.status).toBe(201);
    const body = await res.json() as { provider_id?: string; provider_name?: string };
    expect(body.provider_id).toBe(providerId);
    expect(body.provider_name).toBe("Jira API Key");
  }, 60_000);

  it("defaults transport to streamable-http when not specified", async () => {
    const { baseUrl, surreal } = getRuntime();
    const admin = await createTestUserWithMcp(baseUrl, surreal, `ws-def-${crypto.randomUUID()}`);

    const res = await addMcpServer(baseUrl, admin, admin.workspaceId, {
      name: "Default Transport Server",
      url: "https://mcp.acme.dev/default",
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { transport: string };
    expect(body.transport).toBe("streamable-http");
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Server Listing and Detail
// ---------------------------------------------------------------------------
describe("Admin views MCP server list and detail", () => {
  it("lists all MCP servers in the workspace", async () => {
    const { baseUrl, surreal } = getRuntime();
    const admin = await createTestUserWithMcp(baseUrl, surreal, `ws-list-${crypto.randomUUID()}`);

    // Given two servers exist
    await seedMcpServer(surreal, admin.workspaceId, {
      name: "GitHub Tools",
      url: "https://mcp.acme.dev/github",
      lastStatus: "ok",
      toolCount: 11,
    });
    await seedMcpServer(surreal, admin.workspaceId, {
      name: "Legacy API",
      url: "https://mcp.acme.dev/legacy",
      lastStatus: "error",
      lastError: "Connection refused",
    });

    // When admin lists servers
    const res = await listMcpServers(baseUrl, admin, admin.workspaceId);

    // Then both servers appear with status data
    expect(res.status).toBe(200);
    const body = await res.json() as {
      servers: Array<{
        name: string;
        last_status: string;
        tool_count: number;
        last_error?: string;
      }>;
    };
    expect(body.servers.length).toBe(2);

    const github = body.servers.find((s) => s.name === "GitHub Tools");
    expect(github).toBeDefined();
    expect(github!.last_status).toBe("ok");
    expect(github!.tool_count).toBe(11);

    const legacy = body.servers.find((s) => s.name === "Legacy API");
    expect(legacy).toBeDefined();
    expect(legacy!.last_status).toBe("error");
    expect(legacy!.last_error).toContain("Connection refused");
  }, 60_000);

  it("returns server detail with capabilities and server info", async () => {
    const { baseUrl, surreal } = getRuntime();
    const admin = await createTestUserWithMcp(baseUrl, surreal, `ws-detail-${crypto.randomUUID()}`);

    const { serverId } = await seedMcpServer(surreal, admin.workspaceId, {
      name: "GitHub Tools",
      url: "https://mcp.acme.dev/github",
      lastStatus: "ok",
      toolCount: 11,
      lastDiscovery: new Date("2026-03-20"),
    });

    const res = await getMcpServerDetail(baseUrl, admin, admin.workspaceId, serverId);

    expect(res.status).toBe(200);
    const body = await res.json() as {
      name: string;
      url: string;
      transport: string;
      tool_count: number;
      last_discovery?: string;
    };
    expect(body.name).toBe("GitHub Tools");
    expect(body.tool_count).toBe(11);
    expect(body.last_discovery).toBeTruthy();
  }, 60_000);

  it("returns empty list when no MCP servers exist", async () => {
    const { baseUrl, surreal } = getRuntime();
    const admin = await createTestUserWithMcp(baseUrl, surreal, `ws-empty-${crypto.randomUUID()}`);

    const res = await listMcpServers(baseUrl, admin, admin.workspaceId);

    expect(res.status).toBe(200);
    const body = await res.json() as { servers: Array<unknown> };
    expect(body.servers.length).toBe(0);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Error Paths: Validation
// ---------------------------------------------------------------------------
describe("MCP server registration validates input", () => {
  it("rejects duplicate server name within workspace", async () => {
    const { baseUrl, surreal } = getRuntime();
    const admin = await createTestUserWithMcp(baseUrl, surreal, `ws-dup-${crypto.randomUUID()}`);

    // Given server "GitHub Tools" already exists
    await seedMcpServer(surreal, admin.workspaceId, {
      name: "GitHub Tools",
      url: "https://mcp.acme.dev/github",
    });

    // When admin tries to register another server with the same name
    const res = await addMcpServer(baseUrl, admin, admin.workspaceId, {
      name: "GitHub Tools",
      url: "https://mcp.acme.dev/github-2",
    });

    // Then the request is rejected with a conflict error
    expect(res.status).toBe(409);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("GitHub Tools");
  }, 60_000);

  it("rejects non-http URL scheme", async () => {
    const { baseUrl, surreal } = getRuntime();
    const admin = await createTestUserWithMcp(baseUrl, surreal, `ws-url-${crypto.randomUUID()}`);

    // When admin registers with a file:// URL
    const res = await addMcpServer(baseUrl, admin, admin.workspaceId, {
      name: "Bad Server",
      url: "file:///etc/passwd",
    });

    // Then the request is rejected
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("url");
  }, 60_000);

  it("rejects javascript: URL scheme", async () => {
    const { baseUrl, surreal } = getRuntime();
    const admin = await createTestUserWithMcp(baseUrl, surreal, `ws-js-${crypto.randomUUID()}`);

    const res = await addMcpServer(baseUrl, admin, admin.workspaceId, {
      name: "XSS Server",
      url: "javascript:alert(1)",
    });

    expect(res.status).toBe(400);
  }, 60_000);

  it("rejects missing server name", async () => {
    const { baseUrl, surreal } = getRuntime();
    const admin = await createTestUserWithMcp(baseUrl, surreal, `ws-noname-${crypto.randomUUID()}`);

    const res = await addMcpServer(baseUrl, admin, admin.workspaceId, {
      name: "",
      url: "https://mcp.acme.dev/test",
    });

    expect(res.status).toBe(400);
  }, 60_000);

  it("rejects missing URL", async () => {
    const { baseUrl, surreal } = getRuntime();
    const admin = await createTestUserWithMcp(baseUrl, surreal, `ws-nourl-${crypto.randomUUID()}`);

    const res = await addMcpServer(baseUrl, admin, admin.workspaceId, {
      name: "No URL Server",
      url: "",
    });

    expect(res.status).toBe(400);
  }, 60_000);

  it("rejects invalid transport value", async () => {
    const { baseUrl, surreal } = getRuntime();
    const admin = await createTestUserWithMcp(baseUrl, surreal, `ws-badtr-${crypto.randomUUID()}`);

    const res = await addMcpServer(baseUrl, admin, admin.workspaceId, {
      name: "Bad Transport",
      url: "https://mcp.acme.dev/test",
      transport: "websocket" as "sse",
    });

    expect(res.status).toBe(400);
  }, 60_000);

  it("rejects link to nonexistent credential provider", async () => {
    const { baseUrl, surreal } = getRuntime();
    const admin = await createTestUserWithMcp(baseUrl, surreal, `ws-noprov-${crypto.randomUUID()}`);

    const res = await addMcpServer(baseUrl, admin, admin.workspaceId, {
      name: "Auth Server",
      url: "https://mcp.acme.dev/test",
      provider_id: "nonexistent-provider-id",
    });

    expect(res.status).toBe(404);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Server Removal
// ---------------------------------------------------------------------------
describe("Admin removes MCP servers", () => {
  it("removes server and returns confirmation", async () => {
    const { baseUrl, surreal } = getRuntime();
    const admin = await createTestUserWithMcp(baseUrl, surreal, `ws-rm-${crypto.randomUUID()}`);

    const { serverId } = await seedMcpServer(surreal, admin.workspaceId, {
      name: "Legacy API",
      url: "https://mcp.acme.dev/legacy",
    });

    // When admin removes the server
    const res = await removeMcpServer(baseUrl, admin, admin.workspaceId, serverId);

    // Then the server is removed
    expect(res.status).toBe(200);

    // And it no longer appears in the list
    const listRes = await listMcpServers(baseUrl, admin, admin.workspaceId);
    const body = await listRes.json() as { servers: Array<{ name: string }> };
    const found = body.servers.find((s) => s.name === "Legacy API");
    expect(found).toBeUndefined();
  }, 60_000);

  it("disables discovered tools when server is removed", async () => {
    const { baseUrl, surreal } = getRuntime();
    const admin = await createTestUserWithMcp(baseUrl, surreal, `ws-rmtools-${crypto.randomUUID()}`);

    // Given a server with 2 discovered tools
    const { serverId } = await seedMcpServer(surreal, admin.workspaceId, {
      name: "GitHub Tools",
      url: "https://mcp.acme.dev/github",
      toolCount: 2,
    });
    await seedDiscoveredTool(surreal, admin.workspaceId, serverId, {
      name: "github.create_issue",
      toolkit: "github",
      status: "active",
    });
    await seedDiscoveredTool(surreal, admin.workspaceId, serverId, {
      name: "github.list_repos",
      toolkit: "github",
      status: "active",
    });

    // When admin removes the server
    await removeMcpServer(baseUrl, admin, admin.workspaceId, serverId);

    // Then discovered tools are disabled (not deleted)
    const listRes = await listTools(baseUrl, admin, admin.workspaceId);
    const body = await listRes.json() as { tools: Array<{ name: string; status: string }> };
    const githubTools = body.tools.filter((t) => t.name.startsWith("github."));
    for (const tool of githubTools) {
      expect(tool.status).toBe("disabled");
    }
  }, 60_000);

  it("returns 404 when removing nonexistent server", async () => {
    const { baseUrl, surreal } = getRuntime();
    const admin = await createTestUserWithMcp(baseUrl, surreal, `ws-rmnone-${crypto.randomUUID()}`);

    const res = await removeMcpServer(
      baseUrl, admin, admin.workspaceId, "nonexistent-server-id",
    );

    expect(res.status).toBe(404);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Workspace Isolation
// ---------------------------------------------------------------------------
describe("MCP servers are workspace-scoped", () => {
  it("only returns servers belonging to the requested workspace", async () => {
    const { baseUrl, surreal } = getRuntime();
    const admin1 = await createTestUserWithMcp(baseUrl, surreal, `ws-iso1-${crypto.randomUUID()}`);
    const admin2 = await createTestUserWithMcp(baseUrl, surreal, `ws-iso2-${crypto.randomUUID()}`);

    // Given a server in workspace 1
    await seedMcpServer(surreal, admin1.workspaceId, {
      name: "GitHub Tools",
      url: "https://mcp.acme.dev/github",
    });

    // And a server in workspace 2
    await seedMcpServer(surreal, admin2.workspaceId, {
      name: "Jira Tools",
      url: "https://mcp.acme.dev/jira",
    });

    // When admin1 lists servers
    const res = await listMcpServers(baseUrl, admin1, admin1.workspaceId);
    const body = await res.json() as { servers: Array<{ name: string }> };

    // Then only workspace 1 servers appear
    expect(body.servers.length).toBe(1);
    expect(body.servers[0].name).toBe("GitHub Tools");
  }, 60_000);
});
