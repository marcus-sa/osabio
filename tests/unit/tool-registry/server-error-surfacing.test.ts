/**
 * Regression tests: sync/discover errors are surfaced in the UI.
 *
 * Bug: clicking Sync on an MCP server in the UI returned a 502 but the client
 * silently swallowed it — no error was shown to the user. The server also did
 * not persist the error on the mcp_server record, so refreshing the page lost
 * all evidence of the failure.
 *
 * Tests:
 *   - deriveMcpServerRowViewModel maps last_error to lastError
 *   - deriveMcpServerRowViewModel omits lastError when last_error is absent
 */
import { describe, expect, it } from "bun:test";
import {
  deriveMcpServerRowViewModel,
} from "../../../app/src/client/components/tool-registry/McpServerSection";
import type { McpServerListItem } from "../../../app/src/client/hooks/use-mcp-servers";

function makeServer(overrides: Partial<McpServerListItem> = {}): McpServerListItem {
  return {
    id: "srv-1",
    name: "Test Server",
    url: "https://mcp.example.com",
    transport: "streamable-http",
    auth_mode: "none",
    has_static_headers: false,
    tool_count: 3,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("deriveMcpServerRowViewModel error surfacing", () => {
  it("maps last_error to lastError when present", () => {
    const server = makeServer({
      last_status: "error",
      last_error: "Failed to connect to MCP server: ECONNREFUSED",
    });

    const vm = deriveMcpServerRowViewModel(server);

    expect(vm.lastError).toBe("Failed to connect to MCP server: ECONNREFUSED");
    expect(vm.statusIndicator.color).toBe("red");
    expect(vm.statusIndicator.label).toBe("Error");
  });

  it("omits lastError when last_error is absent", () => {
    const server = makeServer({ last_status: "ok" });

    const vm = deriveMcpServerRowViewModel(server);

    expect(vm.lastError).toBeUndefined();
    expect(vm.statusIndicator.color).toBe("green");
  });

  it("omits lastError when server has no status", () => {
    const server = makeServer();

    const vm = deriveMcpServerRowViewModel(server);

    expect(vm.lastError).toBeUndefined();
  });
});
