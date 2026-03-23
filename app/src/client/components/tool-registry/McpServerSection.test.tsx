import { describe, it, expect } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { McpServerSection } from "./McpServerSection";
import type { McpServerListItem } from "../../hooks/use-mcp-servers";
import type { ProviderListItem } from "../../hooks/use-providers";

function makeServer(overrides: Partial<McpServerListItem> = {}): McpServerListItem {
  return {
    id: "srv-1",
    name: "github-mcp",
    url: "https://mcp.github.example.com",
    transport: "streamable-http",
    auth_mode: "none",
    has_static_headers: false,
    last_status: "ok",
    tool_count: 5,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("McpServerSection", () => {
  const noop = () => {};
  const noopAsync = async () => ({});

  const defaultProps = {
    providers: [] as ProviderListItem[],
    onAddServer: noopAsync,
    onRemoveServer: noop,
    onDiscover: noop,
    onSync: noop,
    onAuthorize: noop,
  };

  it("renders server rows with name and URL", () => {
    const servers = [
      makeServer({ id: "s1", name: "github-mcp", url: "https://github.example.com" }),
      makeServer({ id: "s2", name: "slack-mcp", url: "https://slack.example.com" }),
    ];
    render(<McpServerSection servers={servers} {...defaultProps} />);
    expect(screen.getByText("github-mcp")).toBeInTheDocument();
    expect(screen.getByText("slack-mcp")).toBeInTheDocument();
    expect(screen.getByText("https://github.example.com")).toBeInTheDocument();
    expect(screen.getByText("https://slack.example.com")).toBeInTheDocument();
  });

  it("shows connected status dot for ok status", () => {
    render(<McpServerSection servers={[makeServer({ last_status: "ok" })]} {...defaultProps} />);
    expect(screen.getByLabelText("Connected")).toBeInTheDocument();
  });

  it("shows error status dot for error status", () => {
    render(<McpServerSection servers={[makeServer({ last_status: "error" })]} {...defaultProps} />);
    expect(screen.getByLabelText("Error")).toBeInTheDocument();
  });

  it("shows auth_error status dot", () => {
    render(<McpServerSection servers={[makeServer({ last_status: "auth_error", auth_mode: "oauth" })]} {...defaultProps} />);
    expect(screen.getByLabelText("Auth Error")).toBeInTheDocument();
  });

  it("shows tool count display", () => {
    render(<McpServerSection servers={[makeServer({ tool_count: 3 })]} {...defaultProps} />);
    expect(screen.getByText("3 tools")).toBeInTheDocument();
  });

  it("shows singular tool count", () => {
    render(<McpServerSection servers={[makeServer({ tool_count: 1 })]} {...defaultProps} />);
    expect(screen.getByText("1 tool")).toBeInTheDocument();
  });

  it("Discover button calls onDiscover with server id", async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    render(
      <McpServerSection
        servers={[makeServer({ id: "srv-42" })]}
        {...defaultProps}
        onDiscover={(id) => calls.push(id)}
      />,
    );
    await user.click(screen.getByRole("button", { name: /^discover$/i }));
    expect(calls).toEqual(["srv-42"]);
  });

  it("Sync button calls onSync with server id", async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    render(
      <McpServerSection
        servers={[makeServer({ id: "srv-42" })]}
        {...defaultProps}
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
        {...defaultProps}
      />,
    );
    await user.click(screen.getByRole("button", { name: /remove/i }));
    expect(screen.getByText("Remove github-mcp?")).toBeInTheDocument();
  });

  it("shows empty state when no servers", () => {
    render(<McpServerSection servers={[]} {...defaultProps} />);
    expect(screen.getByText("No MCP servers configured.")).toBeInTheDocument();
  });

  it("shows OAuth auth badge for oauth auth_mode", () => {
    render(
      <McpServerSection
        servers={[makeServer({ auth_mode: "oauth" })]}
        {...defaultProps}
      />,
    );
    expect(screen.getByText("OAuth")).toBeInTheDocument();
  });

  it("shows Headers auth badge for static_headers auth_mode", () => {
    render(
      <McpServerSection
        servers={[makeServer({ auth_mode: "static_headers", has_static_headers: true })]}
        {...defaultProps}
      />,
    );
    expect(screen.getByText("Headers")).toBeInTheDocument();
  });

  it("shows Re-authorize button for oauth server with auth_error and provider_id", async () => {
    const user = userEvent.setup();
    const authorizeCalls: string[] = [];
    render(
      <McpServerSection
        servers={[makeServer({
          id: "srv-oauth",
          auth_mode: "oauth",
          last_status: "auth_error",
          provider_id: "prov-1",
        })]}
        {...defaultProps}
        onAuthorize={(id) => authorizeCalls.push(id)}
      />,
    );
    expect(screen.getByRole("button", { name: /re-authorize/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /re-authorize/i }));
    expect(authorizeCalls).toEqual(["srv-oauth"]);
  });

  it("does not show Re-authorize for ok oauth server", () => {
    render(
      <McpServerSection
        servers={[makeServer({ auth_mode: "oauth", last_status: "ok", provider_id: "prov-1" })]}
        {...defaultProps}
      />,
    );
    expect(screen.queryByRole("button", { name: /re-authorize/i })).toBeNull();
  });

  it("does not show Re-authorize for non-oauth servers", () => {
    render(
      <McpServerSection
        servers={[makeServer({ auth_mode: "static_headers", has_static_headers: true })]}
        {...defaultProps}
      />,
    );
    expect(screen.queryByRole("button", { name: /re-authorize/i })).toBeNull();
  });
});
