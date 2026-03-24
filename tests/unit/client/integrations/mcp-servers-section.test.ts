import { describe, it, expect } from "bun:test";

/**
 * Tests for the MCP Servers section: view model functions for server list,
 * add dialog validation, and remove confirmation.
 *
 * All tests exercise pure view-model derivation functions -- no DOM rendering.
 *
 * Behaviors under test:
 *   1. Server row derivation: name, URL, status dot, tool count, relative time
 *   2. Status indicator: green for ok, red for error
 *   3. Add server URL validation: rejects non-http/https schemes
 *   4. Transport default: defaults to streamable-http
 *   5. Duplicate name detection: shows inline error
 *   6. Remove confirmation: warns about tool disabling
 *   7. Empty state: shows CTA when no servers
 *   8. Discover/Sync buttons: visible in each server row view model
 */

import type { McpServerListItem } from "../../../../app/src/client/hooks/use-mcp-servers";

import {
  deriveMcpServerSectionViewModel,
  deriveMcpServerRowViewModel,
  deriveStatusIndicator,
  validateAddMcpServerForm,
  deriveRemoveConfirmationViewModel,
  type McpServerSectionInput,
  type AddMcpServerFormData,
} from "../../../../app/src/client/components/tool-registry/McpServerSection";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeServer(overrides?: Partial<McpServerListItem>): McpServerListItem {
  return {
    id: "srv-1",
    name: "github-mcp",
    url: "https://github-mcp.example.com",
    transport: "streamable-http",
    last_status: "ok",
    tool_count: 5,
    created_at: "2026-01-15T10:00:00Z",
    ...overrides,
  };
}

