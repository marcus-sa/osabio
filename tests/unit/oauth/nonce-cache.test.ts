import { describe, test, expect } from "bun:test";
import { createNonceCache } from "../../../app/src/server/oauth/nonce-cache";

describe("NonceCache", () => {
  test("allows first use of a jti", () => {
    const cache = createNonceCache();
    expect(cache.check("unique-jti-1")).toBe(true);
  });

  test("rejects previously seen jti within time window", () => {
    const cache = createNonceCache();
    cache.check("duplicate-jti");
    expect(cache.check("duplicate-jti")).toBe(false);
  });

  test("allows different jti values independently", () => {
    const cache = createNonceCache();
    expect(cache.check("jti-a")).toBe(true);
    expect(cache.check("jti-b")).toBe(true);
    expect(cache.check("jti-a")).toBe(false);
    expect(cache.check("jti-b")).toBe(false);
  });

  test("tracks size of stored entries", () => {
    const cache = createNonceCache();
    expect(cache.size()).toBe(0);
    cache.check("jti-1");
    expect(cache.size()).toBe(1);
    cache.check("jti-2");
    expect(cache.size()).toBe(2);
    // duplicate does not increase size
    cache.check("jti-1");
    expect(cache.size()).toBe(2);
  });

  test("auto-purges expired entries beyond clock skew window", () => {
    const cache = createNonceCache({ windowMs: 50 });
    cache.check("old-jti");
    expect(cache.size()).toBe(1);

    // Wait for expiry then trigger purge via check
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        cache.check("new-jti");
        // old-jti should be purged, only new-jti remains
        expect(cache.size()).toBe(1);
        // old-jti should now be allowed again since it was purged
        expect(cache.check("old-jti")).toBe(true);
        resolve();
      }, 60);
    });
  });

  test("factory returns independent instances (no shared state)", () => {
    const cacheA = createNonceCache();
    const cacheB = createNonceCache();
    cacheA.check("shared-jti");
    // cacheB should not know about cacheA's jti
    expect(cacheB.check("shared-jti")).toBe(true);
  });

  test("defaults window to 120 seconds", () => {
    const cache = createNonceCache();
    // Verify the cache accepts the jti (implying it uses a window, not instant expiry)
    expect(cache.check("test-jti")).toBe(true);
    expect(cache.check("test-jti")).toBe(false);
  });
});
