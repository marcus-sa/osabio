import { describe, it, expect, mock } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ToolListItem } from "../../hooks/use-tools";

// Mock ToolDetailPanel to avoid fetch calls from useToolDetail hook
mock.module("./ToolDetailPanel", () => ({
  ToolDetailPanel: ({ toolId }: { toolId: string }) => (
    <tr data-testid={`detail-${toolId}`}>
      <td colSpan={7}>Detail for {toolId}</td>
    </tr>
  ),
}));

// Import after mock
const { ToolTable } = await import("./ToolTable");

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
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

const NO_FILTERS = { searchText: "" };

describe("ToolTable", () => {
  it("renders tools grouped by toolkit with counts", () => {
    const tools = [
      makeTool({ id: "t1", name: "read_file", toolkit: "filesystem" }),
      makeTool({ id: "t2", name: "write_file", toolkit: "filesystem" }),
      makeTool({ id: "t3", name: "search", toolkit: "search-kit" }),
    ];
    render(<ToolTable tools={tools} filters={NO_FILTERS} />);

    expect(screen.getByText("filesystem")).toBeInTheDocument();
    expect(screen.getByText("search-kit")).toBeInTheDocument();
    // Group headers show toolkit name followed by count badge
    const badges = screen.getAllByText((_, el) =>
      el?.getAttribute("data-slot") === "badge" &&
      el?.getAttribute("data-variant") === "secondary" &&
      (el?.textContent === "2" || el?.textContent === "1"),
    );
    expect(badges.length).toBe(2);
  });

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

  it("shows provenance badge with provider name", () => {
    render(<ToolTable tools={[makeTool({ provider_name: "github-server" })]} filters={NO_FILTERS} />);
    expect(screen.getByText("github-server")).toBeInTheDocument();
  });

  it("shows Manual badge for manual provenance", () => {
    render(<ToolTable tools={[makeTool({ provider_name: "manual" })]} filters={NO_FILTERS} />);
    expect(screen.getByText("Manual")).toBeInTheDocument();
  });

  it("shows empty state when no tools", () => {
    render(<ToolTable tools={[]} filters={NO_FILTERS} />);
    expect(screen.getByText("No tools discovered yet.")).toBeInTheDocument();
  });

  it("shows empty search when filters match nothing", () => {
    const tools = [makeTool()];
    render(<ToolTable tools={tools} filters={{ searchText: "nonexistent-xyz" }} />);
    expect(screen.getByText("No tools match your search")).toBeInTheDocument();
  });

  it("shows shield for governed tools", () => {
    render(<ToolTable tools={[makeTool({ governance_count: 3 })]} filters={NO_FILTERS} />);
    expect(screen.getByLabelText("shield")).toBeInTheDocument();
  });

  it("does not show shield for ungoverned tools", () => {
    render(<ToolTable tools={[makeTool({ governance_count: 0 })]} filters={NO_FILTERS} />);
    expect(screen.queryByLabelText("shield")).not.toBeInTheDocument();
  });

  it("clicking row expands detail panel", async () => {
    const user = userEvent.setup();
    render(<ToolTable tools={[makeTool({ id: "t1", name: "read_file" })]} filters={NO_FILTERS} />);

    await user.click(screen.getByText("read_file"));
    expect(screen.getByTestId("detail-t1")).toBeInTheDocument();
  });

  it("clicking expanded row collapses detail panel", async () => {
    const user = userEvent.setup();
    render(<ToolTable tools={[makeTool({ id: "t1", name: "read_file" })]} filters={NO_FILTERS} />);

    await user.click(screen.getByText("read_file"));
    expect(screen.getByTestId("detail-t1")).toBeInTheDocument();

    await user.click(screen.getByText("read_file"));
    expect(screen.queryByTestId("detail-t1")).not.toBeInTheDocument();
  });

  it("truncates descriptions longer than 100 chars", () => {
    const longDesc = "A".repeat(120);
    render(<ToolTable tools={[makeTool({ description: longDesc })]} filters={NO_FILTERS} />);
    expect(screen.getByText(`${"A".repeat(100)}...`)).toBeInTheDocument();
  });
});
