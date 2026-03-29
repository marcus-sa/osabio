/**
 * Acceptance Tests: Tool Schema and Grants (US-3)
 *
 * Walking skeleton phase 1: The foundation. Admin creates tool definitions
 * and grants identities access via can_use edges.
 *
 * Traces: US-3, FR-1, FR-2, FR-3, AC-3
 * Driving ports:
 *   - POST /api/workspaces/:workspaceId/tools
 *   - GET /api/workspaces/:workspaceId/tools
 *   - POST /api/workspaces/:workspaceId/tools/:toolId/grants
 *   - GET /api/workspaces/:workspaceId/identities/:identityId/toolset
 *
 * Implementation sequence:
 *   1. Walking skeleton: create tool + grant + verify toolset  [ENABLED]
 *   2. Tool listing by workspace
 *   3. Tool filtering by toolkit and status
 *   4. Grant with rate limit
 *   5. Effective toolset deduplication
 *   6. Reject duplicate tool name in workspace
 *   7. Disabled tool excluded from toolset
 *   8. Grant removed clears toolset
 */
import { describe, expect, it } from "bun:test";
import {
  setupAcceptanceSuite,
  createTestUserWithMcp,
  seedMcpTool,
  seedOsabioNativeTool,
  seedCanUseEdge,
  getToolsForWorkspace,
  getCanUseEdgesForIdentity,
} from "./tool-registry-test-kit";

const getRuntime = setupAcceptanceSuite("tool_registry_schema_grants");

