/**
 * Rate Limiter — In-memory sliding window counter per workspace
 *
 * Pure functional design: the rate limiter state is passed as a parameter
 * (no module-level singletons). Each proxy handler instance owns its
 * rate limiter state via closure.
 *
 * Port: (workspaceId: string, now?: number) -> RateLimitResult
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RateLimitResult =
  | { allowed: true }
  | {
      allowed: false;
      retryAfterSeconds: number;
      resetTimeUnix: number;
      rateLimitPerMinute: number;
    };

type WindowEntry = {
  timestamps: number[];
};

export type RateLimiterState = {
  windows: Map<string, WindowEntry>;
  limitPerMinute: number;
  windowMs: number;
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createRateLimiterState(
  limitPerMinute: number = 60,
): RateLimiterState {
  return {
    windows: new Map(),
    limitPerMinute,
    windowMs: 60_000,
  };
}

// ---------------------------------------------------------------------------
// Pure check + mutate (single atomic operation)
// ---------------------------------------------------------------------------

/**
 * Check whether a request from the given workspace is within the rate limit.
 * Mutates state in-place for performance (sliding window timestamps).
 * Returns whether the request is allowed, and retry guidance if not.
 */
export function checkRateLimit(
  state: RateLimiterState,
  workspaceId: string,
  now: number = Date.now(),
): RateLimitResult {
  const cutoff = now - state.windowMs;

  let entry = state.windows.get(workspaceId);
  if (!entry) {
    entry = { timestamps: [] };
    state.windows.set(workspaceId, entry);
  }

  // Prune expired timestamps
  entry.timestamps = entry.timestamps.filter((t) => t > cutoff);

  if (entry.timestamps.length >= state.limitPerMinute) {
    // Find earliest timestamp in window to compute retry-after
    const earliest = entry.timestamps[0];
    const resetTimeMs = earliest + state.windowMs;
    const retryAfterSeconds = Math.ceil((resetTimeMs - now) / 1000);

    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, retryAfterSeconds),
      resetTimeUnix: Math.ceil(resetTimeMs / 1000),
      rateLimitPerMinute: state.limitPerMinute,
    };
  }

  // Record this request
  entry.timestamps.push(now);

  return { allowed: true };
}

// ---------------------------------------------------------------------------
// Cleanup (call periodically to prevent memory leak)
// ---------------------------------------------------------------------------

/**
 * Remove workspace entries that have no recent timestamps.
 * Should be called periodically (e.g., every 5 minutes).
 */
export function pruneStaleEntries(
  state: RateLimiterState,
  now: number = Date.now(),
): number {
  const cutoff = now - state.windowMs * 2; // 2x window for safety
  let pruned = 0;

  for (const [workspaceId, entry] of state.windows) {
    const latest = entry.timestamps[entry.timestamps.length - 1];
    if (!latest || latest < cutoff) {
      state.windows.delete(workspaceId);
      pruned++;
    }
  }

  return pruned;
}
