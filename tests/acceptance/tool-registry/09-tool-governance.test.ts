/**
 * Acceptance Tests: Tool Governance (US-8)
 *
 * Walking skeleton phase 9: Policies are attachable to tools via governs_tool
 * relation edges. The proxy evaluates governance policies before executing
 * integration tool calls. Policy check happens BEFORE credential resolution.
 *
 * Traces: US-8, FR-10, AC-8
 * Driving port: POST /proxy/llm/anthropic/v1/messages (step 8.5 governance path)
 *
 * Implementation sequence:
 *   1. Walking skeleton: policy denies tool call with reason  [ENABLED]
 *   2. Policy denial writes trace with denial reason
 *   3. Policy with max_per_day limit enforced
 *   4. Tool with no governs_tool edge proceeds normally
 *   5. Multiple policies evaluated (most restrictive wins)
 *   6. Rate limit enforced via can_use.max_calls_per_hour
 *   7. Rate limited call writes trace with rate_limited outcome
 */
import { describe, expect, it } from "bun:test";
import { RecordId } from "surrealdb";
import {
  setupAcceptanceSuite,
  createTestUserWithMcp,
  seedFullIntegrationTool,
  seedToolPolicy,
  seedGovernsTool,
  seedToolWithGrant,
  seedCanUseEdge,
  seedMcpTool,
  getToolCallTraces,
  sendProxyRequestWithIdentity,
} from "./tool-registry-test-kit";

const getRuntime = setupAcceptanceSuite("tool_registry_governance");

// ---------------------------------------------------------------------------
// Walking Skeleton: Policy denies tool call
// ---------------------------------------------------------------------------
describe("Walking Skeleton: Policy denies tool call with reason", () => {
  it("returns 'Tool call denied by policy' when governs_tool has requires_human_approval", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUserWithMcp(baseUrl, surreal, `ws-gov-${crypto.randomUUID()}`);

    // Given identity has can_use edge to "github.merge_pr"
    const providerId = `prov-gov-${crypto.randomUUID()}`;
    const toolId = `tool-gov-${crypto.randomUUID()}`;
    await seedFullIntegrationTool(surreal, {
      providerId,
      providerName: "github",
      authMethod: "oauth2",
      toolId,
      toolName: "github.merge_pr",
      toolkit: "github",
      description: "Merge a pull request",
      inputSchema: { type: "object", properties: { pr_number: { type: "number" }, repo: { type: "string" } } },
      identityId: user.identityId,
      workspaceId: user.workspaceId,
      accountId: `acct-gov-${crypto.randomUUID()}`,
      accessTokenEncrypted: "encrypted:token",
      tokenExpiresAt: new Date(Date.now() + 3600 * 1000),
    });

    // And policy "no-auto-merge" governs "github.merge_pr" with condition "requires_human_approval"
    const policyId = `pol-gov-${crypto.randomUUID()}`;
    await seedToolPolicy(surreal, policyId, {
      title: "no-auto-merge",
      workspaceId: user.workspaceId,
      identityId: user.identityId,
    });
    await seedGovernsTool(surreal, policyId, toolId, {
      conditions: "requires_human_approval",
    });

    // When the proxy intercepts tool_call for "github.merge_pr"
    // Simulate by calling executeIntegrationTools directly with a classified call
    const { executeIntegrationTools } = await import(
      "../../../app/src/server/proxy/tool-executor"
    );

    const classifiedCalls = [
      {
        classification: "integration" as const,
        toolUse: {
          type: "tool_use" as const,
          id: "toolu_test_gov",
          name: "github.merge_pr",
          input: { pr_number: 42, repo: "test/repo" },
        },
        resolvedTool: {
          name: "github.merge_pr",
          toolkit: "github",
          description: "Merge a pull request",
          inputSchema: { type: "object", properties: {} },
        },
      },
    ];

    const results = await executeIntegrationTools(classifiedCalls, {
      surreal,
      workspaceId: user.workspaceId,
      identityId: user.identityId,
      toolEncryptionKey: "test-encryption-key-32chars!!!!!",
    });

    // Then the proxy returns error: "Tool call denied by policy"
    expect(results.length).toBe(1);
    expect(results[0].isError).toBe(true);
    expect(results[0].content).toContain("Tool call denied by policy");

    // And governance check runs BEFORE credential resolution
    // (verified: denial message does NOT mention credential resolution)
    expect(results[0].content).not.toContain("Credential resolution");
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Focused Scenarios
// ---------------------------------------------------------------------------
describe("Policy denial writes trace with denial reason", () => {
  it.skip("creates a trace with outcome:denied and the policy denial reason", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUserWithMcp(baseUrl, surreal, `ws-deny-${crypto.randomUUID()}`);

    // Given a policy-denied tool call
    const toolId = `tool-deny-${crypto.randomUUID()}`;
    const policyId = `pol-deny-${crypto.randomUUID()}`;
    await seedMcpTool(surreal, toolId, {
      name: "github.merge_pr",
      toolkit: "github",
      description: "Merge PR",
      inputSchema: { type: "object", properties: {} },
      riskLevel: "high",
      workspaceId: user.workspaceId,
    });
    await seedCanUseEdge(surreal, user.identityId, toolId);
    await seedToolPolicy(surreal, policyId, {
      title: "no-auto-merge",
      workspaceId: user.workspaceId,
    });
    await seedGovernsTool(surreal, policyId, toolId, {
      conditions: "requires_human_approval",
    });

    // When the proxy denies the tool call
    // Then a trace record is written with:
    //   outcome: "denied"
    //   denial reason referencing the policy

    // Verify the governance relationship is in place
    const results = await surreal.query(
      `SELECT in AS policy_id, conditions FROM governs_tool WHERE out = $tool;`,
      { tool: new RecordId("mcp_tool", toolId) },
    );
    const edges = (results[0] ?? []) as Array<{ conditions?: string }>;
    expect(edges.length).toBe(1);
  }, 30_000);
});

describe("Policy with max_per_day limit enforced", () => {
  it.skip("denies tool call when daily usage exceeds governs_tool.max_per_day", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUserWithMcp(baseUrl, surreal, `ws-daily-${crypto.randomUUID()}`);

    // Given governs_tool with max_per_day=5
    const toolId = `tool-daily-${crypto.randomUUID()}`;
    const policyId = `pol-daily-${crypto.randomUUID()}`;
    await seedMcpTool(surreal, toolId, {
      name: "github.create_issue",
      toolkit: "github",
      description: "Create issue",
      inputSchema: { type: "object", properties: {} },
      workspaceId: user.workspaceId,
    });
    await seedCanUseEdge(surreal, user.identityId, toolId);
    await seedToolPolicy(surreal, policyId, {
      title: "issue-rate-limit",
      workspaceId: user.workspaceId,
    });
    await seedGovernsTool(surreal, policyId, toolId, {
      maxPerDay: 5,
    });

    // When the identity has already made 5 calls today
    // Then the 6th call is denied with daily limit exceeded message

    const results = await surreal.query(
      `SELECT max_per_day FROM governs_tool WHERE out = $tool;`,
      { tool: new RecordId("mcp_tool", toolId) },
    );
    const edges = (results[0] ?? []) as Array<{ max_per_day?: number }>;
    expect(edges[0].max_per_day).toBe(5);
  }, 30_000);
});

describe("Tool with no governs_tool edge proceeds normally", () => {
  it.skip("executes tool call without governance check when no policy is attached", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUserWithMcp(baseUrl, surreal, `ws-nopol-${crypto.randomUUID()}`);

    // Given a tool with no governs_tool edges
    const toolId = `tool-nopol-${crypto.randomUUID()}`;
    await seedMcpTool(surreal, toolId, {
      name: "github.list_repos",
      toolkit: "github",
      description: "List repos",
      inputSchema: { type: "object", properties: {} },
      riskLevel: "low",
      workspaceId: user.workspaceId,
    });
    await seedCanUseEdge(surreal, user.identityId, toolId);

    // When the proxy intercepts a tool call for this tool
    // Then no governance check fails
    // And execution proceeds normally
    const results = await surreal.query(
      `SELECT * FROM governs_tool WHERE out = $tool;`,
      { tool: new RecordId("mcp_tool", toolId) },
    );
    const edges = (results[0] ?? []) as Array<Record<string, unknown>>;
    expect(edges.length).toBe(0);
  }, 30_000);
});

