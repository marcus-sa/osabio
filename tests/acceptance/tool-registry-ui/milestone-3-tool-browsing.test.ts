/**
 * Milestone 3: Tool Browsing and Detail
 *
 * Traces: US-UI-02 (browse tools), US-UI-01 (empty state)
 *
 * Tests the tool listing and detail endpoints that power the Tools tab.
 * Covers toolkit grouping, grant/governance counts, status/risk filtering,
 * tool detail with schema and relationships, and empty states.
 *
 * Driving ports:
 *   GET /api/workspaces/:wsId/tools            (list tools)
 *   GET /api/workspaces/:wsId/tools/:toolId    (tool detail)
 */
import { describe, expect, it } from "bun:test";
import {
  setupToolRegistrySuite,
  createTestUserWithMcp,
  listTools,
  getToolDetail,
  seedTool,
  seedProvider,
  seedGrant,
  seedGovernance,
  seedPolicy,
  createIdentity,
} from "./tool-registry-ui-test-kit";

const getRuntime = setupToolRegistrySuite("tool_registry_ui_tool_browsing");

// ---------------------------------------------------------------------------
// Happy Path: Tool Listing
// ---------------------------------------------------------------------------
describe("Admin browses tools grouped by toolkit", () => {
  it.skip("returns tools grouped by toolkit with correct counts", async () => {
    const { baseUrl, surreal } = getRuntime();
    const admin = await createTestUserWithMcp(baseUrl, surreal, `ws-group-${crypto.randomUUID()}`);

    // Given tools across three toolkits
    const { providerId } = await seedProvider(surreal, admin.workspaceId, {
      name: "github",
      displayName: "GitHub",
      authMethod: "oauth2",
    });

    await seedTool(surreal, admin.workspaceId, {
      name: "github.create_issue",
      toolkit: "github",
      riskLevel: "medium",
      providerId,
    });
    await seedTool(surreal, admin.workspaceId, {
      name: "github.list_reviews",
      toolkit: "github",
      riskLevel: "low",
      providerId,
    });
    await seedTool(surreal, admin.workspaceId, {
      name: "slack.post_message",
      toolkit: "slack",
      riskLevel: "low",
    });
    await seedTool(surreal, admin.workspaceId, {
      name: "linear.create_issue",
      toolkit: "linear",
      riskLevel: "medium",
    });

    // When admin requests the tools list
    const res = await listTools(baseUrl, admin, admin.workspaceId);

    // Then all four tools are returned
    expect(res.status).toBe(200);
    const body = await res.json() as { tools: Array<{ name: string; toolkit: string }> };
    expect(body.tools.length).toBe(4);

    // And tools can be grouped by toolkit
    const toolkits = [...new Set(body.tools.map((t) => t.toolkit))];
    expect(toolkits).toContain("github");
    expect(toolkits).toContain("slack");
    expect(toolkits).toContain("linear");
  }, 60_000);

  it.skip("includes grant count per tool", async () => {
    const { baseUrl, surreal } = getRuntime();
    const admin = await createTestUserWithMcp(baseUrl, surreal, `ws-grants-${crypto.randomUUID()}`);

    const { toolId } = await seedTool(surreal, admin.workspaceId, {
      name: "github.create_issue",
      toolkit: "github",
    });

    // Given two identities have been granted access
    const { identityId: id1 } = await createIdentity(surreal, admin.workspaceId, "coding-agent-1");
    const { identityId: id2 } = await createIdentity(surreal, admin.workspaceId, "review-agent");
    await seedGrant(surreal, id1, toolId);
    await seedGrant(surreal, id2, toolId);

    // When admin lists tools
    const res = await listTools(baseUrl, admin, admin.workspaceId);

    // Then the tool shows grant_count of 2
    expect(res.status).toBe(200);
    const body = await res.json() as { tools: Array<{ name: string; grant_count: number }> };
    const tool = body.tools.find((t) => t.name === "github.create_issue");
    expect(tool).toBeDefined();
    expect(tool!.grant_count).toBe(2);
  }, 60_000);

  it.skip("includes governance count per tool", async () => {
    const { baseUrl, surreal } = getRuntime();
    const admin = await createTestUserWithMcp(baseUrl, surreal, `ws-gov-${crypto.randomUUID()}`);

    const { toolId } = await seedTool(surreal, admin.workspaceId, {
      name: "github.merge_pr",
      toolkit: "github",
      riskLevel: "high",
    });

    const { policyId } = await seedPolicy(surreal, admin.workspaceId, {
      title: "no-auto-merge",
    });
    await seedGovernance(surreal, policyId, toolId, {
      conditions: "requires_human_approval",
    });

    // When admin lists tools
    const res = await listTools(baseUrl, admin, admin.workspaceId);

    // Then the tool shows governance_count of 1
    expect(res.status).toBe(200);
    const body = await res.json() as { tools: Array<{ name: string; governance_count: number }> };
    const tool = body.tools.find((t) => t.name === "github.merge_pr");
    expect(tool).toBeDefined();
    expect(tool!.governance_count).toBe(1);
  }, 60_000);

  it.skip("returns each tool with complete data shape for UI rendering", async () => {
    const { baseUrl, surreal } = getRuntime();
    const admin = await createTestUserWithMcp(baseUrl, surreal, `ws-shape-${crypto.randomUUID()}`);

    const { providerId } = await seedProvider(surreal, admin.workspaceId, {
      name: "github",
      displayName: "GitHub",
      authMethod: "oauth2",
    });

    await seedTool(surreal, admin.workspaceId, {
      name: "github.create_issue",
      toolkit: "github",
      description: "Create a GitHub issue in the specified repository",
      riskLevel: "medium",
      status: "active",
      providerId,
    });

    const res = await listTools(baseUrl, admin, admin.workspaceId);
    expect(res.status).toBe(200);

    const body = await res.json() as { tools: Array<Record<string, unknown>> };
    const tool = body.tools[0];

    // Then the tool has all fields the UI needs for rendering
    expect(tool.name).toBe("github.create_issue");
    expect(tool.toolkit).toBe("github");
    expect(tool.description).toBeTruthy();
    expect(tool.risk_level).toBe("medium");
    expect(tool.status).toBe("active");
    expect(typeof tool.grant_count).toBe("number");
    expect(tool.created_at).toBeTruthy();
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Tool Detail
// ---------------------------------------------------------------------------
describe("Admin views tool detail", () => {
  it.skip("returns tool with grants and governance policies", async () => {
    const { baseUrl, surreal } = getRuntime();
    const admin = await createTestUserWithMcp(baseUrl, surreal, `ws-detail-${crypto.randomUUID()}`);

    // Given a tool with grants and governance
    const { toolId } = await seedTool(surreal, admin.workspaceId, {
      name: "github.merge_pr",
      toolkit: "github",
      description: "Merge a pull request",
      riskLevel: "high",
      inputSchema: {
        type: "object",
        properties: {
          pr_number: { type: "number" },
          repository: { type: "string" },
        },
      },
    });

    const { identityId } = await createIdentity(surreal, admin.workspaceId, "coding-agent-1");
    await seedGrant(surreal, identityId, toolId, { maxCallsPerHour: 10 });

    const { policyId } = await seedPolicy(surreal, admin.workspaceId, { title: "no-auto-merge" });
    await seedGovernance(surreal, policyId, toolId, {
      conditions: "requires_human_approval",
      maxPerDay: 5,
    });

    // When admin requests tool detail
    const res = await getToolDetail(baseUrl, admin, admin.workspaceId, toolId);

    // Then the detail includes schema, grants, and governance
    expect(res.status).toBe(200);
    const detail = await res.json() as {
      name: string;
      input_schema: Record<string, unknown>;
      grants: Array<{ identity_name: string; max_calls_per_hour?: number }>;
      governance_policies: Array<{
        policy_title: string;
        conditions?: string;
        max_per_day?: number;
      }>;
    };

    expect(detail.name).toBe("github.merge_pr");
    expect(detail.input_schema).toBeDefined();

    expect(detail.grants.length).toBe(1);
    expect(detail.grants[0].identity_name).toBe("coding-agent-1");
    expect(detail.grants[0].max_calls_per_hour).toBe(10);

    expect(detail.governance_policies.length).toBe(1);
    expect(detail.governance_policies[0].policy_title).toBe("no-auto-merge");
    expect(detail.governance_policies[0].conditions).toBe("requires_human_approval");
    expect(detail.governance_policies[0].max_per_day).toBe(5);
  }, 60_000);

  it.skip("returns tool with empty grants and governance when none exist", async () => {
    const { baseUrl, surreal } = getRuntime();
    const admin = await createTestUserWithMcp(baseUrl, surreal, `ws-norel-${crypto.randomUUID()}`);

    const { toolId } = await seedTool(surreal, admin.workspaceId, {
      name: "slack.post_message",
      toolkit: "slack",
    });

    const res = await getToolDetail(baseUrl, admin, admin.workspaceId, toolId);

    expect(res.status).toBe(200);
    const detail = await res.json() as {
      grants: Array<unknown>;
      governance_policies: Array<unknown>;
    };
    expect(detail.grants.length).toBe(0);
    expect(detail.governance_policies.length).toBe(0);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Error Paths
// ---------------------------------------------------------------------------
describe("Tool browsing error paths", () => {
  it.skip("returns empty list when no tools exist in workspace", async () => {
    const { baseUrl, surreal } = getRuntime();
    const admin = await createTestUserWithMcp(baseUrl, surreal, `ws-empty-${crypto.randomUUID()}`);

    // Given a workspace with no tools
    const res = await listTools(baseUrl, admin, admin.workspaceId);

    // Then an empty tools list is returned
    expect(res.status).toBe(200);
    const body = await res.json() as { tools: Array<unknown> };
    expect(body.tools.length).toBe(0);
  }, 60_000);

  it.skip("returns 404 for nonexistent tool detail", async () => {
    const { baseUrl, surreal } = getRuntime();
    const admin = await createTestUserWithMcp(baseUrl, surreal, `ws-notool-${crypto.randomUUID()}`);

    const res = await getToolDetail(baseUrl, admin, admin.workspaceId, "nonexistent-tool-id");

    expect(res.status).toBe(404);
  }, 60_000);

  it.skip("only returns tools belonging to the requested workspace", async () => {
    const { baseUrl, surreal } = getRuntime();
    const admin1 = await createTestUserWithMcp(baseUrl, surreal, `ws-iso1-${crypto.randomUUID()}`);
    const admin2 = await createTestUserWithMcp(baseUrl, surreal, `ws-iso2-${crypto.randomUUID()}`);

    // Given tools in workspace 1
    await seedTool(surreal, admin1.workspaceId, {
      name: "github.create_issue",
      toolkit: "github",
    });

    // And tools in workspace 2
    await seedTool(surreal, admin2.workspaceId, {
      name: "slack.post_message",
      toolkit: "slack",
    });

    // When admin1 lists tools in their workspace
    const res = await listTools(baseUrl, admin1, admin1.workspaceId);

    // Then only workspace 1 tools appear
    expect(res.status).toBe(200);
    const body = await res.json() as { tools: Array<{ name: string }> };
    expect(body.tools.length).toBe(1);
    expect(body.tools[0].name).toBe("github.create_issue");
  }, 60_000);
});
