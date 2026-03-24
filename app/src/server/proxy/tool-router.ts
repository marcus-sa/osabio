/**
 * Tool Router -- Pure Function
 *
 * Classifies tool_use blocks from Anthropic responses as brain-native, integration,
 * or unknown based on the resolved toolset from step 7.5.
 *
 * Pure: no side effects, no IO imports. Takes data in, returns classification out.
 *
 * Step 8.5 in the proxy pipeline (between response read and client return).
 */
import type { ResolvedTool } from "./tool-injector";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Anthropic tool_use content block from a Messages API response. */
export type ToolUseBlock = {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
};

/** Classification result for a single tool_use block. */
export type ClassifiedToolCall =
  | { classification: "brain-native"; toolUse: ToolUseBlock; resolvedTool: ResolvedTool }
  | { classification: "integration"; toolUse: ToolUseBlock; resolvedTool: ResolvedTool }
  | { classification: "unknown"; toolUse: ToolUseBlock };

/** Classification summary for all tool_use blocks in a response. */
export type ToolRoutingResult = {
  readonly classified: ClassifiedToolCall[];
  readonly hasBrainNative: boolean;
  readonly allUnknown: boolean;
};

// ---------------------------------------------------------------------------
// Pure Function: classifyToolCalls
// ---------------------------------------------------------------------------

/**
 * Classify an array of tool_use blocks against the resolved toolset.
 *
 * - toolkit === "brain" -> brain-native (executed locally via graph queries)
 * - toolkit present but not "brain" -> integration (needs credential brokerage)
 * - not found in resolvedTools -> unknown (pass through to runtime)
 */
export function classifyToolCalls(
  toolUseBlocks: ToolUseBlock[],
  resolvedTools: ResolvedTool[],
): ToolRoutingResult {
  const toolsByName = new Map(resolvedTools.map((tool) => [tool.name, tool]));

  const classified: ClassifiedToolCall[] = toolUseBlocks.map((toolUse) => {
    const resolved = toolsByName.get(toolUse.name);

    if (!resolved) {
      return { classification: "unknown" as const, toolUse };
    }

    if (resolved.toolkit === "brain") {
      return { classification: "brain-native" as const, toolUse, resolvedTool: resolved };
    }

    return { classification: "integration" as const, toolUse, resolvedTool: resolved };
  });

  const hasBrainNative = classified.some((c) => c.classification === "brain-native");
  const allUnknown = classified.every((c) => c.classification === "unknown");

  return { classified, hasBrainNative, allUnknown };
}

// ---------------------------------------------------------------------------
// Pure Helper: extractToolUseBlocks
// ---------------------------------------------------------------------------

/** Extract tool_use content blocks from an Anthropic Messages API response body. */
export function extractToolUseBlocks(
  responseBody: Record<string, unknown>,
): ToolUseBlock[] {
  const content = responseBody.content as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(content)) return [];

  return content.filter(
    (block): block is ToolUseBlock =>
      block.type === "tool_use" &&
      typeof block.id === "string" &&
      typeof block.name === "string" &&
      typeof block.input === "object" &&
      block.input !== null,
  );
}

/** Check if an Anthropic response indicates tool use (stop_reason === "tool_use"). */
export function isToolUseResponse(responseBody: Record<string, unknown>): boolean {
  return responseBody.stop_reason === "tool_use";
}