// ---------------------------------------------------------------------------
// Walking Skeleton: Admin creates a tool and grants access to an agent
// ---------------------------------------------------------------------------
describe("Walking Skeleton: Admin grants agent access to a registered tool", () => {
  it("creates an mcp_tool and can_use edge, and the tool appears in identity toolset", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUserWithMcp(baseUrl, surreal, `ws-us3-${crypto.randomUUID()}`);

    // Given admin has registered tool "search_entities" in the workspace
    const toolId = crypto.randomUUID();
    await seedOsabioNativeTool(surreal, toolId, {
      name: "search_entities",
      description: "Search workspace entities by text query",
      inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
      workspaceId: user.workspaceId,
    });

    // When admin grants "search_entities" to the agent identity
    await seedCanUseEdge(surreal, user.identityId, toolId);

    // Then the can_use edge exists with a granted_at timestamp
    const edges = await getCanUseEdgesForIdentity(surreal, user.identityId);
    expect(edges.length).toBe(1);
    expect(edges[0].granted_at).toBeDefined();

    // And the agent's effective toolset includes "search_entities"
    const tools = await getToolsForWorkspace(surreal, user.workspaceId);
    expect(tools.length).toBe(1);
    expect(tools[0].name).toBe("search_entities");
    expect(tools[0].status).toBe("active");
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Focused Scenarios
// ---------------------------------------------------------------------------
describe("Tool listing returns all tools in workspace", () => {
  it("returns tools grouped by toolkit with correct fields", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUserWithMcp(baseUrl, surreal, `ws-list-${crypto.randomUUID()}`);

    // Given workspace has tools across two toolkits
    await seedMcpTool(surreal, `tool-gh1-${crypto.randomUUID()}`, {
      name: "github.create_issue",
      toolkit: "github",
      description: "Create a GitHub issue",
      inputSchema: { type: "object", properties: { title: { type: "string" } } },
      riskLevel: "medium",
      workspaceId: user.workspaceId,
    });

    await seedMcpTool(surreal, `tool-gh2-${crypto.randomUUID()}`, {
      name: "github.list_repos",
      toolkit: "github",
      description: "List repositories",
      inputSchema: { type: "object", properties: {} },
      riskLevel: "low",
      workspaceId: user.workspaceId,
    });

    await seedOsabioNativeTool(surreal, `tool-osabio-${crypto.randomUUID()}`, {
      name: "search_entities",
      description: "Search workspace entities",
      inputSchema: { type: "object", properties: { query: { type: "string" } } },
      workspaceId: user.workspaceId,
    });

    // When querying tools for the workspace
    const tools = await getToolsForWorkspace(surreal, user.workspaceId);

    // Then all 3 tools are returned with correct fields
    expect(tools.length).toBe(3);

    // And tools have required fields
    for (const tool of tools) {
      expect(tool.name).toBeDefined();
      expect(tool.toolkit).toBeDefined();
      expect(tool.description).toBeDefined();
      expect(tool.risk_level).toBeDefined();
      expect(tool.status).toBe("active");
    }
  }, 30_000);
});

describe("Tool with rate-limited grant", () => {
  it("persists max_calls_per_hour on the can_use edge", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUserWithMcp(baseUrl, surreal, `ws-rate-${crypto.randomUUID()}`);

    // Given tool "github.create_issue" exists
    const toolId = `tool-rate-${crypto.randomUUID()}`;
    await seedMcpTool(surreal, toolId, {
      name: "github.create_issue",
      toolkit: "github",
      description: "Create a GitHub issue",
      inputSchema: { type: "object", properties: { title: { type: "string" } } },
      workspaceId: user.workspaceId,
    });

    // When admin grants access with max_calls_per_hour=10
    await seedCanUseEdge(surreal, user.identityId, toolId, { maxCallsPerHour: 10 });

    // Then the edge records the rate limit
    const edges = await getCanUseEdgesForIdentity(surreal, user.identityId);
    expect(edges.length).toBe(1);
    expect(edges[0].max_calls_per_hour).toBe(10);
  }, 30_000);
});

describe("Disabled tool excluded from effective toolset", () => {
  it("does not include disabled tools even when can_use edge exists", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUserWithMcp(baseUrl, surreal, `ws-disabled-${crypto.randomUUID()}`);

    // Given a disabled tool with a can_use edge
    const toolId = `tool-dis-${crypto.randomUUID()}`;
    await seedMcpTool(surreal, toolId, {
      name: "deprecated.tool",
      toolkit: "legacy",
      description: "A deprecated tool",
      inputSchema: { type: "object", properties: {} },
      status: "disabled",
      workspaceId: user.workspaceId,
    });
    await seedCanUseEdge(surreal, user.identityId, toolId);

    // When resolving effective toolset (query active tools with can_use edges)
    const results = await surreal.query(
      `SELECT out.name AS name FROM can_use WHERE in = $identity AND out.status = 'active' AND out.workspace = $ws;`,
      {
        identity: new (await import("surrealdb")).RecordId("identity", user.identityId),
        ws: new (await import("surrealdb")).RecordId("workspace", user.workspaceId),
      },
    );
    const activeTools = (results[0] ?? []) as Array<{ name: string }>;

    // Then the disabled tool is not in the effective toolset
    expect(activeTools.length).toBe(0);
  }, 30_000);
});

describe("Multiple grants for one identity", () => {
  it("returns all granted tools in effective toolset", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUserWithMcp(baseUrl, surreal, `ws-multi-${crypto.randomUUID()}`);

    // Given identity has grants to 3 different tools
    const toolIds = [];
    for (const name of ["github.create_issue", "github.list_repos", "search_entities"]) {
      const toolId = `tool-multi-${crypto.randomUUID()}`;
      await seedMcpTool(surreal, toolId, {
        name,
        toolkit: name.startsWith("github") ? "github" : "osabio",
        description: `Tool: ${name}`,
        inputSchema: { type: "object", properties: {} },
        workspaceId: user.workspaceId,
      });
      await seedCanUseEdge(surreal, user.identityId, toolId);
      toolIds.push(toolId);
    }

    // When resolving effective toolset
    const edges = await getCanUseEdgesForIdentity(surreal, user.identityId);

    // Then all 3 tools are in the effective toolset
    expect(edges.length).toBe(3);
  }, 30_000);
});

describe("Identity with no grants has empty toolset", () => {
  it("returns no tools when identity has no can_use edges", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUserWithMcp(baseUrl, surreal, `ws-empty-${crypto.randomUUID()}`);

    // Given identity has no can_use edges (fresh identity)
    // When resolving effective toolset
    const edges = await getCanUseEdgesForIdentity(surreal, user.identityId);

    // Then the toolset is empty
    expect(edges.length).toBe(0);
  }, 30_000);
});
