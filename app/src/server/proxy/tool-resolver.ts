/**
 * Tool Resolver — Identity Toolset Resolution
 *
 * Resolves an identity's effective toolset by querying can_use edges in the graph.
 * Uses a per-instance Map-based cache with configurable TTL (not a module-level singleton).
 *
 * Port signature (injectable query):
 *   QueryGrantedTools = (identityId, workspaceId) => Promise<ResolvedTool[]>
 *
 * The query function is injected as a dependency, keeping the resolver pure
 * (aside from the cache, which is an explicit parameter).
 */
import { RecordId, type Surreal } from "surrealdb";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type { ResolvedTool } from "./tool-injector";

/** Resolved tool from can_use graph query. Re-exported from tool-injector. */
import type { ResolvedTool } from "./tool-injector";

/** Port: query function for fetching granted tools from the graph. */
export type QueryGrantedTools = (
  identityId: string,
  workspaceId: string,
) => Promise<ResolvedTool[]>;

/** Cache entry with TTL tracking. */
type CacheEntry = {
  tools: ResolvedTool[];
  populatedAt: number;
};

/** Per-instance cache (Map-based, injected via deps). */
export type ToolResolutionCache = {
  readonly cache: Map<string, CacheEntry>;
  readonly ttlMs: number;
};

// ---------------------------------------------------------------------------
// Cache Factory
// ---------------------------------------------------------------------------

const DEFAULT_TTL_MS = 60_000; // 60 seconds

/**
 * Create a new tool resolution cache instance.
 * Each call returns a fresh Map — no module-level singletons.
 */
export function createToolResolutionCache(
  ttlMs: number = DEFAULT_TTL_MS,
): ToolResolutionCache {
  return {
    cache: new Map(),
    ttlMs,
  };
}

// ---------------------------------------------------------------------------
// Resolver (pure core with injectable query)
// ---------------------------------------------------------------------------

/**
 * Resolve the effective toolset for an identity within a workspace.
 *
 * - Checks cache first (composite key: identityId + workspaceId)
 * - If cache miss or expired, calls the query function and caches the result
 * - Returns ResolvedTool[] (may be empty for identities with no grants)
 */
export async function resolveToolsForIdentity(
  identityId: string,
  workspaceId: string,
  queryGrantedTools: QueryGrantedTools,
  cache: ToolResolutionCache,
): Promise<ResolvedTool[]> {
  const cacheKey = `${identityId}:${workspaceId}`;
  const now = Date.now();

  const cached = cache.cache.get(cacheKey);
  if (cached && now - cached.populatedAt < cache.ttlMs) {
    return cached.tools;
  }

  const tools = await queryGrantedTools(identityId, workspaceId);
  cache.cache.set(cacheKey, { tools, populatedAt: now });

  return tools;
}

// ---------------------------------------------------------------------------
// Adapter: SurrealDB Query Function Factory
// ---------------------------------------------------------------------------

/**
 * Create a QueryGrantedTools function backed by SurrealDB.
 * Queries can_use edges to find active tools granted to the identity.
 */
export function createQueryGrantedTools(surreal: Surreal): QueryGrantedTools {
  return async (identityId: string, workspaceId: string): Promise<ResolvedTool[]> => {
    const identityRecord = new RecordId("identity", identityId);
    const workspaceRecord = new RecordId("workspace", workspaceId);

    type ToolRow = {
      name: string;
      description: string;
      input_schema: Record<string, unknown>;
      output_schema?: Record<string, unknown>;
      toolkit: string;
      risk_level: string;
      source_server_id?: string;
    };

    const results = await surreal.query<[ToolRow[]]>(
      `SELECT out.name AS name, out.description AS description, out.input_schema AS input_schema, out.output_schema AS output_schema, out.toolkit AS toolkit, out.risk_level AS risk_level, out.source_server.id AS source_server_id
       FROM can_use
       WHERE in = $identity AND out.status = 'active' AND out.workspace = $workspace;`,
      { identity: identityRecord, workspace: workspaceRecord },
    );

    return (results[0] ?? []).map((row) => ({
      name: row.name,
      description: row.description,
      input_schema: row.input_schema,
      output_schema: row.output_schema,
      toolkit: row.toolkit,
      risk_level: row.risk_level,
      source_server_id: row.source_server_id,
    }));
  };
}
