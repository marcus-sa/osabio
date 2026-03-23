/**
 * Unit tests for the discovery service pure functions.
 *
 * Tests:
 *   - inferRiskLevel: MCP annotations -> risk level mapping
 *   - computeSyncActions: diff remote vs existing tools -> sync actions
 *   - filterBySelection: optional tool name filter
 */
import { describe, expect, it } from "bun:test";
import {
  inferRiskLevel,
  computeSyncActions,
  filterBySelection,
  type RemoteTool,
  type ExistingToolRecord,
} from "../../../app/src/server/tool-registry/discovery";

// ---------------------------------------------------------------------------
// inferRiskLevel
// ---------------------------------------------------------------------------

describe("inferRiskLevel", () => {
  it("returns low when readOnlyHint is true", () => {
    expect(inferRiskLevel({ readOnlyHint: true })).toBe("low");
  });

  it("returns high when destructiveHint is true", () => {
    expect(inferRiskLevel({ destructiveHint: true })).toBe("high");
  });

  it("returns low when idempotentHint is true and no destructiveHint", () => {
    expect(inferRiskLevel({ idempotentHint: true })).toBe("low");
  });

  it("returns high when both destructiveHint and idempotentHint are true", () => {
    expect(
      inferRiskLevel({ destructiveHint: true, idempotentHint: true }),
    ).toBe("high");
  });

  it("returns medium when no annotations provided", () => {
    expect(inferRiskLevel(undefined)).toBe("medium");
  });

  it("returns medium when annotations are empty object", () => {
    expect(inferRiskLevel({})).toBe("medium");
  });

  it("returns medium when annotations have unknown hints only", () => {
    expect(inferRiskLevel({ openWorldHint: true } as Record<string, unknown>)).toBe("medium");
  });
});

// ---------------------------------------------------------------------------
// computeSyncActions
// ---------------------------------------------------------------------------

describe("computeSyncActions", () => {
  const makeRemoteTool = (overrides?: Partial<RemoteTool>): RemoteTool => ({
    name: "github.create_issue",
    description: "Create a GitHub issue",
    inputSchema: { type: "object", properties: {} },
    annotations: undefined,
    ...overrides,
  });

  const makeExistingTool = (
    overrides?: Partial<ExistingToolRecord>,
  ): ExistingToolRecord => ({
    name: "github.create_issue",
    description: "Create a GitHub issue",
    input_schema: { type: "object", properties: {} },
    risk_level: "medium",
    status: "active",
    ...overrides,
  });

  it("marks remote-only tools as create", () => {
    const remoteTools = [makeRemoteTool({ name: "github.list_repos" })];
    const existingTools: ExistingToolRecord[] = [];

    const result = computeSyncActions(remoteTools, existingTools);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("github.list_repos");
    expect(result[0].action).toBe("create");
  });

  it("marks identical tools as unchanged", () => {
    const remoteTools = [makeRemoteTool()];
    const existingTools = [makeExistingTool()];

    const result = computeSyncActions(remoteTools, existingTools);

    expect(result).toHaveLength(1);
    expect(result[0].action).toBe("unchanged");
  });

  it("marks tools with different description as update", () => {
    const remoteTools = [
      makeRemoteTool({ description: "Create a GitHub issue (v2)" }),
    ];
    const existingTools = [makeExistingTool()];

    const result = computeSyncActions(remoteTools, existingTools);

    expect(result).toHaveLength(1);
    expect(result[0].action).toBe("update");
  });

  it("marks tools with different input_schema as update", () => {
    const remoteTools = [
      makeRemoteTool({
        inputSchema: { type: "object", properties: { title: { type: "string" } } },
      }),
    ];
    const existingTools = [makeExistingTool()];

    const result = computeSyncActions(remoteTools, existingTools);

    expect(result).toHaveLength(1);
    expect(result[0].action).toBe("update");
  });

  it("marks local-only tools as disable", () => {
    const remoteTools: RemoteTool[] = [];
    const existingTools = [makeExistingTool({ name: "github.legacy_search" })];

    const result = computeSyncActions(remoteTools, existingTools);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("github.legacy_search");
    expect(result[0].action).toBe("disable");
  });

  it("handles mix of create, update, unchanged, and disable", () => {
    const remoteTools = [
      makeRemoteTool({ name: "tool.new" }),
      makeRemoteTool({ name: "tool.same", description: "Same desc" }),
      makeRemoteTool({ name: "tool.changed", description: "Changed desc" }),
    ];
    const existingTools = [
      makeExistingTool({ name: "tool.same", description: "Same desc" }),
      makeExistingTool({ name: "tool.changed", description: "Old desc" }),
      makeExistingTool({ name: "tool.removed" }),
    ];

    const result = computeSyncActions(remoteTools, existingTools);

    const byName = new Map(result.map((t) => [t.name, t]));
    expect(byName.get("tool.new")!.action).toBe("create");
    expect(byName.get("tool.same")!.action).toBe("unchanged");
    expect(byName.get("tool.changed")!.action).toBe("update");
    expect(byName.get("tool.removed")!.action).toBe("disable");
  });

  it("infers risk level for each tool from annotations", () => {
    const remoteTools = [
      makeRemoteTool({
        name: "tool.readonly",
        annotations: { readOnlyHint: true },
      }),
      makeRemoteTool({
        name: "tool.destructive",
        annotations: { destructiveHint: true },
      }),
      makeRemoteTool({ name: "tool.default" }),
    ];

    const result = computeSyncActions(remoteTools, []);

    const byName = new Map(result.map((t) => [t.name, t]));
    expect(byName.get("tool.readonly")!.risk_level).toBe("low");
    expect(byName.get("tool.destructive")!.risk_level).toBe("high");
    expect(byName.get("tool.default")!.risk_level).toBe("medium");
  });

  it("skips already-disabled local tools from disable list", () => {
    const remoteTools: RemoteTool[] = [];
    const existingTools = [
      makeExistingTool({ name: "tool.already_disabled", status: "disabled" }),
    ];

    const result = computeSyncActions(remoteTools, existingTools);

    // Already disabled tools should not appear as "disable" action
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// filterBySelection
// ---------------------------------------------------------------------------

describe("filterBySelection", () => {
  const tools = [
    {
      name: "github.create_issue",
      description: "Create issue",
      input_schema: {},
      action: "create" as const,
      risk_level: "medium" as const,
    },
    {
      name: "github.list_repos",
      description: "List repos",
      input_schema: {},
      action: "create" as const,
      risk_level: "low" as const,
    },
    {
      name: "github.delete_repo",
      description: "Delete repo",
      input_schema: {},
      action: "create" as const,
      risk_level: "high" as const,
    },
  ];

  it("returns all tools when no selection provided", () => {
    const result = filterBySelection(tools, undefined);
    expect(result).toHaveLength(3);
  });

  it("returns all tools when selection is empty array", () => {
    const result = filterBySelection(tools, []);
    expect(result).toHaveLength(3);
  });

  it("filters to only selected tool names", () => {
    const result = filterBySelection(tools, [
      "github.create_issue",
      "github.list_repos",
    ]);

    expect(result).toHaveLength(2);
    expect(result.map((t) => t.name)).toContain("github.create_issue");
    expect(result.map((t) => t.name)).toContain("github.list_repos");
    expect(result.map((t) => t.name)).not.toContain("github.delete_repo");
  });

  it("returns empty array when no tools match selection", () => {
    const result = filterBySelection(tools, ["nonexistent.tool"]);
    expect(result).toHaveLength(0);
  });
});
