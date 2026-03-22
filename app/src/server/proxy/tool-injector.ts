/**
 * Tool Injector — Pure Function
 *
 * Merges Brain-managed tool definitions into the LLM request body's tools[].
 * Runtime tools are preserved unmodified; Brain tools are appended after.
 * When a name collision occurs, the runtime version takes precedence (Brain tool skipped).
 *
 * Step 7.5 in the proxy pipeline (between context injection and forwarding).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Anthropic tool format (the shape expected by the Messages API). */
export type AnthropicTool = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

/** Resolved tool from Brain's can_use graph query (internal, richer than Anthropic format). */
export type ResolvedTool = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  toolkit: string;
  risk_level: string;
};

// ---------------------------------------------------------------------------
// Pure Function: injectTools
// ---------------------------------------------------------------------------

/**
 * Merge Brain-managed tools into the request's tool list.
 *
 * - Runtime tools are preserved first, unmodified.
 * - Brain tools are appended, but only if no runtime tool shares the same name.
 * - Output is in Anthropic tool format (name, description, input_schema only).
 *
 * @param runtimeTools - Tools already in the request body (may be undefined)
 * @param resolvedTools - Brain-managed tools resolved from can_use edges
 * @returns Merged tool list in Anthropic format
 */
export function injectTools(
  runtimeTools: AnthropicTool[] | undefined,
  resolvedTools: ResolvedTool[],
): AnthropicTool[] {
  const existing = runtimeTools ?? [];

  if (resolvedTools.length === 0) {
    return [...existing];
  }

  const runtimeNames = new Set(existing.map((tool) => tool.name));

  const brainToolsToInject: AnthropicTool[] = resolvedTools
    .filter((tool) => !runtimeNames.has(tool.name))
    .map(toAnthropicFormat);

  return [...existing, ...brainToolsToInject];
}

// ---------------------------------------------------------------------------
// Internal: Format Conversion
// ---------------------------------------------------------------------------

/** Strip internal fields (toolkit, risk_level) to produce Anthropic-compatible tool. */
function toAnthropicFormat(tool: ResolvedTool): AnthropicTool {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.input_schema,
  };
}
