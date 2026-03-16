/**
 * Unit Tests: Proxy Token Generation (Pure Functions)
 *
 * Tests the pure domain logic for proxy token generation:
 *   - Token format (brp_ prefix + 64 hex chars)
 *   - SHA-256 hashing produces correct hash
 *   - Hash never contains raw token
 *   - TTL computation from days to expiry date
 */
import { describe, expect, it } from "bun:test";
import {
  generateProxyToken,
  hashProxyToken,
  computeExpiresAt,
} from "../../app/src/server/proxy/proxy-token-core";

describe("generateProxyToken", () => {
  it("produces a brp_-prefixed token with 64 hex chars", () => {
    const token = generateProxyToken();
    expect(token).toMatch(/^brp_[0-9a-f]{64}$/);
  });

  it("produces unique tokens on each call", () => {
    const token1 = generateProxyToken();
    const token2 = generateProxyToken();
    expect(token1).not.toBe(token2);
  });
});

describe("hashProxyToken", () => {
  it("returns a 64-char hex string (SHA-256)", () => {
    const token = generateProxyToken();
    const hash = hashProxyToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("never contains the brp_ prefix", () => {
    const token = generateProxyToken();
    const hash = hashProxyToken(token);
    expect(hash).not.toContain("brp_");
  });

  it("produces the same hash for the same input", () => {
    const token = "brp_abc123def456";
    const hash1 = hashProxyToken(token);
    const hash2 = hashProxyToken(token);
    expect(hash1).toBe(hash2);
  });

  it("produces different hashes for different tokens", () => {
    const token1 = generateProxyToken();
    const token2 = generateProxyToken();
    expect(hashProxyToken(token1)).not.toBe(hashProxyToken(token2));
  });
});

describe("computeExpiresAt", () => {
  it("computes expiry 90 days from now by default", () => {
    const now = new Date("2026-03-16T00:00:00Z");
    const expires = computeExpiresAt(90, now);
    const expectedMs = now.getTime() + 90 * 24 * 60 * 60 * 1000;
    expect(expires.getTime()).toBe(expectedMs);
  });

  it("respects custom TTL days", () => {
    const now = new Date("2026-03-16T00:00:00Z");
    const expires = computeExpiresAt(30, now);
    const expectedMs = now.getTime() + 30 * 24 * 60 * 60 * 1000;
    expect(expires.getTime()).toBe(expectedMs);
  });

  it("uses current time when no base time provided", () => {
    const before = Date.now();
    const expires = computeExpiresAt(90);
    const after = Date.now();
    const expectedMin = before + 90 * 24 * 60 * 60 * 1000;
    const expectedMax = after + 90 * 24 * 60 * 60 * 1000;
    expect(expires.getTime()).toBeGreaterThanOrEqual(expectedMin);
    expect(expires.getTime()).toBeLessThanOrEqual(expectedMax);
  });
});
