/**
 * Context Cache -- In-memory TTL cache for workspace candidate pools
 *
 * Stores workspace context candidates (decisions, learnings, observations)
 * with embeddings. Refreshed on TTL expiry. NOT a module-level singleton --
 * created per proxy handler instance via createContextCache().
 *
 * Port: createContextCache(ttlSeconds) -> ContextCache
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CandidateItem = {
  readonly id: string;
  readonly type: "decision" | "learning" | "observation";
  readonly text: string;
  readonly weight: number;
};

export type CachedCandidatePool = {
  readonly decisions: CandidateItem[];
  readonly learnings: CandidateItem[];
  readonly observations: CandidateItem[];
  readonly populatedAt: number;
  readonly enforcementMode?: string;
};

export type ContextCache = {
  get(workspaceId: string): CachedCandidatePool | undefined;
  set(workspaceId: string, pool: CachedCandidatePool): void;
  has(workspaceId: string): boolean;
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createContextCache(ttlSeconds: number): ContextCache {
  // Per-handler-instance cache (created via factory in createAnthropicProxyHandler).
  // TTL provides eventual consistency with the graph — stale reads are acceptable
  // since context injection is best-effort. Cache stampede on cold start is fine:
  // concurrent requests for the same workspace may each populate, but the last
  // write wins and subsequent reads serve from cache. Workspace cardinality is
  // low enough that unbounded Map growth is not a concern.
  const store = new Map<string, CachedCandidatePool>();
  const ttlMs = ttlSeconds * 1000;

  function isExpired(pool: CachedCandidatePool): boolean {
    return Date.now() - pool.populatedAt > ttlMs;
  }

  return {
    get(workspaceId: string): CachedCandidatePool | undefined {
      const cached = store.get(workspaceId);
      if (!cached) return undefined;
      if (isExpired(cached)) {
        store.delete(workspaceId);
        return undefined;
      }
      return cached;
    },

    set(workspaceId: string, pool: CachedCandidatePool): void {
      store.set(workspaceId, pool);
    },

    has(workspaceId: string): boolean {
      const cached = store.get(workspaceId);
      if (!cached) return false;
      if (isExpired(cached)) {
        store.delete(workspaceId);
        return false;
      }
      return true;
    },
  };
}
