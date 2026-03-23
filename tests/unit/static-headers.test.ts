/**
 * Unit tests for static-headers module.
 *
 * Pure functions: validateHeaders, buildHeaderMap
 * Effect shell: encryptHeaders, decryptHeaders (roundtrip via real encryption)
 */
import { describe, expect, it } from "bun:test";
import {
  validateHeaders,
  buildHeaderMap,
  encryptHeaders,
  decryptHeaders,
} from "../../app/src/server/tool-registry/static-headers";
import type { HeaderEntry } from "../../app/src/server/tool-registry/types";

/** 256-bit test key (64 hex chars). */
const TEST_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

// ---------------------------------------------------------------------------
// validateHeaders (pure)
// ---------------------------------------------------------------------------

describe("validateHeaders", () => {
  it("accepts valid headers", () => {
    const headers: HeaderEntry[] = [
      { name: "Authorization", value: "Bearer token123" },
      { name: "X-API-Key", value: "sk-abc" },
    ];
    const result = validateHeaders(headers);
    expect(result.ok).toBe(true);
  });

  it("rejects restricted header name Host", () => {
    const headers: HeaderEntry[] = [{ name: "Host", value: "evil.com" }];
    const result = validateHeaders(headers);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Host");
    }
  });

  it("rejects restricted header name Content-Length (case-insensitive)", () => {
    const headers: HeaderEntry[] = [{ name: "content-length", value: "42" }];
    const result = validateHeaders(headers);
    expect(result.ok).toBe(false);
  });

  it("rejects restricted header name Transfer-Encoding", () => {
    const headers: HeaderEntry[] = [{ name: "Transfer-Encoding", value: "chunked" }];
    const result = validateHeaders(headers);
    expect(result.ok).toBe(false);
  });

  it("rejects restricted header name Connection", () => {
    const headers: HeaderEntry[] = [{ name: "Connection", value: "keep-alive" }];
    const result = validateHeaders(headers);
    expect(result.ok).toBe(false);
  });

  it("rejects empty header name", () => {
    const headers: HeaderEntry[] = [{ name: "", value: "val" }];
    const result = validateHeaders(headers);
    expect(result.ok).toBe(false);
  });

  it("rejects empty header value", () => {
    const headers: HeaderEntry[] = [{ name: "X-Key", value: "" }];
    const result = validateHeaders(headers);
    expect(result.ok).toBe(false);
  });

  it("rejects duplicate header names (case-insensitive)", () => {
    const headers: HeaderEntry[] = [
      { name: "Authorization", value: "Bearer a" },
      { name: "authorization", value: "Bearer b" },
    ];
    const result = validateHeaders(headers);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Duplicate");
    }
  });

  it("accepts empty array", () => {
    const result = validateHeaders([]);
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildHeaderMap (pure)
// ---------------------------------------------------------------------------

describe("buildHeaderMap", () => {
  it("converts header entries to a plain object", () => {
    const headers: HeaderEntry[] = [
      { name: "Authorization", value: "Bearer tok" },
      { name: "X-Custom", value: "val" },
    ];
    const map = buildHeaderMap(headers);
    expect(map).toEqual({
      Authorization: "Bearer tok",
      "X-Custom": "val",
    });
  });

  it("returns empty object for empty array", () => {
    expect(buildHeaderMap([])).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// encryptHeaders / decryptHeaders (effect shell -- roundtrip)
// ---------------------------------------------------------------------------

describe("encryptHeaders roundtrip", () => {
  it("encrypts and decrypts back to original values", () => {
    const headers: HeaderEntry[] = [
      { name: "Authorization", value: "Bearer secret_token_value" },
      { name: "X-API-Key", value: "sk-supersecret" },
    ];

    const encrypted = encryptHeaders(headers, TEST_KEY);

    // Encrypted entries preserve name but have value_encrypted instead of value
    expect(encrypted).toHaveLength(2);
    expect(encrypted[0].name).toBe("Authorization");
    expect(encrypted[0].value_encrypted).toBeDefined();
    expect(encrypted[0].value_encrypted).not.toBe("Bearer secret_token_value");

    expect(encrypted[1].name).toBe("X-API-Key");
    expect(encrypted[1].value_encrypted).not.toBe("sk-supersecret");

    // Decrypt roundtrip
    const decrypted = decryptHeaders(encrypted, TEST_KEY);
    expect(decrypted).toEqual(headers);
  });

  it("produces different ciphertext for same plaintext (unique IV per encryption)", () => {
    const headers: HeaderEntry[] = [{ name: "Auth", value: "same-value" }];

    const enc1 = encryptHeaders(headers, TEST_KEY);
    const enc2 = encryptHeaders(headers, TEST_KEY);

    expect(enc1[0].value_encrypted).not.toBe(enc2[0].value_encrypted);
  });

  it("ciphertext does not contain original plaintext", () => {
    const headers: HeaderEntry[] = [
      { name: "Authorization", value: "Bearer secret_token_value" },
    ];

    const encrypted = encryptHeaders(headers, TEST_KEY);
    expect(encrypted[0].value_encrypted).not.toContain("secret_token_value");
  });
});
