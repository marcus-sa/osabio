/**
 * Unit tests for resolveAuthForMcpServer.
 *
 * Pure function: McpServerRecord + encryptionKey -> Record<string, string>
 * No DB access. Dispatches by auth_mode and decrypts static headers.
 */
import { describe, expect, it } from "bun:test";
import { resolveAuthForMcpServer } from "../../../app/src/server/proxy/credential-resolver";
import { encryptHeaders } from "../../../app/src/server/tool-registry/static-headers";
import type { McpServerRecord, EncryptedHeaderEntry } from "../../../app/src/server/tool-registry/types";
import { RecordId } from "surrealdb";

const TEST_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

function makeFakeServer(overrides: Partial<McpServerRecord> = {}): McpServerRecord {
  return {
    id: new RecordId("mcp_server", "test-server"),
    name: "test",
    url: "https://mcp.example.com",
    transport: "streamable-http",
    workspace: new RecordId("workspace", "ws-1"),
    auth_mode: "none",
    tool_count: 0,
    created_at: new Date(),
    ...overrides,
  };
}

describe("resolveAuthForMcpServer", () => {
  it("returns empty headers for auth_mode none", () => {
    const server = makeFakeServer({ auth_mode: "none" });
    const result = resolveAuthForMcpServer(server, TEST_KEY);
    expect(result).toEqual({});
  });

  it("decrypts and returns headers for auth_mode static_headers", () => {
    const encrypted = encryptHeaders(
      [{ name: "Authorization", value: "Bearer ghp_secret" }],
      TEST_KEY,
    );
    const server = makeFakeServer({
      auth_mode: "static_headers",
      static_headers: encrypted,
    });

    const result = resolveAuthForMcpServer(server, TEST_KEY);
    expect(result).toEqual({ Authorization: "Bearer ghp_secret" });
  });

  it("returns empty headers when static_headers mode has no stored headers", () => {
    const server = makeFakeServer({
      auth_mode: "static_headers",
      // no static_headers field
    });
    const result = resolveAuthForMcpServer(server, TEST_KEY);
    expect(result).toEqual({});
  });

  it("decrypts multiple headers", () => {
    const encrypted = encryptHeaders(
      [
        { name: "Authorization", value: "Bearer token123" },
        { name: "X-Custom-Key", value: "custom-value" },
      ],
      TEST_KEY,
    );
    const server = makeFakeServer({
      auth_mode: "static_headers",
      static_headers: encrypted,
    });

    const result = resolveAuthForMcpServer(server, TEST_KEY);
    expect(result).toEqual({
      Authorization: "Bearer token123",
      "X-Custom-Key": "custom-value",
    });
  });
});
