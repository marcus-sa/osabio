import { describe, it, expect } from "bun:test";

/**
 * Tests for the Tools tab: ToolTable view model functions.
 *
 * All tests exercise pure view-model derivation functions -- no DOM rendering.
 * The component is a thin renderer of these view models.
 *
 * Behaviors under test:
 *   1. Tool grouping: groups tools by toolkit with correct counts
 *   2. Risk badge: maps risk_level to correct color variant
 *   3. Status badge: distinguishes active/disabled
 *   4. Provenance badge: shows 'manual' or server name
 *   5. Filtering: narrows results by status and risk_level
 *   6. Text search: filters by name and description
 *   7. Empty search: shows message when no tools match
 *   8. Governed tools: governance_count > 0 shows governed indicator
 *   9. Description truncation: long descriptions are truncated
 */

import type { ToolListItem } from "../../../../app/src/client/hooks/use-tools";

import {
  deriveToolTableViewModel,
  deriveRiskBadge,
  deriveStatusBadge,
  deriveProvenanceBadge,
  filterTools,
  groupToolsByToolkit,
  type ToolTableInput,
  type ToolTableFilters,
} from "../../../../app/src/client/components/tool-registry/ToolTable";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeTool(overrides?: Partial<ToolListItem>): ToolListItem {
  return {
    id: "tool-1",
    name: "test-tool",
    toolkit: "default",
    description: "A test tool for testing",
    risk_level: "low",
    status: "active",
    grant_count: 0,
    governance_count: 0,
    provider_name: "manual",
    created_at: "2026-01-15T10:00:00Z",
    ...overrides,
  };
}

