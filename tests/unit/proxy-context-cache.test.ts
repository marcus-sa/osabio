/**
 * Unit Tests: Context Cache (Step 03-02)
 *
 * Tests for in-memory TTL cache of workspace context candidate pools.
 * The cache is NOT a module-level singleton -- it is created per proxy
 * handler instance and passed via dependency injection.
 */
import { describe, expect, it } from "bun:test";
import {
  createContextCache,
  type ContextCache,
  type CachedCandidatePool,
} from "../../app/src/server/proxy/context-cache";

// ---------------------------------------------------------------------------
// createContextCache: factory function
// ---------------------------------------------------------------------------
describe("createContextCache", () => {
  it("creates a cache with get/set/has operations", () => {
    const cache = createContextCache(300);
    expect(cache).toBeDefined();
    expect(typeof cache.get).toBe("function");
    expect(typeof cache.set).toBe("function");
    expect(typeof cache.has).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// Cache hit and miss behavior
// ---------------------------------------------------------------------------
describe("cache operations", () => {
  it("returns undefined for cache miss", () => {
    const cache = createContextCache(300);
    expect(cache.get("nonexistent")).toBeUndefined();
  });

  it("returns cached pool for cache hit", () => {
    const cache = createContextCache(300);
    const pool: CachedCandidatePool = {
      decisions: [{ id: "d1", type: "decision", text: "Use tRPC", weight: 1.0 }],
      learnings: [],
      observations: [],
      populatedAt: Date.now(),
    };

    cache.set("ws-123", pool);

    const result = cache.get("ws-123");
    expect(result).toBeDefined();
    expect(result!.decisions.length).toBe(1);
    expect(result!.decisions[0].text).toBe("Use tRPC");
  });

  it("has() returns true for cached entry within TTL", () => {
    const cache = createContextCache(300);
    const pool: CachedCandidatePool = {
      decisions: [],
      learnings: [],
      observations: [],
      populatedAt: Date.now(),
    };

    cache.set("ws-123", pool);
    expect(cache.has("ws-123")).toBe(true);
    expect(cache.has("ws-456")).toBe(false);
  });

  it("returns undefined for expired entries", () => {
    const cache = createContextCache(1); // 1 second TTL
    const pool: CachedCandidatePool = {
      decisions: [],
      learnings: [],
      observations: [],
      populatedAt: Date.now() - 2000, // 2 seconds ago (expired)
    };

    cache.set("ws-123", pool);

    // Should be expired
    expect(cache.get("ws-123")).toBeUndefined();
    expect(cache.has("ws-123")).toBe(false);
  });
});
