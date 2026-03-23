/**
 * Milestone 6: Tool Governance
 *
 * Traces: US-UI-08 (tool governance)
 *
 * Tests the governance attachment endpoints that power the governance
 * dialog and governance indicators in the Tools tab. Covers policy
 * attachment with conditions and rate limits, governance detail in
 * tool view, and active-only policy filtering.
 *
 * Driving ports:
 *   POST /api/workspaces/:wsId/tools/:toolId/governance   (attach policy)
 *   GET  /api/workspaces/:wsId/tools/:toolId               (view governance)
 *   GET  /api/workspaces/:wsId/tools                        (governance indicator)
 */
import { describe, expect, it } from "bun:test";
import {
  setupToolRegistrySuite,
  createTestUserWithMcp,
  attachGovernance,
  getToolDetail,
  listTools,
  seedTool,
  seedPolicy,
  seedGovernance,
} from "./tool-registry-ui-test-kit";

const getRuntime = setupToolRegistrySuite("tool_registry_ui_tool_governance");

// ---------------------------------------------------------------------------
// Happy Path: Governance Attachment
// ---------------------------------------------------------------------------
describe("Admin attaches governance policy to tool", () => {
  it("attaches policy with condition and rate limits", async () => {
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

    // When admin attaches governance with condition and rate limit
    const res = await attachGovernance(baseUrl, admin, admin.workspaceId, toolId, {
      policy_id: policyId,
      conditions: "requires_human_approval",
      max_per_day: 5,
    });

    // Then the governance attachment succeeds
    expect(res.status).toBe(201);

    // And the tool detail shows the attached governance
    const detailRes = await getToolDetail(baseUrl, admin, admin.workspaceId, toolId);
    const detail = await detailRes.json() as {
      governance_policies: Array<{
        policy_title: string;
        conditions?: string;
        max_per_day?: number;
      }>;
    };
    expect(detail.governance_policies.length).toBe(1);
    expect(detail.governance_policies[0].policy_title).toBe("no-auto-merge");
    expect(detail.governance_policies[0].conditions).toBe("requires_human_approval");
    expect(detail.governance_policies[0].max_per_day).toBe(5);
  }, 60_000);

  it.skip("attaches policy with rate limit only (no condition)", async () => {
    const { baseUrl, surreal } = getRuntime();
    const admin = await createTestUserWithMcp(baseUrl, surreal, `ws-rateonly-${crypto.randomUUID()}`);

    const { toolId } = await seedTool(surreal, admin.workspaceId, {
      name: "slack.post_message",
      toolkit: "slack",
      riskLevel: "medium",
    });

    const { policyId } = await seedPolicy(surreal, admin.workspaceId, {
      title: "rate-limiter",
    });

    const res = await attachGovernance(baseUrl, admin, admin.workspaceId, toolId, {
      policy_id: policyId,
      max_per_day: 100,
      max_per_call: 10,
    });

    expect(res.status).toBe(201);

    const detailRes = await getToolDetail(baseUrl, admin, admin.workspaceId, toolId);
    const detail = await detailRes.json() as {
      governance_policies: Array<{
        max_per_day?: number;
        max_per_call?: number;
      }>;
    };
    expect(detail.governance_policies[0].max_per_day).toBe(100);
    expect(detail.governance_policies[0].max_per_call).toBe(10);
  }, 60_000);

  it.skip("multiple policies can be attached to same tool", async () => {
    const { baseUrl, surreal } = getRuntime();
    const admin = await createTestUserWithMcp(baseUrl, surreal, `ws-multi-${crypto.randomUUID()}`);

    const { toolId } = await seedTool(surreal, admin.workspaceId, {
      name: "github.merge_pr",
      toolkit: "github",
      riskLevel: "high",
    });

    const { policyId: p1 } = await seedPolicy(surreal, admin.workspaceId, {
      title: "no-auto-merge",
    });
    const { policyId: p2 } = await seedPolicy(surreal, admin.workspaceId, {
      title: "rate-limiter",
    });

    await attachGovernance(baseUrl, admin, admin.workspaceId, toolId, {
      policy_id: p1,
      conditions: "requires_human_approval",
    });
    await attachGovernance(baseUrl, admin, admin.workspaceId, toolId, {
      policy_id: p2,
      max_per_day: 10,
    });

    const detailRes = await getToolDetail(baseUrl, admin, admin.workspaceId, toolId);
    const detail = await detailRes.json() as {
      governance_policies: Array<{ policy_title: string }>;
    };
    expect(detail.governance_policies.length).toBe(2);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Governance Indicator in Tools List
// ---------------------------------------------------------------------------
describe("Governance indicator visible in tools list", () => {
  it.skip("tools with governance show non-zero governance_count", async () => {
    const { baseUrl, surreal } = getRuntime();
    const admin = await createTestUserWithMcp(baseUrl, surreal, `ws-indicator-${crypto.randomUUID()}`);

    // Given one tool with governance and one without
    const { toolId: governedToolId } = await seedTool(surreal, admin.workspaceId, {
      name: "github.merge_pr",
      toolkit: "github",
      riskLevel: "high",
    });

    await seedTool(surreal, admin.workspaceId, {
      name: "slack.post_message",
      toolkit: "slack",
      riskLevel: "low",
    });

    const { policyId } = await seedPolicy(surreal, admin.workspaceId, {
      title: "no-auto-merge",
    });
    await seedGovernance(surreal, policyId, governedToolId);

    // When admin lists tools
    const res = await listTools(baseUrl, admin, admin.workspaceId);
    const body = await res.json() as { tools: Array<{
      name: string;
      governance_count: number;
    }> };

    // Then the governed tool has governance_count > 0
    const governed = body.tools.find((t) => t.name === "github.merge_pr");
    expect(governed).toBeDefined();
    expect(governed!.governance_count).toBeGreaterThan(0);

    // And the ungoverned tool has governance_count = 0
    const ungoverned = body.tools.find((t) => t.name === "slack.post_message");
    expect(ungoverned).toBeDefined();
    expect(ungoverned!.governance_count).toBe(0);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Error Paths
// ---------------------------------------------------------------------------
describe("Governance attachment validates input", () => {
  it.skip("rejects attachment of nonexistent policy", async () => {
    const { baseUrl, surreal } = getRuntime();
    const admin = await createTestUserWithMcp(baseUrl, surreal, `ws-nopol-${crypto.randomUUID()}`);

    const { toolId } = await seedTool(surreal, admin.workspaceId, {
      name: "github.create_issue",
      toolkit: "github",
    });

    const res = await attachGovernance(baseUrl, admin, admin.workspaceId, toolId, {
      policy_id: "nonexistent-policy-id",
    });

    expect(res.status).toBe(404);
  }, 60_000);

  it.skip("rejects attachment to nonexistent tool", async () => {
    const { baseUrl, surreal } = getRuntime();
    const admin = await createTestUserWithMcp(baseUrl, surreal, `ws-notool-${crypto.randomUUID()}`);

    const { policyId } = await seedPolicy(surreal, admin.workspaceId, {
      title: "test-policy",
    });

    const res = await attachGovernance(baseUrl, admin, admin.workspaceId, "nonexistent-tool", {
      policy_id: policyId,
    });

    expect(res.status).toBe(404);
  }, 60_000);

  it.skip("rejects attachment of deprecated policy", async () => {
    const { baseUrl, surreal } = getRuntime();
    const admin = await createTestUserWithMcp(baseUrl, surreal, `ws-depol-${crypto.randomUUID()}`);

    const { toolId } = await seedTool(surreal, admin.workspaceId, {
      name: "github.create_issue",
      toolkit: "github",
    });

    const { policyId } = await seedPolicy(surreal, admin.workspaceId, {
      title: "old-policy",
      status: "deprecated",
    });

    // When admin tries to attach a deprecated policy
    const res = await attachGovernance(baseUrl, admin, admin.workspaceId, toolId, {
      policy_id: policyId,
    });

    // Then the attachment is rejected (only active policies allowed)
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("active");
  }, 60_000);

  it.skip("rejects attachment without policy_id", async () => {
    const { baseUrl, surreal } = getRuntime();
    const admin = await createTestUserWithMcp(baseUrl, surreal, `ws-nopolid-${crypto.randomUUID()}`);

    const { toolId } = await seedTool(surreal, admin.workspaceId, {
      name: "github.create_issue",
      toolkit: "github",
    });

    const res = await attachGovernance(baseUrl, admin, admin.workspaceId, toolId, {
      policy_id: "",
    });

    expect(res.status).toBe(400);
  }, 60_000);
});
