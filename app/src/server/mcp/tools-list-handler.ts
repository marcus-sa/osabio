/**
 * Tools List Handler -- Pure function for building MCP ListToolsResult
 * from classified tools.
 *
 * Pure core: no IO, no DB, no side effects.
 */
import type { ClassifiedTool } from "./scope-engine";
import {
  type McpToolDefinition,
  BRAIN_READ_TOOLS,
  BRAIN_WRITE_TOOLS,
  BRAIN_INFRASTRUCTURE_TOOLS,
  ALL_BRAIN_TOOL_NAMES,
} from "./brain-tool-definitions";

// Re-export for consumers that import from here
export type { McpToolDefinition };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ListToolsResult = {
  readonly tools: readonly McpToolDefinition[];
};

/** Tool names that are handled by Brain (not forwarded to external MCP servers). */
export const BRAIN_NATIVE_TOOL_NAMES: ReadonlySet<string> = ALL_BRAIN_TOOL_NAMES;

// ---------------------------------------------------------------------------
// Pure function: buildToolsList
// ---------------------------------------------------------------------------

/**
 * Build a description for a gated tool that includes escalation instructions
 * directing the agent to call create_intent.
 */
function buildGatedToolDescription(
  originalDescription: string,
  toolkit: string,
  toolName: string,
): string {
  return (
    `[GATED] This tool requires an approved intent. ` +
    `Call create_intent with provider="${toolkit}" and action="${toolName}" to request authorization.\n\n` +
    originalDescription
  );
}

/** Convert a classified tool to an MCP tool definition. */
function classifiedToolToDefinition(classified: ClassifiedTool): McpToolDefinition {
  const { tool, classification } = classified;

  switch (classification.kind) {
    case "authorized":
      return {
        name: tool.name,
        description: tool.description,
        inputSchema: tool.input_schema,
      };
    case "gated":
      return {
        name: tool.name,
        description: buildGatedToolDescription(tool.description, tool.toolkit, tool.name),
        inputSchema: tool.input_schema,
      };
    case "brain_native":
      // Brain-native tools from the classified list are replaced by canonical definitions
      return BRAIN_INFRASTRUCTURE_TOOLS.find((t) => t.name === tool.name) ?? {
        name: tool.name,
        description: tool.description,
        inputSchema: tool.input_schema,
      };
  }
}

/**
 * Build the MCP ListToolsResult from classified tools.
 *
 * Pipeline:
 *   classifiedTools -> filter out brain_native -> map to definitions
 *   -> append brain read tools (always available)
 *   -> append brain write tools (gated or authorized based on intent)
 *   -> append infrastructure tools (get_context, create_intent)
 */
export function buildToolsList(
  classifiedTools: readonly ClassifiedTool[],
  authorizedBrainWriteTools: ReadonlySet<string> = new Set(),
): ListToolsResult {
  // Convert granted tools (authorized + gated), excluding brain_native from the classified set
  // because we append canonical brain-native definitions separately
  const grantedToolDefinitions = classifiedTools
    .filter((ct) => ct.classification.kind !== "brain_native")
    .map(classifiedToolToDefinition);

  // Brain write tools: gated or authorized based on intent
  const brainWriteToolDefinitions = BRAIN_WRITE_TOOLS.map((tool) => {
    if (authorizedBrainWriteTools.has(tool.name)) {
      return tool; // authorized — show with clean description
    }
    return {
      ...tool,
      description: buildGatedToolDescription(tool.description, "brain", tool.name),
    };
  });

  return {
    tools: [
      ...grantedToolDefinitions,
      ...BRAIN_READ_TOOLS,
      ...brainWriteToolDefinitions,
      ...BRAIN_INFRASTRUCTURE_TOOLS,
    ],
  };
}