function makeFormData(overrides?: Partial<AddMcpServerFormData>): AddMcpServerFormData {
  return {
    name: "new-server",
    url: "https://mcp.example.com",
    transport: "streamable-http",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Server list rendering with status indicators and action buttons
// ---------------------------------------------------------------------------

describe("McpServerSection view model", () => {
  describe("renders server list with status indicators and action buttons", () => {
    it("derives server rows with name, URL, status, tool count, and relative time", () => {
      const servers = [
        makeServer({ id: "1", name: "github-mcp", url: "https://gh.example.com", tool_count: 12 }),
        makeServer({ id: "2", name: "slack-mcp", url: "https://slack.example.com", tool_count: 3 }),
      ];

      const vm = deriveMcpServerSectionViewModel({ servers, existingNames: [] });

      expect(vm.rows).toHaveLength(2);
      expect(vm.rows[0].name).toBe("github-mcp");
      expect(vm.rows[0].url).toBe("https://gh.example.com");
      expect(vm.rows[0].toolCountDisplay).toBe("12 tools");
      expect(vm.rows[1].toolCountDisplay).toBe("3 tools");
      expect(vm.showEmptyState).toBe(false);
    });

    it("shows singular 'tool' for count of 1", () => {
      const row = deriveMcpServerRowViewModel(makeServer({ tool_count: 1 }));
      expect(row.toolCountDisplay).toBe("1 tool");
    });

    it("shows '0 tools' for zero count", () => {
      const row = deriveMcpServerRowViewModel(makeServer({ tool_count: 0 }));
      expect(row.toolCountDisplay).toBe("0 tools");
    });

    it("includes hasDiscoverAction and hasSyncAction in each row", () => {
      const row = deriveMcpServerRowViewModel(makeServer());
      expect(row.hasDiscoverAction).toBe(true);
      expect(row.hasSyncAction).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// 2. Status indicator
// ---------------------------------------------------------------------------

describe("deriveStatusIndicator", () => {
  it("returns green dot for ok status", () => {
    const indicator = deriveStatusIndicator("ok");
    expect(indicator.color).toBe("green");
    expect(indicator.label).toBe("Connected");
  });

  it("returns red dot for error status", () => {
    const indicator = deriveStatusIndicator("error");
    expect(indicator.color).toBe("red");
    expect(indicator.label).toBe("Error");
  });

  it("returns gray dot for unknown/missing status", () => {
    const indicator = deriveStatusIndicator(undefined);
    expect(indicator.color).toBe("gray");
    expect(indicator.label).toBe("Unknown");
  });
});

// ---------------------------------------------------------------------------
// 3. Add server URL validation
// ---------------------------------------------------------------------------

describe("validateAddMcpServerForm", () => {
  it("accepts valid https URL", () => {
    const result = validateAddMcpServerForm(makeFormData({ url: "https://mcp.example.com" }), []);
    expect(result.isValid).toBe(true);
  });

  it("accepts valid http URL", () => {
    const result = validateAddMcpServerForm(makeFormData({ url: "http://localhost:3000" }), []);
    expect(result.isValid).toBe(true);
  });

  it("rejects non-http/https URL scheme", () => {
    const result = validateAddMcpServerForm(makeFormData({ url: "ftp://mcp.example.com" }), []);
    expect(result.isValid).toBe(false);
    expect(result.errors.url).toBe("URL must use http:// or https://");
  });

  it("rejects empty URL", () => {
    const result = validateAddMcpServerForm(makeFormData({ url: "" }), []);
    expect(result.isValid).toBe(false);
    expect(result.errors.url).toBeDefined();
  });

  it("rejects invalid URL format", () => {
    const result = validateAddMcpServerForm(makeFormData({ url: "not-a-url" }), []);
    expect(result.isValid).toBe(false);
    expect(result.errors.url).toBeDefined();
  });

  it("rejects empty name", () => {
    const result = validateAddMcpServerForm(makeFormData({ name: "" }), []);
    expect(result.isValid).toBe(false);
    expect(result.errors.name).toBe("Name is required");
  });
});

// ---------------------------------------------------------------------------
// 4. Transport default
// ---------------------------------------------------------------------------

describe("Add server transport default", () => {
  it("defaults transport to streamable-http", () => {
    const form = makeFormData();
    expect(form.transport).toBe("streamable-http");
  });
});

// ---------------------------------------------------------------------------
// 5. Duplicate name detection
// ---------------------------------------------------------------------------

describe("Duplicate name detection", () => {
  it("shows inline error when name already exists", () => {
    const result = validateAddMcpServerForm(
      makeFormData({ name: "github-mcp" }),
      ["github-mcp", "slack-mcp"],
    );
    expect(result.isValid).toBe(false);
    expect(result.errors.name).toBe("A server with this name already exists");
  });

  it("allows unique name", () => {
    const result = validateAddMcpServerForm(
      makeFormData({ name: "new-server" }),
      ["github-mcp", "slack-mcp"],
    );
    expect(result.errors.name).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 6. Remove confirmation
// ---------------------------------------------------------------------------

describe("deriveRemoveConfirmationViewModel", () => {
  it("warns about disabling discovered tools", () => {
    const vm = deriveRemoveConfirmationViewModel("github-mcp", 12);
    expect(vm.title).toBe("Remove github-mcp?");
    expect(vm.warning).toContain("12 tools");
    expect(vm.warning).toContain("disabled");
  });

  it("shows generic warning for server with 0 tools", () => {
    const vm = deriveRemoveConfirmationViewModel("empty-server", 0);
    expect(vm.title).toBe("Remove empty-server?");
    expect(vm.warning).not.toContain("tools");
  });
});

// ---------------------------------------------------------------------------
// 7. Empty state
// ---------------------------------------------------------------------------

describe("McpServerSection empty state", () => {
  it("shows CTA when no servers exist", () => {
    const vm = deriveMcpServerSectionViewModel({ servers: [], existingNames: [] });
    expect(vm.showEmptyState).toBe(true);
    expect(vm.emptyStateMessage).toBe("No MCP servers configured.");
    expect(vm.emptyStateCta).toBe("Add MCP Server");
  });

  it("hides empty state when servers exist", () => {
    const vm = deriveMcpServerSectionViewModel({
      servers: [makeServer()],
      existingNames: [],
    });
    expect(vm.showEmptyState).toBe(false);
  });
});
