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
  readonly embedding?: number[];
};

export type CachedCandidatePool = {
  readonly decisions: CandidateItem[];
  readonly learnings: CandidateItem[];
  readonly observations: CandidateItem[];
  readonly populatedAt: number;
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
