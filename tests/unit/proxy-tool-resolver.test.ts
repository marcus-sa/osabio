/**
 * Unit Tests: Tool Resolver (proxy/tool-resolver.ts)
 *
 * Tests for resolving an identity's effective toolset via can_use edges.
 * Uses injectable query function (pure core pattern) to avoid DB dependency.
 */
import { describe, expect, it } from "bun:test";
import {
  resolveToolsForIdentity,
  createToolResolutionCache,
  type ResolvedTool,
  type ToolResolutionCache,
  type QueryGrantedTools,
} from "../../app/src/server/proxy/tool-resolver";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeTool(name: string, toolkit = "brain"): ResolvedTool {
  return {
    name,
    description: `${toolkit} ${name}`,
    input_schema: { type: "object", properties: { query: { type: "string" } } },
    toolkit,
    risk_level: "medium",
  };
}

function createStubQuery(tools: ResolvedTool[]): QueryGrantedTools {
  return async (_identityId: string, _workspaceId: string) => tools;
}

function createCountingQuery(tools: ResolvedTool[]): { query: QueryGrantedTools; callCount: () => number } {
  let count = 0;
  return {
    query: async (_identityId: string, _workspaceId: string) => {
      count++;
      return tools;
    },
    callCount: () => count,
  };
}

// ---------------------------------------------------------------------------
// resolveToolsForIdentity
// ---------------------------------------------------------------------------

describe("resolveToolsForIdentity", () => {
  it("returns tools from query when cache is empty", async () => {
    const tools = [makeTool("search_entities"), makeTool("github.create_issue", "github")];
    const query = createStubQuery(tools);
    const cache = createToolResolutionCache();

    const result = await resolveToolsForIdentity("identity-1", "workspace-1", query, cache);

    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("search_entities");
    expect(result[1].name).toBe("github.create_issue");
  });

  it("returns cached result on second call within TTL", async () => {
    const tools = [makeTool("search_entities")];
    const { query, callCount } = createCountingQuery(tools);
    const cache = createToolResolutionCache(60_000);

    await resolveToolsForIdentity("id-1", "ws-1", query, cache);
    const result = await resolveToolsForIdentity("id-1", "ws-1", query, cache);

    expect(result).toHaveLength(1);
    expect(callCount()).toBe(1); // Only queried once
  });

  it("re-queries after TTL expires", async () => {
    const tools = [makeTool("search_entities")];
    const { query, callCount } = createCountingQuery(tools);
    const cache = createToolResolutionCache(0); // 0ms TTL = always expired

    await resolveToolsForIdentity("id-1", "ws-1", query, cache);
    await resolveToolsForIdentity("id-1", "ws-1", query, cache);

    expect(callCount()).toBe(2); // Queried twice because TTL=0
  });

  it("returns empty array when identity has no grants", async () => {
    const query = createStubQuery([]);
    const cache = createToolResolutionCache();

    const result = await resolveToolsForIdentity("id-no-grants", "ws-1", query, cache);

    expect(result).toHaveLength(0);
  });

  it("uses composite cache key of identity + workspace", async () => {
    const toolsA = [makeTool("tool_a")];
    const toolsB = [makeTool("tool_b")];
    let callIdx = 0;
    const query: QueryGrantedTools = async () => {
      callIdx++;
      return callIdx === 1 ? toolsA : toolsB;
    };
    const cache = createToolResolutionCache(60_000);

    const resultA = await resolveToolsForIdentity("id-1", "ws-1", query, cache);
    const resultB = await resolveToolsForIdentity("id-1", "ws-2", query, cache);

    expect(resultA[0].name).toBe("tool_a");
    expect(resultB[0].name).toBe("tool_b");
  });
});

// ---------------------------------------------------------------------------
// createToolResolutionCache
// ---------------------------------------------------------------------------

describe("createToolResolutionCache", () => {
  it("creates a Map-based cache (not module-level singleton)", () => {
    const cache1 = createToolResolutionCache();
    const cache2 = createToolResolutionCache();

    // Different instances
    expect(cache1).not.toBe(cache2);
  });
});
