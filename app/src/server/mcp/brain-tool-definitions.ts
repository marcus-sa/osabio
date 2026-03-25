/**
 * Brain Tool Definitions — MCP tool definitions for Brain-native tools.
 *
 * Pure core: no IO, no DB, no side effects.
 * JSON Schema inputSchema mirrors the Zod schemas in app/src/server/tools/*.ts.
 */
import type { McpToolDefinition } from "./tools-list-handler";

// ---------------------------------------------------------------------------
// Read tools (always available, no intent needed)
// ---------------------------------------------------------------------------

const SEARCH_ENTITIES: McpToolDefinition = {
  name: "search_entities",
  description:
    "Full-text search across the knowledge graph. Use for finding entities by keyword or topic.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", minLength: 1, description: "Search query (keywords matched via BM25 full-text search)" },
      kinds: {
        type: "array",
        items: { type: "string", enum: ["project", "feature", "task", "decision", "question", "suggestion"] },
        description: "Optional filter by entity kinds",
      },
      limit: { type: "integer", minimum: 1, maximum: 25, default: 10, description: "Maximum number of results" },
    },
    required: ["query"],
  },
};

const LIST_WORKSPACE_ENTITIES: McpToolDefinition = {
  name: "list_workspace_entities",
  description:
    "List workspace entities by kind. Use to answer questions about what entities exist.",
  inputSchema: {
    type: "object",
    properties: {
      kind: {
        type: "string",
        enum: ["project", "feature", "task", "decision", "question", "observation"],
        description: "Entity kind to list",
      },
      status: { type: "string", description: "Optional status filter, e.g. 'provisional', 'confirmed', 'open', 'done'" },
      project: { type: "string", description: "Optional project name or ID to scope results" },
      limit: { type: "integer", minimum: 1, maximum: 50, default: 25, description: "Maximum number of results" },
    },
    required: ["kind"],
  },
};

const GET_ENTITY_DETAIL: McpToolDefinition = {
  name: "get_entity_detail",
  description:
    "Get full details about a specific entity including relationships, provenance, and related entities.",
  inputSchema: {
    type: "object",
    properties: {
      entityId: { type: "string", minLength: 1, description: "Entity record ID, e.g. decision:abc123" },
    },
    required: ["entityId"],
  },
};

const GET_PROJECT_STATUS: McpToolDefinition = {
  name: "get_project_status",
  description:
    "Get the current status of a project including active tasks, recent decisions, open questions, and features.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: { type: "string", minLength: 1, description: "Project record ID or project name" },
    },
    required: ["projectId"],
  },
};

const GET_CONVERSATION_HISTORY: McpToolDefinition = {
  name: "get_conversation_history",
  description:
    "Search past conversations for discussions about a topic and return relevant message excerpts with linked entities.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", minLength: 1, description: "Topic to search for" },
    },
    required: ["query"],
  },
};

const CHECK_CONSTRAINTS: McpToolDefinition = {
  name: "check_constraints",
  description:
    "Check if a proposed action conflicts with existing decisions or constraints. Returns hard conflicts, soft tensions, supporting context, and proceed flag.",
  inputSchema: {
    type: "object",
    properties: {
      proposed_action: { type: "string", minLength: 1, description: "What is being proposed" },
      project: { type: "string", description: "Optional project scope" },
    },
    required: ["proposed_action"],
  },
};

const RESOLVE_DECISION: McpToolDefinition = {
  name: "resolve_decision",
  description:
    "Search for existing decisions matching a question. Returns resolved (high match) or unresolved with related context. Read-only — use create_provisional_decision to create new decisions.",
  inputSchema: {
    type: "object",
    properties: {
      question: { type: "string", minLength: 1, description: "The decision question" },
      project: { type: "string", description: "Optional project scope" },
      feature: { type: "string", description: "Optional feature scope" },
    },
    required: ["question"],
  },
};

// ---------------------------------------------------------------------------
// Write tools (gated, require intent authorization)
// ---------------------------------------------------------------------------