describe("Rate limit enforced via can_use.max_calls_per_hour", () => {
  it.skip("denies the 11th call when can_use has max_calls_per_hour=10", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUserWithMcp(baseUrl, surreal, `ws-rate-${crypto.randomUUID()}`);

    // Given can_use edge with max_calls_per_hour=10
    const toolId = `tool-rate-${crypto.randomUUID()}`;
    await seedMcpTool(surreal, toolId, {
      name: "github.create_issue",
      toolkit: "github",
      description: "Create issue",
      inputSchema: { type: "object", properties: {} },
      workspaceId: user.workspaceId,
    });
    await seedCanUseEdge(surreal, user.identityId, toolId, { maxCallsPerHour: 10 });

    // When agent has made 10 calls in the current hour
    // Then the 11th call returns rate limit error with reset time

    // Verify the rate limit is persisted
    const results = await surreal.query(
      `SELECT max_calls_per_hour FROM can_use WHERE in = $identity AND out = $tool;`,
      {
        identity: new RecordId("identity", user.identityId),
        tool: new RecordId("mcp_tool", toolId),
      },
    );
    const edges = (results[0] ?? []) as Array<{ max_calls_per_hour?: number }>;
    expect(edges[0].max_calls_per_hour).toBe(10);
  }, 30_000);
});

describe("Rate limited call writes trace with rate_limited outcome", () => {
  it.skip("creates trace with outcome:rate_limited when call exceeds hourly limit", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUserWithMcp(baseUrl, surreal, `ws-rltrace-${crypto.randomUUID()}`);

    // Given a rate-limited tool call
    // When the proxy denies due to rate limit
    // Then a trace record is written with outcome: "rate_limited"
    const toolId = `tool-rltrace-${crypto.randomUUID()}`;
    await seedMcpTool(surreal, toolId, {
      name: "github.create_issue",
      toolkit: "github",
      description: "Create issue",
      inputSchema: { type: "object", properties: {} },
      workspaceId: user.workspaceId,
    });
    await seedCanUseEdge(surreal, user.identityId, toolId, { maxCallsPerHour: 1 });

    // Rate limit is persisted - trace will record rate_limited when enforced
    const results = await surreal.query(
      `SELECT max_calls_per_hour FROM can_use WHERE in = $identity AND out = $tool;`,
      {
        identity: new RecordId("identity", user.identityId),
        tool: new RecordId("mcp_tool", toolId),
      },
    );
    const edges = (results[0] ?? []) as Array<{ max_calls_per_hour?: number }>;
    expect(edges[0].max_calls_per_hour).toBe(1);
  }, 30_000);
});
