/**
 * Nonce Cache for DPoP Replay Protection
 *
 * Time-windowed set storing seen jti values with timestamps.
 * Factory function returns injectable instance -- no module singleton.
 * Auto-expires entries beyond clock skew window on each check.
 *
 * Pure domain module -- no IO imports.
 */

export type NonceCache = {
  /** Returns true if jti is new (allowed), false if replay (reject). */
  check(jti: string): boolean;
  /** Number of tracked (non-expired) entries. */
  size(): number;
};

type NonceCacheOptions = {
  /** Time window in milliseconds. Default: 120_000 (2 minutes). */
  windowMs?: number;
};

const DEFAULT_WINDOW_MS = 120_000;

export function createNonceCache(options?: NonceCacheOptions): NonceCache {
  const windowMs = options?.windowMs ?? DEFAULT_WINDOW_MS;
  const seen = new Map<string, number>();

  const purgeExpired = (now: number): void => {
    const cutoff = now - windowMs;
    for (const [key, timestamp] of seen) {
      if (timestamp <= cutoff) {
        seen.delete(key);
      }
    }
  };

  return {
    check(jti: string): boolean {
      const now = Date.now();
      purgeExpired(now);

      if (seen.has(jti)) {
        return false;
      }

      seen.set(jti, now);
      return true;
    },

    size(): number {
      return seen.size;
    },
  };
}