const CREATE_PROVISIONAL_DECISION: McpToolDefinition = {
  name: "create_provisional_decision",
  description:
    "Create a provisional decision when no existing answer exists. Use after resolve_decision returns unresolved.",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", minLength: 1, description: "Concise decision name" },
      rationale: { type: "string", minLength: 1, description: "Why this decision was made" },
      context: {
        type: "object",
        properties: {
          project: { type: "string" },
          feature: { type: "string" },
        },
      },
      options_considered: { type: "array", items: { type: "string", minLength: 1 } },
    },
    required: ["name", "rationale"],
  },
};

const CREATE_QUESTION: McpToolDefinition = {
  name: "create_question",
  description:
    "Create a question entity for open questions that require a choice or pending decision.",
  inputSchema: {
    type: "object",
    properties: {
      text: { type: "string", minLength: 1, description: "The question text" },
      category: { type: "string", enum: ["engineering", "research", "marketing", "operations", "design", "sales"] },
      priority: { type: "string", enum: ["low", "medium", "high", "critical"] },
      context: {
        type: "object",
        properties: {
          project: { type: "string" },
          feature: { type: "string" },
        },
      },
      assigned_to: { type: "string", description: "Person name to assign the question to" },
    },
    required: ["text"],
  },
};

const CREATE_OBSERVATION: McpToolDefinition = {
  name: "create_observation",
  description:
    "Create an observation — risks, conflicts, gaps, or notable facts. Use proactively when you notice cross-cutting concerns.",
  inputSchema: {
    type: "object",
    properties: {
      text: { type: "string", minLength: 1, description: "Observation text" },
      severity: {
        type: "string",
        enum: ["info", "warning", "conflict"],
        description: "info: awareness-level. warning: risks. conflict: contradictions needing resolution.",
      },
      category: { type: "string", enum: ["engineering", "research", "marketing", "operations", "design", "sales"] },
      related_entity_id: { type: "string", description: "Optional related entity id (project/feature/task/decision/question)" },
    },
    required: ["text", "severity"],
  },
};

const CREATE_SUGGESTION: McpToolDefinition = {
  name: "create_suggestion",
  description:
    "Create a suggestion — a proactive, actionable proposal with rationale for the user to consider.",
  inputSchema: {
    type: "object",
    properties: {
      text: { type: "string", minLength: 1, description: "The suggestion itself" },
      category: {
        type: "string",
        enum: ["optimization", "risk", "opportunity", "conflict", "missing", "pivot"],
        description: "optimization: improve approach. risk: potential problem. opportunity: beneficial possibility. conflict: contradictory elements. missing: gap in plan. pivot: direction change.",
      },
      rationale: { type: "string", minLength: 1, description: "Why you are making this suggestion" },
      confidence: { type: "number", minimum: 0, maximum: 1, description: "How confident you are (0-1)" },
      target_entity_id: { type: "string", description: "Optional target entity (format: table:id)" },
      evidence_entity_ids: { type: "array", items: { type: "string" }, description: "Optional supporting entity IDs" },
    },
    required: ["text", "category", "rationale", "confidence"],
  },
};

const CREATE_WORK_ITEM: McpToolDefinition = {
  name: "create_work_item",
  description:
    "Create a task, feature, or project directly in the knowledge graph.",
  inputSchema: {
    type: "object",
    properties: {
      kind: {
        type: "string",
        enum: ["task", "feature", "project"],
        description: "project: named product area. feature: capability within a project. task: concrete executable work.",
      },
      title: { type: "string", minLength: 1, description: "Concise entity title" },
      rationale: { type: "string", minLength: 1, description: "Why this entity is needed" },
      category: { type: "string", enum: ["engineering", "research", "marketing", "operations", "design", "sales"] },
      priority: { type: "string", enum: ["low", "medium", "high", "critical"] },
      project: { type: "string", description: "Project name to scope the entity under" },
      feature: { type: "string", description: "Feature name or record id to scope a task under" },
    },
    required: ["kind", "title", "rationale"],
  },
};

