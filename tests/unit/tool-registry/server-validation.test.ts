/**
 * Unit tests for MCP server URL and transport validation (pure functions).
 */
import { describe, expect, it } from "bun:test";
import {
  validateMcpServerUrl,
  validateMcpServerTransport,
} from "../../../app/src/server/tool-registry/server-validation";

describe("validateMcpServerUrl", () => {
  it("accepts https URL", () => {
    const result = validateMcpServerUrl("https://mcp.acme.dev/github");
    expect(result.ok).toBe(true);
  });

  it("accepts http URL", () => {
    const result = validateMcpServerUrl("http://localhost:3000/mcp");
    expect(result.ok).toBe(true);
  });

  it("rejects file:// scheme", () => {
    const result = validateMcpServerUrl("file:///etc/passwd");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("url");
    }
  });

  it("rejects javascript: scheme", () => {
    const result = validateMcpServerUrl("javascript:alert(1)");
    expect(result.ok).toBe(false);
  });

  it("rejects ftp:// scheme", () => {
    const result = validateMcpServerUrl("ftp://files.example.com/tools");
    expect(result.ok).toBe(false);
  });

  it("rejects empty URL", () => {
    const result = validateMcpServerUrl("");
    expect(result.ok).toBe(false);
  });

  it("rejects malformed URL", () => {
    const result = validateMcpServerUrl("not-a-url");
    expect(result.ok).toBe(false);
  });
});

describe("validateMcpServerTransport", () => {
  it("accepts streamable-http", () => {
    const result = validateMcpServerTransport("streamable-http");
    expect(result.ok).toBe(true);
  });

  it("accepts sse", () => {
    const result = validateMcpServerTransport("sse");
    expect(result.ok).toBe(true);
  });

  it("rejects invalid transport", () => {
    const result = validateMcpServerTransport("websocket");
    expect(result.ok).toBe(false);
  });
});
