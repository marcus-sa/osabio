/**
 * Unit Tests: Tool Injection (proxy/tool-injector.ts)
 *
 * Pure function tests for merging Brain-managed tools into request body tools[].
 * Tests cover: injection, deduplication (runtime wins), empty cases, Anthropic format.
 */
import { describe, expect, it } from "bun:test";
import {
  injectTools,
  type AnthropicTool,
  type ResolvedTool,
} from "../../app/src/server/proxy/tool-injector";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRuntimeTool(name: string): AnthropicTool {
  return {
    name,
    description: `Runtime ${name}`,
    input_schema: { type: "object", properties: { path: { type: "string" } } },
  };
}

function makeResolvedTool(name: string, toolkit = "osabio"): ResolvedTool {
  return {
    name,
    description: `Brain ${name}`,
    input_schema: { type: "object", properties: { query: { type: "string" } } },
    toolkit,
    risk_level: "medium",
  };
}

// ---------------------------------------------------------------------------
// injectTools — pure function
// ---------------------------------------------------------------------------

describe("injectTools", () => {
  it("appends Brain tools after runtime tools when no name collisions", () => {
    const runtimeTools: AnthropicTool[] = [
      makeRuntimeTool("read_file"),
      makeRuntimeTool("write_file"),
    ];
    const resolvedTools: ResolvedTool[] = [
      makeResolvedTool("search_entities"),
      makeResolvedTool("github.create_issue", "github"),
    ];

    const result = injectTools(runtimeTools, resolvedTools);

    expect(result).toHaveLength(4);
    // Runtime tools first, unchanged
    expect(result[0].name).toBe("read_file");
    expect(result[0].description).toBe("Runtime read_file");
    expect(result[1].name).toBe("write_file");
    // Brain tools appended
    expect(result[2].name).toBe("search_entities");
    expect(result[3].name).toBe("github.create_issue");
  });

  it("skips Brain tool when runtime already has same name (runtime wins)", () => {
    const runtimeTools: AnthropicTool[] = [makeRuntimeTool("read_file")];
    const resolvedTools: ResolvedTool[] = [
      makeResolvedTool("read_file"),
      makeResolvedTool("search_entities"),
    ];

    const result = injectTools(runtimeTools, resolvedTools);

    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("read_file");
    expect(result[0].description).toBe("Runtime read_file"); // runtime version, not Brain
    expect(result[1].name).toBe("search_entities");
  });

  it("returns only runtime tools when resolved tools is empty", () => {
    const runtimeTools: AnthropicTool[] = [makeRuntimeTool("read_file")];

    const result = injectTools(runtimeTools, []);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("read_file");
  });

  it("returns only Brain tools when runtime tools is empty", () => {
    const resolvedTools: ResolvedTool[] = [
      makeResolvedTool("search_entities"),
    ];

    const result = injectTools([], resolvedTools);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("search_entities");
  });

  it("returns empty array when both inputs are empty", () => {
    const result = injectTools([], []);
    expect(result).toHaveLength(0);
  });

  it("returns undefined tools as empty when runtime has no tools", () => {
    const resolvedTools: ResolvedTool[] = [
      makeResolvedTool("search_entities"),
    ];

    const result = injectTools(undefined, resolvedTools);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("search_entities");
  });

  it("outputs Anthropic tool format (name, description, input_schema only)", () => {
    const resolvedTools: ResolvedTool[] = [
      makeResolvedTool("search_entities"),
    ];

    const result = injectTools([], resolvedTools);

    const tool = result[0];
    expect(tool).toHaveProperty("name");
    expect(tool).toHaveProperty("description");
    expect(tool).toHaveProperty("input_schema");
    // Should NOT have toolkit or risk_level (those are internal)
    expect(tool).not.toHaveProperty("toolkit");
    expect(tool).not.toHaveProperty("risk_level");
  });
});
