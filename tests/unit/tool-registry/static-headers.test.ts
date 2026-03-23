/**
 * Unit tests: validateHeaders pure function
 *
 * Validates header entries against:
 *  - Restricted names (Host, Content-Length, Transfer-Encoding, Connection)
 *  - Empty names and values
 *  - Duplicate names (case-insensitive)
 */
import { describe, expect, it } from "bun:test";
import { validateHeaders } from "../../../app/src/server/tool-registry/static-headers";

describe("validateHeaders", () => {
  // -------------------------------------------------------------------------
  // Restricted header names
  // -------------------------------------------------------------------------

  it("rejects restricted header name Host (case-insensitive)", () => {
    const result = validateHeaders([{ name: "Host", value: "evil.com" }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Restricted header name");
  });

  it("rejects restricted header name Content-Length", () => {
    const result = validateHeaders([{ name: "content-length", value: "42" }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Restricted header name");
  });

  it("rejects restricted header name Transfer-Encoding", () => {
    const result = validateHeaders([{ name: "TRANSFER-ENCODING", value: "chunked" }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Restricted header name");
  });

  it("rejects restricted header name Connection", () => {
    const result = validateHeaders([{ name: "connection", value: "keep-alive" }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Restricted header name");
  });

  // -------------------------------------------------------------------------
  // Empty names and values
  // -------------------------------------------------------------------------

  it("rejects empty header name", () => {
    const result = validateHeaders([{ name: "", value: "some-value" }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("empty");
  });

  it("rejects whitespace-only header name", () => {
    const result = validateHeaders([{ name: "   ", value: "some-value" }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("empty");
  });

  it("rejects empty header value", () => {
    const result = validateHeaders([{ name: "X-Custom", value: "" }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("non-empty value");
  });

  // -------------------------------------------------------------------------
  // Duplicate names
  // -------------------------------------------------------------------------

  it("rejects duplicate header names (case-insensitive)", () => {
    const result = validateHeaders([
      { name: "Authorization", value: "Bearer token1" },
      { name: "authorization", value: "Bearer token2" },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Duplicate");
  });

  // -------------------------------------------------------------------------
  // Valid inputs
  // -------------------------------------------------------------------------

  it("accepts valid non-restricted headers", () => {
    const result = validateHeaders([
      { name: "Authorization", value: "Bearer token" },
      { name: "X-API-Key", value: "sk-123" },
    ]);
    expect(result).toEqual({ ok: true });
  });

  it("accepts empty array", () => {
    const result = validateHeaders([]);
    expect(result).toEqual({ ok: true });
  });
});
