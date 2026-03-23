import { describe, it, expect } from "bun:test";

/**
 * Tests for the DiscoveryReviewPanel: view model derivation for discovery
 * results, selective import, and risk level override.
 *
 * All tests exercise pure view-model derivation functions -- no DOM rendering.
 *
 * Behaviors under test:
 *   1. Panel renders discovery results with per-tool rows and action badges
 *   2. New and updated tools pre-selected; unchanged tools not selected
 *   3. Risk level override per tool
 *   4. Import selection derives selected_tools for sync API
 *   5. Schema diff available for updated tools
 *   6. Summary counts derived from discovery result
 */

import type { ToolSyncAction } from "../../../../app/src/server/tool-registry/types";
import type { ToolRiskLevel } from "../../../../app/src/server/tool-registry/types";

import {
  deriveDiscoveryPanelViewModel,
  deriveToolRowViewModel,
  deriveDefaultSelections,
  applyRiskOverride,
  deriveImportPayload,
  deriveActionBadge,
  deriveSummaryCounts,
  type DiscoveryPanelInput,
  type DiscoveryToolRow,
  type ActionBadge,
} from "../../../../app/src/client/components/tool-registry/DiscoveryReviewPanel";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

type ToolSyncDetailFixture = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  output_schema?: Record<string, unknown>;
  action: ToolSyncAction;
  risk_level: ToolRiskLevel;
};

function makeTool(overrides?: Partial<ToolSyncDetailFixture>): ToolSyncDetailFixture {
  return {
    name: "read_file",
    description: "Read a file from disk",
    input_schema: { type: "object", properties: { path: { type: "string" } } },
    action: "create" as ToolSyncAction,
    risk_level: "low" as ToolRiskLevel,
    ...overrides,
  };
}