function makeFilters(overrides?: Partial<ToolTableFilters>): ToolTableFilters {
  return {
    searchText: "",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tool grouping
// ---------------------------------------------------------------------------

describe("ToolTable view model", () => {
  describe("groups tools by toolkit with correct counts", () => {
    it("groups tools by toolkit field with group headers showing tool count", () => {
      const tools = [
        makeTool({ id: "1", name: "read", toolkit: "filesystem" }),
        makeTool({ id: "2", name: "write", toolkit: "filesystem" }),
        makeTool({ id: "3", name: "query", toolkit: "database" }),
      ];

      const groups = groupToolsByToolkit(tools);

      expect(groups).toHaveLength(2);
      const fsGroup = groups.find((g) => g.toolkit === "filesystem");
      const dbGroup = groups.find((g) => g.toolkit === "database");
      expect(fsGroup?.toolCount).toBe(2);
      expect(fsGroup?.rows).toHaveLength(2);
      expect(dbGroup?.toolCount).toBe(1);
      expect(dbGroup?.rows).toHaveLength(1);
    });

    it("returns empty groups array when no tools provided", () => {
      const vm = deriveToolTableViewModel({ tools: [], filters: makeFilters() });

      expect(vm.groups).toHaveLength(0);
      expect(vm.showEmptyState).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// Risk badge
// ---------------------------------------------------------------------------

describe("deriveRiskBadge", () => {
  it("returns green variant for low risk", () => {
    const badge = deriveRiskBadge("low");
    expect(badge.label).toBe("Low");
    expect(badge.className).toContain("green");
  });

  it("returns amber variant for medium risk", () => {
    const badge = deriveRiskBadge("medium");
    expect(badge.label).toBe("Medium");
    expect(badge.className).toContain("amber");
  });

  it("returns red variant for high risk", () => {
    const badge = deriveRiskBadge("high");
    expect(badge.label).toBe("High");
    expect(badge.className).toContain("red");
  });

  it("returns destructive variant for critical risk", () => {
    const badge = deriveRiskBadge("critical");
    expect(badge.label).toBe("Critical");
    expect(badge.variant).toBe("destructive");
  });
});

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

describe("deriveStatusBadge", () => {
  it("returns default variant for active status", () => {
    const badge = deriveStatusBadge("active");
    expect(badge.label).toBe("Active");
    expect(badge.variant).toBe("default");
  });

  it("returns secondary variant for disabled status", () => {
    const badge = deriveStatusBadge("disabled");
    expect(badge.label).toBe("Disabled");
    expect(badge.variant).toBe("secondary");
  });
});

// ---------------------------------------------------------------------------
// Provenance badge
// ---------------------------------------------------------------------------

describe("deriveProvenanceBadge", () => {
  it("shows 'Manual' for manual provenance", () => {
    const badge = deriveProvenanceBadge("manual");
    expect(badge.label).toBe("Manual");
  });

  it("shows server name for non-manual provenance", () => {
    const badge = deriveProvenanceBadge("mcp-github-server");
    expect(badge.label).toBe("mcp-github-server");
  });
});

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

describe("filterTools", () => {
  const tools = [
    makeTool({ id: "1", name: "read", status: "active", risk_level: "low" }),
    makeTool({ id: "2", name: "write", status: "disabled", risk_level: "high" }),
    makeTool({ id: "3", name: "delete", status: "active", risk_level: "critical" }),
  ];

  it("filters by status", () => {
    const result = filterTools(tools, makeFilters({ status: "disabled" }));

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("write");
  });

  it("filters by risk_level", () => {
    const result = filterTools(tools, makeFilters({ riskLevel: "high" }));

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("write");
  });

  it("filters by text search matching name", () => {
    const result = filterTools(tools, makeFilters({ searchText: "read" }));

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("read");
  });

  it("filters by text search matching description", () => {
    const toolsWithDesc = [
      makeTool({ id: "1", name: "tool-a", description: "Reads files from disk" }),
      makeTool({ id: "2", name: "tool-b", description: "Writes to database" }),
    ];

    const result = filterTools(toolsWithDesc, makeFilters({ searchText: "database" }));

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("tool-b");
  });

  it("text search is case-insensitive", () => {
    const result = filterTools(tools, makeFilters({ searchText: "READ" }));

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("read");
  });

  it("returns all tools when no filters applied", () => {
    const result = filterTools(tools, makeFilters());

    expect(result).toHaveLength(3);
  });

  it("combines status and risk_level filters", () => {
    const result = filterTools(tools, makeFilters({ status: "active", riskLevel: "critical" }));

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("delete");
  });
});

// ---------------------------------------------------------------------------
// Empty search results
// ---------------------------------------------------------------------------

describe("ToolTable empty search", () => {
  it("shows empty search message when filters match nothing", () => {
    const tools = [makeTool({ id: "1", name: "read" })];

    const vm = deriveToolTableViewModel({
      tools,
      filters: makeFilters({ searchText: "nonexistent" }),
    });

    expect(vm.showEmptySearch).toBe(true);
    expect(vm.emptySearchMessage).toBe("No tools match your search");
  });

  it("does not show empty search when tools exist but no filters applied", () => {
    const tools = [makeTool({ id: "1", name: "read" })];

    const vm = deriveToolTableViewModel({
      tools,
      filters: makeFilters(),
    });

    expect(vm.showEmptySearch).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Governed tools indicator
// ---------------------------------------------------------------------------

describe("ToolTable governed tools", () => {
  it("marks tools with governance_count > 0 as governed", () => {
    const tools = [
      makeTool({ id: "1", governance_count: 2 }),
      makeTool({ id: "2", governance_count: 0 }),
    ];

    const groups = groupToolsByToolkit(tools);
    const allRows = groups.flatMap((g) => g.rows);

    const governed = allRows.find((r) => r.id === "1");
    const ungoverned = allRows.find((r) => r.id === "2");
    expect(governed?.isGoverned).toBe(true);
    expect(ungoverned?.isGoverned).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Description truncation
// ---------------------------------------------------------------------------

describe("ToolTable description truncation", () => {
  it("truncates long descriptions", () => {
    const longDesc = "A".repeat(200);
    const tools = [makeTool({ id: "1", description: longDesc })];

    const groups = groupToolsByToolkit(tools);
    const row = groups[0].rows[0];

    expect(row.truncatedDescription.length).toBeLessThan(200);
    expect(row.truncatedDescription).toContain("...");
  });

  it("does not truncate short descriptions", () => {
    const tools = [makeTool({ id: "1", description: "Short" })];

    const groups = groupToolsByToolkit(tools);
    const row = groups[0].rows[0];

    expect(row.truncatedDescription).toBe("Short");
  });
});

// ---------------------------------------------------------------------------
// Tool detail panel view model
// ---------------------------------------------------------------------------

import {
  deriveToolDetailViewModel,
  type ToolDetailData,
  type ToolDetailViewState,
} from "../../../../app/src/client/components/tool-registry/ToolDetailPanel";

function makeToolDetailData(overrides?: Partial<ToolDetailData>): ToolDetailData {
  return {
    id: "tool-1",
    name: "test-tool",
    toolkit: "default",
    description: "A test tool for testing",
    risk_level: "low",
    status: "active",
    grant_count: 0,
    governance_count: 0,
    created_at: "2026-01-15T10:00:00Z",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
      },
      required: ["query"],
    },
    grants: [],
    governance_policies: [],
    ...overrides,
  };
}

describe("ToolDetailPanel view model", () => {
  describe("expands tool detail with schema grants and governance", () => {
    it("derives formatted input schema as indented JSON string", () => {
      const schema = { type: "object", properties: { q: { type: "string" } } };
      const data = makeToolDetailData({ input_schema: schema });

      const vm = deriveToolDetailViewModel({ state: "loaded", data });

      expect(vm.tag).toBe("loaded");
      if (vm.tag !== "loaded") return;
      expect(vm.formattedInputSchema).toBe(JSON.stringify(schema, null, 2));
    });

    it("derives grant rows with identity name and rate limit", () => {
      const data = makeToolDetailData({
        grants: [
          {
            identity_id: "id-1",
            identity_name: "Alice",
            max_calls_per_hour: 100,
            granted_at: "2026-01-15T10:00:00Z",
          },
          {
            identity_id: "id-2",
            identity_name: "Bob",
            granted_at: "2026-01-16T10:00:00Z",
          },
        ],
      });

      const vm = deriveToolDetailViewModel({ state: "loaded", data });

      if (vm.tag !== "loaded") return;
      expect(vm.grantRows).toHaveLength(2);
      expect(vm.grantRows[0].identityName).toBe("Alice");
      expect(vm.grantRows[0].rateLimitDisplay).toBe("100/hr");
      expect(vm.grantRows[1].identityName).toBe("Bob");
      expect(vm.grantRows[1].rateLimitDisplay).toBe("Unlimited");
    });

    it("derives governance rows with policy title, conditions, and limits", () => {
      const data = makeToolDetailData({
        governance_policies: [
          {
            policy_title: "Rate Limit Policy",
            policy_status: "active",
            conditions: "workspace = production",
            max_per_call: 10,
            max_per_day: 1000,
          },
          {
            policy_title: "Audit Policy",
            policy_status: "active",
          },
        ],
      });

      const vm = deriveToolDetailViewModel({ state: "loaded", data });

      if (vm.tag !== "loaded") return;
      expect(vm.governanceRows).toHaveLength(2);
      expect(vm.governanceRows[0].policyTitle).toBe("Rate Limit Policy");
      expect(vm.governanceRows[0].conditionsDisplay).toBe("workspace = production");
      expect(vm.governanceRows[0].maxPerCallDisplay).toBe("10");
      expect(vm.governanceRows[0].maxPerDayDisplay).toBe("1000");
      expect(vm.governanceRows[1].policyTitle).toBe("Audit Policy");
      expect(vm.governanceRows[1].conditionsDisplay).toBe("None");
      expect(vm.governanceRows[1].maxPerCallDisplay).toBe("--");
      expect(vm.governanceRows[1].maxPerDayDisplay).toBe("--");
    });

    it("returns loading state view model", () => {
      const vm = deriveToolDetailViewModel({ state: "loading" });

      expect(vm.tag).toBe("loading");
    });

    it("returns error state view model with message", () => {
      const vm = deriveToolDetailViewModel({ state: "error", error: "Network failure" });

      expect(vm.tag).toBe("error");
      if (vm.tag !== "error") return;
      expect(vm.errorMessage).toBe("Network failure");
    });

    it("shows empty grants message when no grants exist", () => {
      const data = makeToolDetailData({ grants: [] });

      const vm = deriveToolDetailViewModel({ state: "loaded", data });

      if (vm.tag !== "loaded") return;
      expect(vm.grantRows).toHaveLength(0);
      expect(vm.showEmptyGrants).toBe(true);
    });

    it("shows empty governance message when no policies exist", () => {
      const data = makeToolDetailData({ governance_policies: [] });

      const vm = deriveToolDetailViewModel({ state: "loaded", data });

      if (vm.tag !== "loaded") return;
      expect(vm.governanceRows).toHaveLength(0);
      expect(vm.showEmptyGovernance).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// Tool detail URL builder
// ---------------------------------------------------------------------------

import { buildToolDetailUrl } from "../../../../app/src/client/hooks/use-tool-detail";

describe("buildToolDetailUrl", () => {
  it("builds correct URL for tool detail endpoint", () => {
    const url = buildToolDetailUrl("ws-123", "tool-456");
    expect(url).toBe("/api/workspaces/ws-123/tools/tool-456");
  });

  it("encodes special characters in workspace and tool IDs", () => {
    const url = buildToolDetailUrl("ws/123", "tool/456");
    expect(url).toBe("/api/workspaces/ws%2F123/tools/tool%2F456");
  });
});