const EDIT_WORK_ITEM: McpToolDefinition = {
  name: "edit_work_item",
  description:
    "Edit an existing task/feature/project by id. Use for rename or metadata updates.",
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string", minLength: 1, description: "Existing work item id in table:id format" },
      title: { type: "string", minLength: 1, description: "New title/name" },
      status: { type: "string", minLength: 1, description: "New status" },
      category: { type: "string", enum: ["engineering", "research", "marketing", "operations", "design", "sales"] },
      priority: { type: "string", enum: ["low", "medium", "high", "critical"] },
      rationale: { type: "string", minLength: 1, description: "Rationale note appended as a description entry" },
    },
    required: ["id"],
  },
};

const MOVE_ITEMS_TO_PROJECT: McpToolDefinition = {
  name: "move_items_to_project",
  description:
    "Move existing features or tasks to a different project. Deletes the old project edge and creates a new one.",
  inputSchema: {
    type: "object",
    properties: {
      entity_ids: {
        type: "array",
        items: { type: "string", minLength: 1 },
        minItems: 1,
        description: "Polymorphic entity IDs to move, e.g. ['feature:uuid', 'task:uuid']",
      },
      target_project: { type: "string", minLength: 1, description: "Target project name or 'project:uuid'" },
    },
    required: ["entity_ids", "target_project"],
  },
};

const ACKNOWLEDGE_OBSERVATION: McpToolDefinition = {
  name: "acknowledge_observation",
  description:
    "Mark an observation as acknowledged — reviewed but still needs resolution.",
  inputSchema: {
    type: "object",
    properties: {
      observation_id: { type: "string", minLength: 1, description: "Observation record ID, e.g. observation:abc123" },
    },
    required: ["observation_id"],
  },
};

const RESOLVE_OBSERVATION: McpToolDefinition = {
  name: "resolve_observation",
  description:
    "Resolve an observation — the concern has been addressed.",
  inputSchema: {
    type: "object",
    properties: {
      observation_id: { type: "string", minLength: 1, description: "Observation record ID, e.g. observation:abc123" },
    },
    required: ["observation_id"],
  },
};

const SUGGEST_WORK_ITEMS: McpToolDefinition = {
  name: "suggest_work_items",
  description:
    "Process a batch of proposed work items and return PM triage buckets: suggestions, updated, discarded.",
  inputSchema: {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["task", "feature", "project"] },
            title: { type: "string", minLength: 1 },
            rationale: { type: "string", minLength: 1 },
            category: { type: "string", enum: ["engineering", "research", "marketing", "operations", "design", "sales"] },
            project: { type: "string" },
            priority: { type: "string", enum: ["low", "medium", "high", "critical"] },
          },
          required: ["kind", "title", "rationale"],
        },
        minItems: 1,
        maxItems: 25,
      },
    },
    required: ["items"],
  },
};

// ---------------------------------------------------------------------------
// Exported collections
// ---------------------------------------------------------------------------

export const BRAIN_READ_TOOLS: readonly McpToolDefinition[] = [
  SEARCH_ENTITIES,
  LIST_WORKSPACE_ENTITIES,
  GET_ENTITY_DETAIL,
  GET_PROJECT_STATUS,
  GET_CONVERSATION_HISTORY,
  CHECK_CONSTRAINTS,
  RESOLVE_DECISION,
];

export const BRAIN_WRITE_TOOLS: readonly McpToolDefinition[] = [
  CREATE_PROVISIONAL_DECISION,
  CREATE_QUESTION,
  CREATE_OBSERVATION,
  CREATE_SUGGESTION,
  CREATE_WORK_ITEM,
  EDIT_WORK_ITEM,
  MOVE_ITEMS_TO_PROJECT,
  ACKNOWLEDGE_OBSERVATION,
  RESOLVE_OBSERVATION,
  SUGGEST_WORK_ITEMS,
];

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
