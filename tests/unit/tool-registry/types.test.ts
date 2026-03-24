/**
 * Unit tests: Tool Registry Domain Types
 *
 * Verifies that all tool registry domain types compile and have the
 * expected structural shapes. These are compile-time safety tests --
 * if the types are wrong, the test file will not compile.
 */
import { describe, expect, it } from "bun:test";
import type { RecordId } from "surrealdb";
import type {
  ToolListItem,
  ToolDetail,
  GrantDetail,
  GovernancePolicyDetail,
  McpServerRecord,
  McpServerListItem,
  AddMcpServerInput,
  DiscoveryResult,
  ToolSyncDetail,
  CreateGrantInput,
  AttachGovernanceInput,
  ResolvedTool,
  ToolRiskLevel,
  ToolStatus,
  McpTransport,
  McpServerStatus,
  ToolSyncAction,
} from "../../../app/src/server/tool-registry/types";

describe("Tool Registry Domain Types", () => {
  it("ToolListItem has required fields for the tools tab", () => {
    // Compile-time verification: this object must satisfy ToolListItem
    const item: ToolListItem = {
      id: "tool-123",
      name: "github.create_issue",
      toolkit: "github",
      description: "Create a GitHub issue",
      risk_level: "medium",
      status: "active",
      grant_count: 3,
      governance_count: 1,
      created_at: "2026-01-01T00:00:00Z",
    };

    expect(item.name).toBe("github.create_issue");
    expect(item.toolkit).toBe("github");
    expect(item.grant_count).toBe(3);
  });

  it("ToolDetail extends ToolListItem with grants and governance", () => {
    const detail: ToolDetail = {
      id: "tool-123",
      name: "github.create_issue",
      toolkit: "github",
      description: "Create a GitHub issue",
      risk_level: "medium",
      status: "active",
      grant_count: 1,
      governance_count: 1,
      created_at: "2026-01-01T00:00:00Z",
      input_schema: { type: "object", properties: {} },
      grants: [{
        identity_id: "id-abc",
        identity_name: "Agent",
        max_calls_per_hour: 20,
        granted_at: "2026-01-01T00:00:00Z",
      }],
      governance_policies: [{
        policy_title: "Rate limit",
        policy_status: "active",
        conditions: "production only",
        max_per_call: 5,
        max_per_day: 100,
      }],
    };

    expect(detail.grants.length).toBe(1);
    expect(detail.governance_policies.length).toBe(1);
  });

  it("McpServerListItem has summary fields for server list", () => {
    const server: McpServerListItem = {
      id: "srv-123",
      name: "GitHub Tools",
      url: "https://mcp.example.com/github",
      transport: "streamable-http",
      last_status: "ok",
      tool_count: 5,
      created_at: "2026-01-01T00:00:00Z",
    };

    expect(server.name).toBe("GitHub Tools");
    expect(server.tool_count).toBe(5);
  });

  it("DiscoveryResult contains sync actions for discovered tools", () => {
    const result: DiscoveryResult = {
      server_id: "srv-123",
      tools: [
        {
          name: "github.create_issue",
          description: "Create issue",
          input_schema: { type: "object" },
          action: "create",
          risk_level: "medium",
        },
        {
          name: "github.list_repos",
          description: "List repos",
          input_schema: { type: "object" },
          action: "unchanged",
          risk_level: "low",
        },
      ],
    };

    expect(result.tools.length).toBe(2);
    expect(result.tools[0].action).toBe("create");
  });

  it("ResolvedTool includes optional source_server_id", () => {
    // Without source_server_id
    const toolWithout: ResolvedTool = {
      name: "github.create_issue",
      description: "Create issue",
      input_schema: { type: "object" },
      toolkit: "github",
      risk_level: "medium",
    };
    expect(toolWithout.source_server_id).toBeUndefined();

    // With source_server_id
    const toolWith: ResolvedTool = {
      name: "github.create_issue",
      description: "Create issue",
      input_schema: { type: "object" },
      toolkit: "github",
      risk_level: "medium",
      source_server_id: "srv-123",
    };
    expect(toolWith.source_server_id).toBe("srv-123");
  });

  it("CreateGrantInput and AttachGovernanceInput have expected shapes", () => {
    const grant: CreateGrantInput = {
      identity_id: "id-abc",
      max_calls_per_hour: 20,
    };
    expect(grant.identity_id).toBe("id-abc");

    const governance: AttachGovernanceInput = {
      policy_id: "policy-123",
      conditions: "production only",
      max_per_call: 5,
      max_per_day: 100,
    };
    expect(governance.policy_id).toBe("policy-123");
  });

  it("ToolRiskLevel and ToolStatus are constrained string unions", () => {
    const risks: ToolRiskLevel[] = ["low", "medium", "high", "critical"];
    expect(risks.length).toBe(4);

    const statuses: ToolStatus[] = ["active", "disabled"];
    expect(statuses.length).toBe(2);
  });

  it("ToolSyncAction covers all discovery outcomes", () => {
    const actions: ToolSyncAction[] = ["create", "update", "disable", "unchanged"];
    expect(actions.length).toBe(4);
  });
});
