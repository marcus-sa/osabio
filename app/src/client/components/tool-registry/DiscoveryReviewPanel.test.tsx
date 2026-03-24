import { describe, it, expect } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DiscoveryReviewPanel } from "./DiscoveryReviewPanel";
import type { ToolSyncDetail } from "../../../server/tool-registry/types";

function makeSyncTool(overrides: Partial<ToolSyncDetail> = {}): ToolSyncDetail {
  return {
    name: "read_file",
    description: "Read a file from disk",
    input_schema: { type: "object" },
    action: "create",
    risk_level: "low",
    ...overrides,
  };
}

describe("DiscoveryReviewPanel", () => {
  const noop = () => {};
  const noopImport = async () => {};

  it("renders tool rows with action badges", () => {
    const tools = [
      makeSyncTool({ name: "tool_a", action: "create" }),
      makeSyncTool({ name: "tool_b", action: "update" }),
    ];
    render(
      <DiscoveryReviewPanel serverId="s1" tools={tools} onImport={noopImport} onCancel={noop} />,
    );
    expect(screen.getByText("New")).toBeInTheDocument();
    expect(screen.getByText("Updated")).toBeInTheDocument();
  });

  it("pre-selects create and update tools", () => {
    const tools = [
      makeSyncTool({ name: "new_tool", action: "create" }),
      makeSyncTool({ name: "changed_tool", action: "update" }),
      makeSyncTool({ name: "same_tool", action: "unchanged" }),
    ];
    render(
      <DiscoveryReviewPanel serverId="s1" tools={tools} onImport={noopImport} onCancel={noop} />,
    );

    const newCheckbox = screen.getByLabelText("Select new_tool") as HTMLInputElement;
    const changedCheckbox = screen.getByLabelText("Select changed_tool") as HTMLInputElement;
    expect(newCheckbox.checked).toBe(true);
    expect(changedCheckbox.checked).toBe(true);
  });

  it("shows summary counts", () => {
    const tools = [
      makeSyncTool({ name: "a", action: "create" }),
      makeSyncTool({ name: "b", action: "create" }),
      makeSyncTool({ name: "c", action: "update" }),
      makeSyncTool({ name: "d", action: "unchanged" }),
    ];
    render(
      <DiscoveryReviewPanel serverId="s1" tools={tools} onImport={noopImport} onCancel={noop} />,
    );
    expect(screen.getByText("2 new")).toBeInTheDocument();
    expect(screen.getByText("1 updated")).toBeInTheDocument();
    expect(screen.getByText("1 unchanged")).toBeInTheDocument();
  });

  it("Import Selected button shows selection count", () => {
    const tools = [
      makeSyncTool({ name: "a", action: "create" }),
      makeSyncTool({ name: "b", action: "update" }),
    ];
    render(
      <DiscoveryReviewPanel serverId="s1" tools={tools} onImport={noopImport} onCancel={noop} />,
    );
    expect(screen.getByRole("button", { name: /import selected \(2\)/i })).toBeInTheDocument();
  });

  it("Cancel button calls onCancel", async () => {
    const user = userEvent.setup();
    const calls: boolean[] = [];
    render(
      <DiscoveryReviewPanel
        serverId="s1"
        tools={[makeSyncTool()]}
        onImport={noopImport}
        onCancel={() => calls.push(true)}
      />,
    );
    await user.click(screen.getByRole("button", { name: /cancel/i }));
    expect(calls).toEqual([true]);
  });

  it("toggling checkbox updates selection count", async () => {
    const user = userEvent.setup();
    const tools = [
      makeSyncTool({ name: "tool_a", action: "create" }),
      makeSyncTool({ name: "tool_b", action: "create" }),
    ];
    render(
      <DiscoveryReviewPanel serverId="s1" tools={tools} onImport={noopImport} onCancel={noop} />,
    );

    // Initially 2 selected
    expect(screen.getByRole("button", { name: /import selected \(2\)/i })).toBeInTheDocument();

    // Deselect one
    await user.click(screen.getByLabelText("Select tool_a"));
    expect(screen.getByRole("button", { name: /import selected \(1\)/i })).toBeInTheDocument();
  });

  it("unchanged tools are collapsed by default", () => {
    const tools = [
      makeSyncTool({ name: "new_tool", action: "create" }),
      makeSyncTool({ name: "unchanged_tool", action: "unchanged" }),
    ];
    render(
      <DiscoveryReviewPanel serverId="s1" tools={tools} onImport={noopImport} onCancel={noop} />,
    );

    expect(screen.getByText("new_tool")).toBeInTheDocument();
    // unchanged_tool is inside collapsed collapsible, should not be visible
    // The collapsible trigger text should show "1 unchanged tool"
    expect(screen.getByText("1 unchanged tool")).toBeInTheDocument();
  });

  it("show diff button appears for update actions", () => {
    const tools = [makeSyncTool({ name: "updated_tool", action: "update" })];
    render(
      <DiscoveryReviewPanel serverId="s1" tools={tools} onImport={noopImport} onCancel={noop} />,
    );
    expect(screen.getByText("Show diff")).toBeInTheDocument();
  });
});
