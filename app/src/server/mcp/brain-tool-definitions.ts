/**
 * Brain Tool Definitions — Single source of truth for Brain-native MCP tools.
 *
 * Zod schemas are the canonical definitions. JSON Schema is derived via
 * Zod v4's toJSONSchema(). Tool files in tools/*.ts should import from
 * here rather than re-defining schemas.
 *
 * Pure core: no IO, no DB, no side effects.
 */
import { z } from "zod";
import z4 from "zod/v4";
import { ENTITY_CATEGORIES, ENTITY_PRIORITIES, SUGGESTION_CATEGORIES } from "../../shared/contracts";

// ---------------------------------------------------------------------------
// McpToolDefinition type (self-contained, no circular import)
// ---------------------------------------------------------------------------

export type McpToolDefinition = {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Zod → MCP definition helper
// ---------------------------------------------------------------------------

function defineTool(
  name: string,
  description: string,
  schema: z.ZodType,
): McpToolDefinition {
  const jsonSchema = z4.toJSONSchema(schema);
  // Strip $schema key — MCP protocol doesn't use it
  const { $schema: _, ...inputSchema } = jsonSchema as Record<string, unknown>;
  return { name, description, inputSchema };
}

// ---------------------------------------------------------------------------
// Shared schema fragments
// ---------------------------------------------------------------------------

const projectFeatureContext = z.object({
  project: z.string().optional(),
  feature: z.string().optional(),
}).optional().describe("Project/feature scope");

// ---------------------------------------------------------------------------
// Infrastructure tools
// ---------------------------------------------------------------------------

export const createIntentSchema = z.object({
  goal: z.string().describe("What you want to accomplish with this tool"),
  reasoning: z.string().describe("Why this tool is needed for the current task"),
  action_spec: z.object({
    provider: z.string().describe("The toolkit/provider name (e.g. github, brain)"),
    action: z.string().describe("The tool action name"),
    params: z.record(z.string(), z.unknown()).optional().describe("Parameters for the tool call"),
  }),
});

export const getContextSchema = z.object({
  intent: z.string().describe("Description of what you are working on"),
});

// ---------------------------------------------------------------------------
// Read tool schemas
// ---------------------------------------------------------------------------

export const searchEntitiesSchema = z.object({
  query: z.string().min(1).describe("Search query (keywords matched via BM25 full-text search)"),
  kinds: z.array(z.enum(["project", "feature", "task", "decision", "question", "suggestion"]))
    .optional()
    .describe("Optional filter by entity kinds"),
  limit: z.number().int().min(1).max(25).default(10).describe("Maximum number of results"),
});

export const listWorkspaceEntitiesSchema = z.object({
  kind: z.enum(["project", "feature", "task", "decision", "question", "observation"])
    .describe("Entity kind to list"),
  status: z.string().optional().describe("Optional status filter, e.g. 'provisional', 'confirmed', 'open', 'done'"),
  project: z.string().optional().describe("Optional project name or ID to scope results"),
  limit: z.number().int().min(1).max(50).default(25).describe("Maximum number of results"),
});

export const getEntityDetailSchema = z.object({
  entityId: z.string().min(1).describe("Entity record ID, e.g. decision:abc123"),
});

export const getProjectStatusSchema = z.object({
  projectId: z.string().min(1).describe("Project record ID or project name"),
});

export const getConversationHistorySchema = z.object({
  query: z.string().min(1).describe("Topic to search for"),
  projectId: z.string().optional().describe("Optional project scope filter"),
});

export const checkConstraintsSchema = z.object({
  proposed_action: z.string().min(1).describe("What is being proposed"),
  project: z.string().optional().describe("Optional project scope"),
});

export const resolveDecisionSchema = z.object({
  question: z.string().min(1).describe("The decision question"),
  project: z.string().optional().describe("Optional project scope"),
  feature: z.string().optional().describe("Optional feature scope"),
});

// ---------------------------------------------------------------------------
// Write tool schemas
// ---------------------------------------------------------------------------

export const createProvisionalDecisionSchema = z.object({
  name: z.string().min(1).describe("Concise decision name"),
  rationale: z.string().min(1).describe("Why this decision was made"),
  context: projectFeatureContext,
  options_considered: z.array(z.string().min(1)).optional(),
});

export const createQuestionSchema = z.object({
  text: z.string().min(1).describe("The question text"),
  category: z.enum(ENTITY_CATEGORIES).optional().describe("Question category"),
  priority: z.enum(ENTITY_PRIORITIES).optional().describe("critical: blocking/urgent. high: important. medium: normal. low: nice-to-have."),
  context: projectFeatureContext,
  assigned_to: z.string().optional().describe("Person name to assign the question to"),
});

export const createObservationSchema = z.object({
  text: z.string().min(1).describe("Observation text"),
  severity: z.enum(["info", "warning", "conflict"])
    .describe("info: awareness-level. warning: risks. conflict: contradictions needing resolution."),
  category: z.enum(ENTITY_CATEGORIES).optional(),
  related_entity_id: z.string().optional().describe("Optional related entity id (project/feature/task/decision/question)"),
});

export const createSuggestionSchema = z.object({
  text: z.string().min(1).describe("The suggestion itself"),
  category: z.enum(SUGGESTION_CATEGORIES)
    .describe("optimization: improve approach. risk: potential problem. opportunity: beneficial possibility. conflict: contradictory elements. missing: gap in plan. pivot: direction change."),
  rationale: z.string().min(1).describe("Why you are making this suggestion"),
  confidence: z.number().min(0).max(1).describe("How confident you are (0-1)"),
  target_entity_id: z.string().optional().describe("Optional target entity (format: table:id)"),
  evidence_entity_ids: z.array(z.string()).optional().describe("Optional supporting entity IDs"),
});

export const createWorkItemSchema = z.object({
  kind: z.enum(["task", "feature", "project"])
    .describe("project: named product area. feature: capability within a project. task: concrete executable work."),
  title: z.string().min(1).describe("Concise entity title"),
  rationale: z.string().min(1).describe("Why this entity is needed"),
  category: z.enum(ENTITY_CATEGORIES).optional(),
  priority: z.enum(ENTITY_PRIORITIES).optional(),
  project: z.string().optional().describe("Project name to scope the entity under"),
  feature: z.string().optional().describe("Feature name or record id to scope a task under"),
});

export const editWorkItemSchema = z.object({
  id: z.string().min(1).describe("Existing work item id in table:id format"),
  title: z.string().min(1).optional().describe("New title/name"),
  status: z.string().min(1).optional().describe("New status"),
  category: z.enum(ENTITY_CATEGORIES).optional(),
  priority: z.enum(ENTITY_PRIORITIES).optional(),
  rationale: z.string().min(1).optional().describe("Rationale note appended as a description entry"),
});

export const moveItemsToProjectSchema = z.object({
  entity_ids: z.array(z.string().min(1)).min(1)
    .describe("Polymorphic entity IDs to move, e.g. ['feature:uuid', 'task:uuid']"),
  target_project: z.string().min(1).describe("Target project name or 'project:uuid'"),
});

export const acknowledgeObservationSchema = z.object({
  observation_id: z.string().min(1).describe("Observation record ID, e.g. observation:abc123"),
});

export const resolveObservationSchema = z.object({
  observation_id: z.string().min(1).describe("Observation record ID, e.g. observation:abc123"),
});

export const suggestWorkItemsSchema = z.object({
  items: z.array(z.object({
    kind: z.enum(["task", "feature", "project"]),
    title: z.string().min(1),
    rationale: z.string().min(1),
    category: z.enum(ENTITY_CATEGORIES).optional(),
    project: z.string().optional(),
    priority: z.enum(ENTITY_PRIORITIES).optional(),
  })).min(1).max(25),
});

// ---------------------------------------------------------------------------
// MCP tool definitions (derived from Zod schemas)
// ---------------------------------------------------------------------------

// Infrastructure
export const CREATE_INTENT_TOOL = defineTool(
  "create_intent",
  "Create an intent to request authorization for a gated tool. " +
  "Use this when a tool you need is marked as [GATED]. " +
  "Provide the goal, reasoning, and action_spec describing the tool you want to use.",
  createIntentSchema,
);

export const GET_CONTEXT_TOOL = defineTool(
  "get_context",
  "Get project context from the Brain knowledge graph. " +
  "Returns decisions, tasks, observations, and other entities relevant to your current work.",
  getContextSchema,
);

export const BRAIN_INFRASTRUCTURE_TOOLS: readonly McpToolDefinition[] = [
  CREATE_INTENT_TOOL,
  GET_CONTEXT_TOOL,
];

// Read
export const BRAIN_READ_TOOLS: readonly McpToolDefinition[] = [
  defineTool("search_entities",
    "Full-text search across the knowledge graph. Use for finding entities by keyword or topic.",
    searchEntitiesSchema),
  defineTool("list_workspace_entities",
    "List workspace entities by kind. Use to answer questions about what entities exist.",
    listWorkspaceEntitiesSchema),
  defineTool("get_entity_detail",
    "Get full details about a specific entity including relationships, provenance, and related entities.",
    getEntityDetailSchema),
  defineTool("get_project_status",
    "Get the current status of a project including active tasks, recent decisions, open questions, and features.",
    getProjectStatusSchema),
  defineTool("get_conversation_history",
    "Search past conversations for discussions about a topic and return relevant message excerpts with linked entities.",
    getConversationHistorySchema),
  defineTool("check_constraints",
    "Check if a proposed action conflicts with existing decisions or constraints. Returns hard conflicts, soft tensions, supporting context, and proceed flag.",
    checkConstraintsSchema),
  defineTool("resolve_decision",
    "Search for existing decisions matching a question. Returns resolved (high match) or unresolved with related context. Read-only — use create_provisional_decision to create new decisions.",
    resolveDecisionSchema),
];

// Write
export const BRAIN_WRITE_TOOLS: readonly McpToolDefinition[] = [
  defineTool("create_provisional_decision",
    "Create a provisional decision when no existing answer exists. Use after resolve_decision returns unresolved.",
    createProvisionalDecisionSchema),
  defineTool("create_question",
    "Create a question entity for open questions that require a choice or pending decision.",
    createQuestionSchema),
  defineTool("create_observation",
    "Create an observation — risks, conflicts, gaps, or notable facts. Use proactively when you notice cross-cutting concerns.",
    createObservationSchema),
  defineTool("create_suggestion",
    "Create a suggestion — a proactive, actionable proposal with rationale for the user to consider.",
    createSuggestionSchema),
  defineTool("create_work_item",
    "Create a task, feature, or project directly in the knowledge graph.",
    createWorkItemSchema),
  defineTool("edit_work_item",
    "Edit an existing task/feature/project by id. Use for rename or metadata updates.",
    editWorkItemSchema),
  defineTool("move_items_to_project",
    "Move existing features or tasks to a different project. Deletes the old project edge and creates a new one.",
    moveItemsToProjectSchema),
  defineTool("acknowledge_observation",
    "Mark an observation as acknowledged — reviewed but still needs resolution.",
    acknowledgeObservationSchema),
  defineTool("resolve_observation",
    "Resolve an observation — the concern has been addressed.",
    resolveObservationSchema),
  defineTool("suggest_work_items",
    "Process a batch of proposed work items and return PM triage buckets: suggestions, updated, discarded.",
    suggestWorkItemsSchema),
];

// ---------------------------------------------------------------------------
// Name sets
// ---------------------------------------------------------------------------

export const BRAIN_READ_TOOL_NAMES: ReadonlySet<string> = new Set(
  BRAIN_READ_TOOLS.map((t) => t.name),
);

export const BRAIN_WRITE_TOOL_NAMES: ReadonlySet<string> = new Set(
  BRAIN_WRITE_TOOLS.map((t) => t.name),
);

/** All brain tool names including infrastructure tools (get_context, create_intent). */
export const ALL_BRAIN_TOOL_NAMES: ReadonlySet<string> = new Set([
  ...BRAIN_READ_TOOL_NAMES,
  ...BRAIN_WRITE_TOOL_NAMES,
  "get_context",
  "create_intent",
]);
