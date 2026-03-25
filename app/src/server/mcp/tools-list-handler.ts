/**
 * Tools List Handler -- Pure function for building MCP ListToolsResult
 * from classified tools.
 *
 * Pure core: no IO, no DB, no side effects.
 */
import type { ClassifiedTool } from "./scope-engine";
import {
  BRAIN_READ_TOOLS,
  BRAIN_WRITE_TOOLS,
  ALL_BRAIN_TOOL_NAMES,
} from "./brain-tool-definitions";
// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type McpToolDefinition = {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
};

export type ListToolsResult = {
  readonly tools: readonly McpToolDefinition[];
};

// ---------------------------------------------------------------------------
// Brain-native tool definitions
// ---------------------------------------------------------------------------

const CREATE_INTENT_TOOL: McpToolDefinition = {
  name: "create_intent",
  description:
    "Create an intent to request authorization for a gated tool. " +
    "Use this when a tool you need is marked as [GATED]. " +
    "Provide the goal, reasoning, and action_spec describing the tool you want to use.",
  inputSchema: {
    type: "object",
    properties: {
      goal: { type: "string", description: "What you want to accomplish with this tool" },
      reasoning: { type: "string", description: "Why this tool is needed for the current task" },
      action_spec: {
        type: "object",
        properties: {
          provider: { type: "string", description: "The toolkit/provider name (e.g. github, stripe)" },
          action: { type: "string", description: "The tool action name" },
          params: { type: "object", description: "Parameters for the tool call" },
        },
        required: ["provider", "action"],
      },
    },
    required: ["goal", "reasoning", "action_spec"],
  },
};

const GET_CONTEXT_TOOL: McpToolDefinition = {
  name: "get_context",
  description:
    "Get project context from the Brain knowledge graph. " +
    "Returns decisions, tasks, observations, and other entities relevant to your current work.",
  inputSchema: {
    type: "object",
    properties: {
      intent: { type: "string", description: "Description of what you are working on" },
    },
    required: ["intent"],
  },
};

const BRAIN_NATIVE_TOOLS: readonly McpToolDefinition[] = [
  CREATE_INTENT_TOOL,
  GET_CONTEXT_TOOL,
];

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
      return BRAIN_NATIVE_TOOLS.find((t) => t.name === tool.name) ?? {
        name: tool.name,
        description: tool.description,
        inputSchema: tool.input_schema,
      };
  }
}

/**
 * Build gated description for a brain write tool.
 */
function buildBrainGatedToolDescription(
  originalDescription: string,
  toolName: string,
): string {
  return (
    `[GATED] This tool requires an approved intent. ` +
    `Call create_intent with provider="brain" and action="${toolName}" to request authorization.\n\n` +
    originalDescription
  );
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
      description: buildBrainGatedToolDescription(tool.description, tool.name),
    };
  });

  return {
    tools: [
      ...grantedToolDefinitions,
      ...BRAIN_READ_TOOLS,
      ...brainWriteToolDefinitions,
      ...BRAIN_NATIVE_TOOLS,
    ],
  };
}
