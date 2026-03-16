/**
 * Unit Tests: Rate Limiter (pure in-memory sliding window)
 *
 * Tests the rate limiter as a pure function with injectable time.
 * No IO, no mocks. Verifies sliding window behavior, pruning, and edge cases.
 */
import { describe, expect, it } from "bun:test";
import {
  createRateLimiterState,
  checkRateLimit,
  pruneStaleEntries,
} from "../../app/src/server/proxy/rate-limiter";

describe("Rate Limiter", () => {
  describe("checkRateLimit", () => {
    it("allows requests under the limit", () => {
      const state = createRateLimiterState(5);
      const now = 1000000;

      const result = checkRateLimit(state, "ws-1", now);
      expect(result.allowed).toBe(true);
    });

    it("denies requests at the limit", () => {
      const state = createRateLimiterState(3);
      const now = 1000000;

      // Fill up to limit
      checkRateLimit(state, "ws-1", now);
      checkRateLimit(state, "ws-1", now + 100);
      checkRateLimit(state, "ws-1", now + 200);

      // 4th request should be denied
      const result = checkRateLimit(state, "ws-1", now + 300);
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.rateLimitPerMinute).toBe(3);
        expect(result.retryAfterSeconds).toBeGreaterThan(0);
        expect(result.resetTimeUnix).toBeGreaterThan(0);
      }
    });

    it("allows requests after window slides", () => {
      const state = createRateLimiterState(2);
      const now = 1000000;

      checkRateLimit(state, "ws-1", now);
      checkRateLimit(state, "ws-1", now + 100);

      // At limit
      const denied = checkRateLimit(state, "ws-1", now + 200);
      expect(denied.allowed).toBe(false);

      // After 60s, window slides - oldest entry expires
      const afterWindow = now + 61_000;
      const allowed = checkRateLimit(state, "ws-1", afterWindow);
      expect(allowed.allowed).toBe(true);
    });

    it("tracks workspaces independently", () => {
      const state = createRateLimiterState(2);
      const now = 1000000;

      checkRateLimit(state, "ws-1", now);
      checkRateLimit(state, "ws-1", now + 100);

      // ws-1 is at limit
      const ws1Result = checkRateLimit(state, "ws-1", now + 200);
      expect(ws1Result.allowed).toBe(false);

      // ws-2 should still be allowed
      const ws2Result = checkRateLimit(state, "ws-2", now + 200);
      expect(ws2Result.allowed).toBe(true);
    });

    it("returns retry-after based on oldest timestamp in window", () => {
      const state = createRateLimiterState(2);
      const now = 1000000;

      checkRateLimit(state, "ws-1", now);
      checkRateLimit(state, "ws-1", now + 10_000);

      const result = checkRateLimit(state, "ws-1", now + 20_000);
      if (!result.allowed) {
        // Earliest timestamp is `now`, window is 60s, so reset is at now + 60s
        // retry-after = (now + 60_000 - (now + 20_000)) / 1000 = 40s
        expect(result.retryAfterSeconds).toBe(40);
      }
    });
  });

  describe("pruneStaleEntries", () => {
    it("removes entries with no recent timestamps", () => {
      const state = createRateLimiterState(10);
      const now = 1000000;

      checkRateLimit(state, "ws-old", now);
      checkRateLimit(state, "ws-recent", now + 200_000);

      // Prune at time well past ws-old's window
      const pruned = pruneStaleEntries(state, now + 200_000);
      expect(pruned).toBe(1);
      expect(state.windows.has("ws-old")).toBe(false);
      expect(state.windows.has("ws-recent")).toBe(true);
    });

    it("returns 0 when nothing to prune", () => {
      const state = createRateLimiterState(10);
      const now = 1000000;

      checkRateLimit(state, "ws-1", now);
      const pruned = pruneStaleEntries(state, now);
      expect(pruned).toBe(0);
    });
  });
});