function makeDiscoveryInput(
  overrides?: Partial<DiscoveryPanelInput>,
): DiscoveryPanelInput {
  return {
    serverId: "srv-1",
    tools: [
      makeTool({ name: "read_file", action: "create", risk_level: "low" }),
      makeTool({ name: "write_file", action: "update", risk_level: "high", description: "Write content to file" }),
      makeTool({ name: "list_dir", action: "unchanged", risk_level: "low", description: "List directory" }),
      makeTool({ name: "delete_file", action: "disable", risk_level: "critical", description: "Delete a file" }),
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Action badges use correct color coding
// ---------------------------------------------------------------------------

describe("deriveActionBadge", () => {
  it("returns green badge for create action", () => {
    const badge = deriveActionBadge("create");
    expect(badge.color).toBe("green");
    expect(badge.label).toBe("New");
  });

  it("returns amber badge for update action", () => {
    const badge = deriveActionBadge("update");
    expect(badge.color).toBe("amber");
    expect(badge.label).toBe("Updated");
  });

  it("returns red badge for disable action", () => {
    const badge = deriveActionBadge("disable");
    expect(badge.color).toBe("red");
    expect(badge.label).toBe("Disabled");
  });

  it("returns muted badge for unchanged action", () => {
    const badge = deriveActionBadge("unchanged");
    expect(badge.color).toBe("muted");
    expect(badge.label).toBe("Unchanged");
  });
});

// ---------------------------------------------------------------------------
// 2. New and updated tools pre-selected; unchanged not selected
// ---------------------------------------------------------------------------

describe("deriveDefaultSelections", () => {
  it("pre-selects new and updated tools, not unchanged or disable", () => {
    const input = makeDiscoveryInput();
    const selections = deriveDefaultSelections(input.tools);

    expect(selections.has("read_file")).toBe(true);    // create
    expect(selections.has("write_file")).toBe(true);   // update
    expect(selections.has("list_dir")).toBe(false);    // unchanged
    expect(selections.has("delete_file")).toBe(false); // disable
  });

  it("returns empty set when all tools are unchanged", () => {
    const tools = [
      makeTool({ name: "a", action: "unchanged" }),
      makeTool({ name: "b", action: "unchanged" }),
    ];
    const selections = deriveDefaultSelections(tools);
    expect(selections.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 3. Risk level override per tool
// ---------------------------------------------------------------------------

describe("applyRiskOverride", () => {
  it("overrides risk level for a specific tool", () => {
    const tools: DiscoveryToolRow[] = [
      deriveToolRowViewModel(makeTool({ name: "read_file", risk_level: "low" })),
      deriveToolRowViewModel(makeTool({ name: "write_file", risk_level: "medium" })),
    ];

    const updated = applyRiskOverride(tools, "read_file", "high");

    expect(updated.find((t) => t.name === "read_file")!.riskLevel).toBe("high");
    expect(updated.find((t) => t.name === "write_file")!.riskLevel).toBe("medium");
  });

  it("does not mutate the original array", () => {
    const tools: DiscoveryToolRow[] = [
      deriveToolRowViewModel(makeTool({ name: "read_file", risk_level: "low" })),
    ];
    const original = tools[0].riskLevel;

    applyRiskOverride(tools, "read_file", "critical");

    expect(tools[0].riskLevel).toBe(original);
  });
});

// ---------------------------------------------------------------------------
// 4. Import selection derives selected_tools for sync API
// ---------------------------------------------------------------------------

describe("deriveImportPayload", () => {
  it("returns selected tool names and risk overrides", () => {
    const rows: DiscoveryToolRow[] = [
      deriveToolRowViewModel(makeTool({ name: "read_file", risk_level: "low" })),
      deriveToolRowViewModel(makeTool({ name: "write_file", risk_level: "high" })),
      deriveToolRowViewModel(makeTool({ name: "list_dir", risk_level: "low" })),
    ];
    // Override write_file risk to critical
    const overriddenRows = applyRiskOverride(rows, "write_file", "critical");
    const selected = new Set(["read_file", "write_file"]);

    const payload = deriveImportPayload("srv-1", overriddenRows, selected);

    expect(payload.serverId).toBe("srv-1");
    expect(payload.selectedTools).toEqual(["read_file", "write_file"]);
    expect(payload.riskOverrides).toEqual({ write_file: "critical" });
  });

  it("returns empty arrays when nothing selected", () => {
    const rows: DiscoveryToolRow[] = [
      deriveToolRowViewModel(makeTool({ name: "read_file" })),
    ];
    const selected = new Set<string>();

    const payload = deriveImportPayload("srv-1", rows, selected);

    expect(payload.selectedTools).toEqual([]);
    expect(payload.riskOverrides).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// 5. Schema diff available for updated tools
// ---------------------------------------------------------------------------

describe("deriveToolRowViewModel", () => {
  it("marks updated tools as having schema diff available", () => {
    const row = deriveToolRowViewModel(makeTool({ action: "update" }));
    expect(row.hasSchemaDiff).toBe(true);
  });

  it("marks non-updated tools as not having schema diff", () => {
    const createRow = deriveToolRowViewModel(makeTool({ action: "create" }));
    expect(createRow.hasSchemaDiff).toBe(false);

    const unchangedRow = deriveToolRowViewModel(makeTool({ action: "unchanged" }));
    expect(unchangedRow.hasSchemaDiff).toBe(false);
  });

  it("includes tool name, description, action badge, and risk level", () => {
    const row = deriveToolRowViewModel(
      makeTool({ name: "my_tool", description: "Does things", action: "create", risk_level: "medium" }),
    );
    expect(row.name).toBe("my_tool");
    expect(row.description).toBe("Does things");
    expect(row.actionBadge.color).toBe("green");
    expect(row.riskLevel).toBe("medium");
  });
});

// ---------------------------------------------------------------------------
// 6. Summary counts
// ---------------------------------------------------------------------------

describe("deriveSummaryCounts", () => {
  it("counts tools by action type", () => {
    const input = makeDiscoveryInput();
    const counts = deriveSummaryCounts(input.tools);

    expect(counts.create).toBe(1);
    expect(counts.update).toBe(1);
    expect(counts.unchanged).toBe(1);
    expect(counts.disable).toBe(1);
    expect(counts.total).toBe(4);
  });

  it("returns zero counts for empty tool list", () => {
    const counts = deriveSummaryCounts([]);
    expect(counts.total).toBe(0);
    expect(counts.create).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 7. Panel view model
// ---------------------------------------------------------------------------

describe("deriveDiscoveryPanelViewModel", () => {
  it("derives complete panel state from discovery input", () => {
    const input = makeDiscoveryInput();
    const vm = deriveDiscoveryPanelViewModel(input);

    expect(vm.rows).toHaveLength(4);
    expect(vm.summaryCounts.total).toBe(4);
    expect(vm.defaultSelections.has("read_file")).toBe(true);
    expect(vm.defaultSelections.has("list_dir")).toBe(false);
    expect(vm.serverId).toBe("srv-1");
  });

  it("separates unchanged tools for collapsed display", () => {
    const input = makeDiscoveryInput();
    const vm = deriveDiscoveryPanelViewModel(input);

    const actionableRows = vm.rows.filter((r) => r.actionBadge.color !== "muted");
    const unchangedRows = vm.rows.filter((r) => r.actionBadge.color === "muted");

    expect(actionableRows.length).toBe(3);
    expect(unchangedRows.length).toBe(1);
  });
});
