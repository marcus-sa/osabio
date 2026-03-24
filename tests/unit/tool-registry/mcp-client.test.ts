/**
 * Unit tests for MCP client module.
 *
 * Tests pure functions: buildAuthHeaders, createTransport.
 * Tests McpClientFactory type exists and is correctly shaped.
 */
import { describe, expect, it } from "bun:test";
import {
  buildAuthHeaders,
  createTransport,
  type McpClientFactory,
  type McpConnectionResult,
  type ToolListResult,
  type CallToolResult,
} from "../../../app/src/server/tool-registry/mcp-client";

// ---------------------------------------------------------------------------
// buildAuthHeaders: pure function mapping credential shape to HTTP headers
// ---------------------------------------------------------------------------

describe("buildAuthHeaders", () => {
  it("returns empty headers when no headers provided", () => {
    const result = buildAuthHeaders();
    expect(result).toEqual({});
  });

  it("passes through arbitrary headers as-is", () => {
    const headers = {
      Authorization: "Bearer sk-test-123",
      "X-Custom-Header": "custom-value",
    };
    const result = buildAuthHeaders(headers);
    expect(result).toEqual(headers);
  });

  it("preserves api_key header format", () => {
    const headers = { "X-API-Key": "my-api-key-value" };
    const result = buildAuthHeaders(headers);
    expect(result).toEqual({ "X-API-Key": "my-api-key-value" });
  });

  it("preserves bearer token format", () => {
    const headers = { Authorization: "Bearer my-token" };
    const result = buildAuthHeaders(headers);
    expect(result).toEqual({ Authorization: "Bearer my-token" });
  });

  it("preserves basic auth format", () => {
    const headers = { Authorization: "Basic dXNlcjpwYXNz" };
    const result = buildAuthHeaders(headers);
    expect(result).toEqual({ Authorization: "Basic dXNlcjpwYXNz" });
  });
});

// ---------------------------------------------------------------------------
// createTransport: transport selection based on type string
// ---------------------------------------------------------------------------

describe("createTransport", () => {
  it("creates SSE transport for 'sse' type", () => {
    const transport = createTransport(
      "https://mcp.example.com/sse",
      "sse",
      { Authorization: "Bearer test" },
    );
    // SSEClientTransport is the returned type -- verify it has transport interface
    expect(transport).toBeDefined();
    expect(typeof transport.start).toBe("function");
    expect(typeof transport.close).toBe("function");
    expect(typeof transport.send).toBe("function");
  });

  it("creates StreamableHTTP transport for 'streamable-http' type", () => {
    const transport = createTransport(
      "https://mcp.example.com/mcp",
      "streamable-http",
      { Authorization: "Bearer test" },
    );
    expect(transport).toBeDefined();
    expect(typeof transport.start).toBe("function");
    expect(typeof transport.close).toBe("function");
    expect(typeof transport.send).toBe("function");
  });

  it("creates transport without auth headers when none provided", () => {
    const transport = createTransport(
      "https://mcp.example.com/mcp",
      "streamable-http",
    );
    expect(transport).toBeDefined();
    expect(typeof transport.start).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// McpClientFactory type shape verification
// ---------------------------------------------------------------------------

describe("McpClientFactory type", () => {
  it("has the expected function signatures", () => {
    // Type-level test: verify the factory shape compiles correctly
    const factory: McpClientFactory = {
      connect: async (_url, _transport, _headers) => {
        return {} as McpConnectionResult;
      },
      fetchToolList: async (_client) => {
        return { tools: [] } as ToolListResult;
      },
      callTool: async (_client, _name, _args) => {
        return { content: [] } as CallToolResult;
      },
      disconnect: async (_client) => {},
    };

    expect(typeof factory.connect).toBe("function");
    expect(typeof factory.fetchToolList).toBe("function");
    expect(typeof factory.callTool).toBe("function");
    expect(typeof factory.disconnect).toBe("function");
  });
});
