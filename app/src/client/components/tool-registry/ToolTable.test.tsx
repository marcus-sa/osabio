import { describe, it, expect, mock } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ToolListItem } from "../../hooks/use-tools";

// Mock the hook (not the whole module) to avoid poisoning other test files
mock.module("../../hooks/use-tool-detail", () => ({
  useToolDetail: (toolId: string) => ({
    data: { id: toolId, name: "mock", toolkit: "mock", description: "", risk_level: "low", status: "active", grant_count: 0, governance_count: 0, created_at: "", input_schema: {}, grants: [], governance_policies: [] },
    isLoading: false,
    error: undefined,
  }),
}));
mock.module("../ui/button", () => ({
  Button: (props: Record<string, unknown>) => props.children,
}));

// Import after mock
const { ToolTable, groupToolsByServer, deriveToolTableViewModel, filterTools } = await import("./ToolTable");

function makeTool(overrides: Partial<ToolListItem> = {}): ToolListItem {
  return {
    id: "t1",
    name: "read_file",
    toolkit: "filesystem",
    description: "Read a file from disk",
    risk_level: "low",
    status: "active",
    grant_count: 2,
    governance_count: 0,
    provider_name: "github-server",
    source_server_id: "srv1",
    source_server_name: "Linear",
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

const NO_FILTERS = { searchText: "" };

describe("ToolTable", () => {
  // -------------------------------------------------------------------------
  // Server-based grouping
  // -------------------------------------------------------------------------

  it("renders tools grouped by MCP server with counts", () => {
    const tools = [
      makeTool({ id: "t1", name: "read_file", source_server_id: "srv1", source_server_name: "Linear" }),
      makeTool({ id: "t2", name: "write_file", source_server_id: "srv1", source_server_name: "Linear" }),
      makeTool({ id: "t3", name: "search", source_server_id: "srv2", source_server_name: "GitHub" }),
    ];
    render(<ToolTable tools={tools} filters={NO_FILTERS} />);

    expect(screen.getByText("Linear")).toBeInTheDocument();
    expect(screen.getByText("GitHub")).toBeInTheDocument();
    // Group headers show server name followed by count badge
    const badges = screen.getAllByText((_, el) =>
      el?.getAttribute("data-slot") === "badge" &&
      el?.getAttribute("data-variant") === "secondary" &&
      (el?.textContent === "2" || el?.textContent === "1"),
    );
    expect(badges.length).toBe(2);
  });

  it("groups tools without a server under Ungrouped", () => {
    const tools = [
      makeTool({ id: "t1", name: "manual_tool", source_server_id: undefined, source_server_name: undefined }),
    ];
    render(<ToolTable tools={tools} filters={NO_FILTERS} />);
    expect(screen.getByText("Ungrouped")).toBeInTheDocument();
  });

  it("shows server groups before ungrouped", () => {
    const tools = [
      makeTool({ id: "t1", name: "manual_tool", source_server_id: undefined, source_server_name: undefined }),
      makeTool({ id: "t2", name: "linear_tool", source_server_id: "srv1", source_server_name: "Linear" }),
    ];
    render(<ToolTable tools={tools} filters={NO_FILTERS} />);

    const headers = screen.getAllByText((_, el) =>
      el?.tagName === "SPAN" &&
      el?.classList.contains("font-semibold") &&
      (el?.textContent === "Linear" || el?.textContent === "Ungrouped"),
    );
    expect(headers[0].textContent).toBe("Linear");
    expect(headers[1].textContent).toBe("Ungrouped");
  });

  // -------------------------------------------------------------------------
  // Badges
  // -------------------------------------------------------------------------

  it("shows risk level badges", () => {
    const tools = [
      makeTool({ id: "t1", risk_level: "low" }),
      makeTool({ id: "t2", risk_level: "critical" }),
    ];
    render(<ToolTable tools={tools} filters={NO_FILTERS} />);
    expect(screen.getByText("Low")).toBeInTheDocument();
    expect(screen.getByText("Critical")).toBeInTheDocument();
  });

  it("shows status badges", () => {
    const tools = [
      makeTool({ id: "t1", status: "active" }),
      makeTool({ id: "t2", status: "disabled" }),
    ];
    render(<ToolTable tools={tools} filters={NO_FILTERS} />);
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("Disabled")).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Empty states
  // -------------------------------------------------------------------------

  it("shows empty state when no tools", () => {
    render(<ToolTable tools={[]} filters={NO_FILTERS} />);
    expect(screen.getByText("No tools discovered yet.")).toBeInTheDocument();
  });

  it("shows empty search when filters match nothing", () => {
    const tools = [makeTool()];
    render(<ToolTable tools={tools} filters={{ searchText: "nonexistent-xyz" }} />);
    expect(screen.getByText("No tools match your search")).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Governance
  // -------------------------------------------------------------------------

  it("shows shield for governed tools", () => {
    render(<ToolTable tools={[makeTool({ governance_count: 3 })]} filters={NO_FILTERS} />);
    expect(screen.getByLabelText("shield")).toBeInTheDocument();
  });

  it("does not show shield for ungoverned tools", () => {
    render(<ToolTable tools={[makeTool({ governance_count: 0 })]} filters={NO_FILTERS} />);
    expect(screen.queryByLabelText("shield")).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Expand / collapse
  // -------------------------------------------------------------------------

  it("clicking row expands detail panel", async () => {
    const user = userEvent.setup();
    render(<ToolTable tools={[makeTool({ id: "t1", name: "read_file" })]} filters={NO_FILTERS} />);

    await user.click(screen.getByText("read_file"));
    // Detail panel renders inline — check for the "Input Schema" section header
    expect(screen.getByText("Input Schema")).toBeInTheDocument();
  });

  it("clicking expanded row collapses detail panel", async () => {
    const user = userEvent.setup();
    render(<ToolTable tools={[makeTool({ id: "t1", name: "read_file" })]} filters={NO_FILTERS} />);

    await user.click(screen.getByText("read_file"));
    expect(screen.getByText("Input Schema")).toBeInTheDocument();

    await user.click(screen.getByText("read_file"));
    expect(screen.queryByText("Input Schema")).not.toBeInTheDocument();
  });

  it("truncates descriptions longer than 100 chars", () => {
    const longDesc = "A".repeat(120);
    render(<ToolTable tools={[makeTool({ description: longDesc })]} filters={NO_FILTERS} />);
    expect(screen.getByText(`${"A".repeat(100)}...`)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Pure function unit tests
// ---------------------------------------------------------------------------

describe("groupToolsByServer", () => {
  it("groups tools by source_server_id", () => {
    const tools = [
      makeTool({ id: "t1", source_server_id: "srv1", source_server_name: "Linear" }),
      makeTool({ id: "t2", source_server_id: "srv1", source_server_name: "Linear" }),
      makeTool({ id: "t3", source_server_id: "srv2", source_server_name: "GitHub" }),
    ];
    const groups = groupToolsByServer(tools);

    expect(groups.length).toBe(2);
    expect(groups[0].label).toBe("GitHub");
    expect(groups[0].rows.length).toBe(1);
    expect(groups[1].label).toBe("Linear");
    expect(groups[1].rows.length).toBe(2);
  });

  it("puts ungrouped tools in an Ungrouped group at the end", () => {
    const tools = [
      makeTool({ id: "t1", source_server_id: "srv1", source_server_name: "Linear" }),
      makeTool({ id: "t2", source_server_id: undefined, source_server_name: undefined }),
    ];
    const groups = groupToolsByServer(tools);

    expect(groups.length).toBe(2);
    expect(groups[0].label).toBe("Linear");
    expect(groups[0].serverId).toBe("srv1");
    expect(groups[1].label).toBe("Ungrouped");
    expect(groups[1].serverId).toBeUndefined();
  });

  it("returns empty array for no tools", () => {
    expect(groupToolsByServer([]).length).toBe(0);
  });

  it("sorts server groups alphabetically by name", () => {
    const tools = [
      makeTool({ id: "t1", source_server_id: "srv2", source_server_name: "Zeta" }),
      makeTool({ id: "t2", source_server_id: "srv1", source_server_name: "Alpha" }),
    ];
    const groups = groupToolsByServer(tools);
    expect(groups[0].label).toBe("Alpha");
    expect(groups[1].label).toBe("Zeta");
  });
});

describe("filterTools", () => {
  it("filters by search text in name", () => {
    const tools = [
      makeTool({ id: "t1", name: "read_file", description: "Read a file" }),
      makeTool({ id: "t2", name: "write_file", description: "Write a file" }),
    ];
    const result = filterTools(tools, { searchText: "read" });
    expect(result.length).toBe(1);
    expect(result[0].name).toBe("read_file");
  });

  it("filters by status", () => {
    const tools = [
      makeTool({ id: "t1", status: "active" }),
      makeTool({ id: "t2", status: "disabled" }),
    ];
    const result = filterTools(tools, { searchText: "", status: "disabled" });
    expect(result.length).toBe(1);
    expect(result[0].status).toBe("disabled");
  });

  it("filters by risk level", () => {
    const tools = [
      makeTool({ id: "t1", risk_level: "low" }),
      makeTool({ id: "t2", risk_level: "high" }),
    ];
    const result = filterTools(tools, { searchText: "", riskLevel: "high" });
    expect(result.length).toBe(1);
    expect(result[0].risk_level).toBe("high");
  });
});

describe("deriveToolTableViewModel", () => {
  it("sets showEmptyState when no tools provided", () => {
    const vm = deriveToolTableViewModel({ tools: [], filters: NO_FILTERS });
    expect(vm.showEmptyState).toBe(true);
    expect(vm.showEmptySearch).toBe(false);
  });

  it("sets showEmptySearch when filters exclude all tools", () => {
    const vm = deriveToolTableViewModel({
      tools: [makeTool()],
      filters: { searchText: "nonexistent" },
    });
    expect(vm.showEmptyState).toBe(false);
    expect(vm.showEmptySearch).toBe(true);
  });

  it("produces groups from filtered tools", () => {
    const vm = deriveToolTableViewModel({
      tools: [
        makeTool({ id: "t1", source_server_id: "srv1", source_server_name: "Linear" }),
        makeTool({ id: "t2", source_server_id: "srv2", source_server_name: "GitHub" }),
      ],
      filters: NO_FILTERS,
    });
    expect(vm.groups.length).toBe(2);
  });
});
