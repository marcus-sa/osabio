import { describe, it, expect } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GrantTable } from "./GrantTable";
import type { ToolListItem } from "../../hooks/use-tools";
import type { GrantListItem } from "../../hooks/use-grants";

function makeTool(overrides: Partial<ToolListItem> = {}): ToolListItem {
  return {
    id: "t1",
    name: "read_file",
    toolkit: "filesystem",
    description: "Read a file",
    risk_level: "low",
    status: "active",
    grant_count: 1,
    governance_count: 0,
    provider_name: "mcp-server",
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeGrant(overrides: Partial<GrantListItem> = {}): GrantListItem {
  return {
    identity_id: "id-1",
    identity_name: "Alice",
    tool_id: "t1",
    tool_name: "read_file",
    granted_at: "2026-02-01T00:00:00Z",
    ...overrides,
  };
}

describe("GrantTable", () => {
  const noop = () => {};

  it("renders tool rows with names and grant count badges", () => {
    const tools = [
      makeTool({ id: "t1", name: "read_file", grant_count: 3 }),
      makeTool({ id: "t2", name: "write_file", grant_count: 0 }),
    ];
    render(
      <GrantTable tools={tools} grantsByToolId={{}} onGrantAccess={noop} onRevokeGrant={noop} />,
    );
    expect(screen.getByText("read_file")).toBeInTheDocument();
    expect(screen.getByText("write_file")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("shows empty state when no tools", () => {
    render(
      <GrantTable tools={[]} grantsByToolId={{}} onGrantAccess={noop} onRevokeGrant={noop} />,
    );
    expect(screen.getByText(/no tools available/i)).toBeInTheDocument();
  });

  it("Grant Access button calls onGrantAccess", async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    render(
      <GrantTable
        tools={[makeTool({ id: "t1" })]}
        grantsByToolId={{}}
        onGrantAccess={(id) => calls.push(id)}
        onRevokeGrant={noop}
      />,
    );
    await user.click(screen.getByRole("button", { name: /grant access/i }));
    expect(calls).toEqual(["t1"]);
  });

  it("clicking tool row expands grant rows", async () => {
    const user = userEvent.setup();
    const grants = { t1: [makeGrant({ identity_name: "Alice" })] };
    render(
      <GrantTable
        tools={[makeTool({ id: "t1", name: "read_file" })]}
        grantsByToolId={grants}
        onGrantAccess={noop}
        onRevokeGrant={noop}
      />,
    );
    await user.click(screen.getByText("read_file"));
    expect(screen.getByText("Alice")).toBeInTheDocument();
  });

  it("clicking expanded row collapses it", async () => {
    const user = userEvent.setup();
    const grants = { t1: [makeGrant({ identity_name: "Alice" })] };
    render(
      <GrantTable
        tools={[makeTool({ id: "t1", name: "read_file" })]}
        grantsByToolId={grants}
        onGrantAccess={noop}
        onRevokeGrant={noop}
      />,
    );
    await user.click(screen.getByText("read_file"));
    expect(screen.getByText("Alice")).toBeInTheDocument();

    await user.click(screen.getByText("read_file"));
    expect(screen.queryByText("Alice")).not.toBeInTheDocument();
  });

  it("shows Unlimited for grants without rate limit", async () => {
    const user = userEvent.setup();
    const grants = { t1: [makeGrant({ max_calls_per_hour: undefined })] };
    render(
      <GrantTable
        tools={[makeTool({ id: "t1", name: "read_file" })]}
        grantsByToolId={grants}
        onGrantAccess={noop}
        onRevokeGrant={noop}
      />,
    );
    await user.click(screen.getByText("read_file"));
    expect(screen.getByText("Unlimited")).toBeInTheDocument();
  });

  it("shows rate limit display for grants with limit", async () => {
    const user = userEvent.setup();
    const grants = { t1: [makeGrant({ max_calls_per_hour: 100 })] };
    render(
      <GrantTable
        tools={[makeTool({ id: "t1", name: "read_file" })]}
        grantsByToolId={grants}
        onGrantAccess={noop}
        onRevokeGrant={noop}
      />,
    );
    await user.click(screen.getByText("read_file"));
    expect(screen.getByText("100/hr")).toBeInTheDocument();
  });

  it("shows no grants message when tool has empty grants", async () => {
    const user = userEvent.setup();
    render(
      <GrantTable
        tools={[makeTool({ id: "t1", name: "read_file" })]}
        grantsByToolId={{ t1: [] }}
        onGrantAccess={noop}
        onRevokeGrant={noop}
      />,
    );
    await user.click(screen.getByText("read_file"));
    expect(screen.getByText(/no grants configured/i)).toBeInTheDocument();
  });
});
