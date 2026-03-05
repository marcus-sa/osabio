import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { requireConfig } from "./config";
import { BrainHttpClient } from "./http-client";

export async function runMcpServer(): Promise<void> {
  const config = await requireConfig();
  const client = new BrainHttpClient(config);

  const server = new McpServer({
    name: "brain",
    version: "0.1.0",
  });

  // =========================================================================
  // Primary — Intent-based context
  // =========================================================================

  server.tool(
    "get_context",
    "Load relevant knowledge graph context for your current work. Describe what you're doing and the server finds the right project, tasks, decisions, and constraints. Preferred over get_workspace_context / get_project_context / get_task_context.",
    {
      intent: z.string().describe("What you're working on. Can include task IDs (task:abc), project names, file paths, or a plain description of your goal."),
    },
    async (input) => {
      const result = await client.getContext({ intent: input.intent });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, undefined, 2) }] };
    },
  );

  // =========================================================================
  // Tier 1 — Read Tools (legacy, still functional)
  // =========================================================================

  server.tool(
    "get_workspace_context",
    "Lightweight workspace overview: projects with entity counts, hot items (contested decisions, open observations), and active sessions. Already loaded at session start — use to refresh.",
    {},
    async () => {
      const result = await client.getWorkspaceContext();
      return { content: [{ type: "text" as const, text: JSON.stringify(result, undefined, 2) }] };
    },
  );

  server.tool(
    "get_project_context",
    "Full project context: decisions, tasks, questions, observations, suggestions, recent changes. Use when you know which project you're working on.",
    {
      project_id: z.string().describe("Project ID"),
      task_id: z.string().optional().describe("Task ID for additional task-scoped context within the project"),
      since: z.string().optional().describe("ISO timestamp to include recent changes since"),
    },
    async (input) => {
      const result = await client.getProjectContext(input);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, undefined, 2) }] };
    },
  );

  server.tool(
    "get_task_context",
    "Task-focused context: task subgraph (subtasks, dependencies, parent feature, siblings, related sessions) plus project hot items. Project is resolved automatically from the task's graph relationships.",
    {
      task_id: z.string().describe("Task ID"),
    },
    async (input) => {
      const result = await client.getTaskContext(input);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, undefined, 2) }] };
    },
  );

  server.tool(
    "get_active_decisions",
    "Get active decisions grouped by status (confirmed, provisional, contested). Optionally scope to a project and/or area.",
    {
      project_id: z.string().optional().describe("Project ID to scope decisions (omit for workspace-wide)"),
      area: z.string().optional().describe("Category filter: engineering, research, marketing, operations, design, sales"),
    },
    async (input) => {
      const result = await client.getDecisions(input);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, undefined, 2) }] };
    },
  );

  server.tool(
    "get_task_dependencies",
    "Get full dependency tree for a task: what it depends on, what depends on it, and its subtasks.",
    {
      task_id: z.string().describe("Task ID"),
    },
    async (input) => {
      const result = await client.getTaskDependencies(input);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, undefined, 2) }] };
    },
  );

  server.tool(
    "get_architecture_constraints",
    "Get constraints: confirmed decisions (hard constraints) and open observations (warnings/conflicts). Optionally scope to a project.",
    {
      project_id: z.string().optional().describe("Project ID to scope constraints (omit for workspace-wide)"),
      area: z.string().optional().describe("Category filter"),
    },
    async (input) => {
      const result = await client.getConstraints(input);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, undefined, 2) }] };
    },
  );

  server.tool(
    "get_recent_changes",
    "Get entities that changed since a timestamp. Use to see what happened while you were away.",
    {
      project_id: z.string().optional().describe("Project ID to scope changes"),
      since: z.string().describe("ISO timestamp to get changes since"),
    },
    async (input) => {
      const result = await client.getChanges(input);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, undefined, 2) }] };
    },
  );

  server.tool(
    "get_entity_detail",
    "Get full detail for any entity including relationships and provenance. Entity ID format: table:id (e.g. decision:abc123).",
    {
      entity_id: z.string().describe("Entity ID in table:id format"),
    },
    async (input) => {
      const result = await client.getEntityDetail(input.entity_id);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, undefined, 2) }] };
    },
  );

  server.tool(
    "list_pending_suggestions",
    "List pending and deferred suggestions from the brain. Use to see what proactive proposals agents have made for your review.",
    {
      status: z.string().optional().describe("Filter by status: pending (default), accepted, dismissed, deferred, converted"),
      category: z.string().optional().describe("Filter by category: optimization, risk, opportunity, conflict, missing, pivot"),
      limit: z.number().optional().describe("Max results to return (default 20)"),
    },
    async (input) => {
      const result = await client.listSuggestions(input);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, undefined, 2) }] };
    },
  );

  // =========================================================================
  // Tier 2 — Reasoning Tools
  // =========================================================================

  server.tool(
    "resolve_decision",
    "Check if an existing decision in the graph answers your question. Use before making a new decision — the graph may already have the answer from a previous agent or human.",
    {
      question: z.string().describe("The question you need answered (e.g. 'Should this endpoint use REST or tRPC?')"),
      options: z.array(z.string()).optional().describe("Options you've identified"),
      context: z
        .object({
          project: z.string().optional(),
          feature: z.string().optional(),
        })
        .optional()
        .describe("Project/feature scope to search within"),
    },
    async (input) => {
      const result = await client.resolveDecision(input);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, undefined, 2) }] };
    },
  );

  server.tool(
    "check_constraints",
    "Check if a proposed action conflicts with existing decisions or constraints. Returns hard conflicts, soft tensions, and supporting context.",
    {
      proposed_action: z.string().describe("What you're proposing to do (e.g. 'Add Redis dependency for caching')"),
      project: z.string().optional().describe("Project scope"),
    },
    async (input) => {
      const result = await client.checkConstraints(input);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, undefined, 2) }] };
    },
  );

  // =========================================================================
  // Tier 3 — Write Tools
  // =========================================================================

  server.tool(
    "create_provisional_decision",
    "Create a provisional decision when you make an implementation choice the graph doesn't cover. This surfaces for human review in the feed. Use after resolve_decision returns unresolved.",
    {
      name: z.string().describe("Concise decision name (e.g. 'Use token bucket for rate limiting')"),
      rationale: z.string().describe("Why this decision was made"),
      context: z
        .object({
          project: z.string().optional(),
          feature: z.string().optional(),
        })
        .optional()
        .describe("Project/feature this decision belongs to"),
      options_considered: z.array(z.string()).optional().describe("Other options that were considered"),
    },
    async (input) => {
      const result = await client.createProvisionalDecision(input);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, undefined, 2) }] };
    },
  );

  server.tool(
    "ask_question",
    "Ask a question when genuinely uncertain. Creates a question entity for human review in the feed. Better than guessing or creating a provisional decision when you don't know the answer.",
    {
      text: z.string().describe("The question"),
      context: z
        .object({
          project: z.string().optional(),
          feature: z.string().optional(),
          task: z.string().optional(),
        })
        .optional()
        .describe("Scope for the question"),
      options: z.array(z.string()).optional().describe("Options you've identified (helps human answer faster)"),
      blocking_task: z.string().optional().describe("Task ID this question blocks (creates BLOCKS edge)"),
    },
    async (input) => {
      const result = await client.askQuestion(input);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, undefined, 2) }] };
    },
  );

  server.tool(
    "update_task_status",
    "Update a task's status. Triggers automatic subtask rollup on parent tasks.",
    {
      task_id: z.string().describe("Task ID"),
      status: z.string().describe("New status: todo, in_progress, blocked, completed, done"),
      notes: z.string().optional().describe("Optional notes about the status change"),
    },
    async (input) => {
      const result = await client.updateTaskStatus(input);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, undefined, 2) }] };
    },
  );

  server.tool(
    "create_subtask",
    "Create a subtask under a parent task. Use to break work into smaller pieces. Includes semantic dedup — returns existing subtask if a similar one already exists.",
    {
      parent_task_id: z.string().describe("Parent task ID to add subtask under"),
      title: z.string().describe("Subtask title"),
      category: z.string().optional().describe("Category (inherits from parent if not specified)"),
      rationale: z.string().optional().describe("Why this subtask is needed"),
    },
    async (input) => {
      const result = await client.createSubtask(input);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, undefined, 2) }] };
    },
  );

  server.tool(
    "log_implementation_note",
    "Append an implementation note to any entity (decision, task, feature). Use to record what was implemented and how.",
    {
      entity_id: z.string().describe("Entity ID in table:id format (e.g. decision:abc123)"),
      note: z.string().describe("What was implemented and how"),
      files_changed: z.array(z.string()).optional().describe("Paths of files touched"),
    },
    async (input) => {
      const result = await client.logImplementationNote(input);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, undefined, 2) }] };
    },
  );

  server.tool(
    "log_observation",
    "Log a codebase observation to the knowledge graph. Use when you notice contradictions between code and decisions, duplicated logic, missing implementations, deprecated patterns, recurring patterns, or anomalies. Creates an observation entity visible in the feed and to other agents.",
    {
      text: z.string().describe("What you observed — include file paths and specifics so a human can act on it"),
      category: z
        .enum(["contradiction", "duplication", "missing", "deprecated", "pattern", "anomaly"])
        .describe(
          "contradiction: code contradicts a decision or spec. duplication: same logic in multiple places. missing: expected thing is absent (tests, error handling, docs). deprecated: outdated dependency or pattern. pattern: recurring pattern worth noting. anomaly: something unexpected.",
        ),
      severity: z
        .enum(["info", "warning", "conflict"])
        .describe(
          "info: awareness-level, no action needed. warning: risk that should be addressed. conflict: contradiction needing human resolution.",
        ),
      target: z.string().optional().describe("Entity this observation is about, in table:id format (e.g. decision:abc123, task:def456)"),
      session_id: z.string().optional().describe("Current agent session ID to link this observation to"),
    },
    async (input) => {
      const result = await client.logObservation(input);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, undefined, 2) }] };
    },
  );

  server.tool(
    "create_suggestion",
    "Create a suggestion for the human to review. Use when you notice an optimization, risk, opportunity, conflict, missing element, or potential pivot that the user should consider. Suggestions surface in the feed for human review.",
    {
      text: z.string().describe("The suggestion itself — what you propose the user should consider or do"),
      category: z
        .enum(["optimization", "risk", "opportunity", "conflict", "missing", "pivot"])
        .describe(
          "optimization: improve existing approach. risk: potential problem. opportunity: beneficial possibility. conflict: contradictory elements. missing: gap in plan. pivot: direction change worth considering.",
        ),
      rationale: z.string().describe("Why you are making this suggestion — reasoning and evidence"),
      confidence: z.number().describe("Confidence in this suggestion (0-1)"),
      target_entity_id: z.string().optional().describe("Entity this is about (format: table:id, e.g. project:uuid)"),
      evidence_entity_ids: z.array(z.string()).optional().describe("Supporting entity IDs (format: table:id)"),
      session_id: z.string().optional().describe("Current agent session ID"),
    },
    async (input) => {
      const result = await client.createSuggestion(input);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, undefined, 2) }] };
    },
  );

  server.tool(
    "accept_suggestion",
    "Accept a pending suggestion, marking it as approved for action.",
    {
      suggestion_id: z.string().describe("Suggestion ID (raw UUID, no table prefix)"),
    },
    async (input) => {
      const result = await client.suggestionAction({ suggestion_id: input.suggestion_id, action: "accept" });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, undefined, 2) }] };
    },
  );

  server.tool(
    "dismiss_suggestion",
    "Dismiss a suggestion that is not relevant or actionable.",
    {
      suggestion_id: z.string().describe("Suggestion ID (raw UUID, no table prefix)"),
    },
    async (input) => {
      const result = await client.suggestionAction({ suggestion_id: input.suggestion_id, action: "dismiss" });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, undefined, 2) }] };
    },
  );

  server.tool(
    "convert_suggestion",
    "Convert an accepted or pending suggestion into a task, feature, decision, or project entity in the knowledge graph.",
    {
      suggestion_id: z.string().describe("Suggestion ID (raw UUID, no table prefix)"),
      convert_to: z
        .enum(["task", "feature", "decision", "project"])
        .describe("Entity type to convert the suggestion into"),
      title: z.string().optional().describe("Override title for the created entity (defaults to suggestion text)"),
    },
    async (input) => {
      const result = await client.convertSuggestion(input);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, undefined, 2) }] };
    },
  );

  // =========================================================================
  // Connect via stdio
  // =========================================================================

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
