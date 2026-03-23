import { describe, it, expect } from "bun:test";
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { McpServerSection } from "./McpServerSection";
import type { McpServerListItem } from "../../hooks/use-mcp-servers";

function makeServer(overrides: Partial<McpServerListItem> = {}): McpServerListItem {
  return {
    id: "srv-1",
    name: "github-mcp",
    url: "https://mcp.github.example.com",
    transport: "streamable-http",
    last_status: "ok",
    tool_count: 5,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("McpServerSection", () => {
  const noop = () => {};
  const noopAsync = async () => ({});

  it("renders server rows with name and URL", () => {
    const servers = [
      makeServer({ id: "s1", name: "github-mcp", url: "https://github.example.com" }),
      makeServer({ id: "s2", name: "slack-mcp", url: "https://slack.example.com" }),
    ];
    render(
      <McpServerSection
        servers={servers}
        providers={[]}
        onAddServer={noopAsync}
        onRemoveServer={noop}
        onDiscover={noop}
        onSync={noop}
      />,
    );
    expect(screen.getByText("github-mcp")).toBeInTheDocument();
    expect(screen.getByText("slack-mcp")).toBeInTheDocument();
    expect(screen.getByText("https://github.example.com")).toBeInTheDocument();
    expect(screen.getByText("https://slack.example.com")).toBeInTheDocument();
  });

  it("shows connected status dot for ok status", () => {
    render(
      <McpServerSection
        servers={[makeServer({ last_status: "ok" })]}
        providers={[]}
        onAddServer={noopAsync}
        onRemoveServer={noop}
        onDiscover={noop}
        onSync={noop}
      />,
    );
    expect(screen.getByLabelText("Connected")).toBeInTheDocument();
  });

  it("shows error status dot for error status", () => {
    render(
      <McpServerSection
        servers={[makeServer({ last_status: "error" })]}
        providers={[]}
        onAddServer={noopAsync}
        onRemoveServer={noop}
        onDiscover={noop}
        onSync={noop}
      />,
    );
    expect(screen.getByLabelText("Error")).toBeInTheDocument();
  });

  it("shows tool count display", () => {
    render(
      <McpServerSection
        servers={[makeServer({ tool_count: 3 })]}
        providers={[]}
        onAddServer={noopAsync}
        onRemoveServer={noop}
        onDiscover={noop}
        onSync={noop}
      />,
    );
    expect(screen.getByText("3 tools")).toBeInTheDocument();
  });

  it("shows singular tool count", () => {
    render(
      <McpServerSection
        servers={[makeServer({ tool_count: 1 })]}
        providers={[]}
        onAddServer={noopAsync}
        onRemoveServer={noop}
        onDiscover={noop}
        onSync={noop}
      />,
    );
    expect(screen.getByText("1 tool")).toBeInTheDocument();
  });

  it("Discover button calls onDiscover with server id", async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    render(
      <McpServerSection
        servers={[makeServer({ id: "srv-42" })]}
        providers={[]}
        onAddServer={noopAsync}
        onRemoveServer={noop}
        onDiscover={(id) => calls.push(id)}
        onSync={noop}
      />,
    );
    await user.click(screen.getByRole("button", { name: /discover/i }));
    expect(calls).toEqual(["srv-42"]);
  });

  it("Sync button calls onSync with server id", async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    render(
      <McpServerSection
        servers={[makeServer({ id: "srv-42" })]}
        providers={[]}
        onAddServer={noopAsync}
        onRemoveServer={noop}
        onDiscover={noop}
        onSync={(id) => calls.push(id)}
      />,
    );
    await user.click(screen.getByRole("button", { name: /sync/i }));
    expect(calls).toEqual(["srv-42"]);
  });

  it("Remove button opens confirmation dialog", async () => {
    const user = userEvent.setup();
    render(
      <McpServerSection
        servers={[makeServer({ name: "github-mcp" })]}
        providers={[]}
        onAddServer={noopAsync}
        onRemoveServer={noop}
        onDiscover={noop}
        onSync={noop}
      />,
    );
    await user.click(screen.getByRole("button", { name: /remove/i }));
    expect(screen.getByText("Remove github-mcp?")).toBeInTheDocument();
  });

  it("shows empty state when no servers", () => {
    render(
      <McpServerSection
        servers={[]}
        providers={[]}
        onAddServer={noopAsync}
        onRemoveServer={noop}
        onDiscover={noop}
        onSync={noop}
      />,
    );
    expect(screen.getByText("No MCP servers configured.")).toBeInTheDocument();
  });
});
