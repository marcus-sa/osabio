/**
 * Embedded plugin content for `brain init`.
 *
 * The compiled binary can't read plugin/ files at runtime,
 * so we embed hooks, CLAUDE.md, and skills as constants.
 */

// ---------------------------------------------------------------------------
// Hooks (from plugin/hooks/hooks.json)
// ---------------------------------------------------------------------------

export const BRAIN_HOOKS: Record<string, Array<{ type: string; command?: string; prompt?: string }>> = {
  SessionStart: [
    { type: "command", command: "brain system load-context" },
  ],
  UserPromptSubmit: [
    { type: "command", command: "brain system check-updates" },
  ],
  Stop: [
    {
      type: "prompt",
      prompt: `Review this conversation for items that were discussed but NOT logged via the Brain MCP tools. Check each category:

1. **Decisions**: Implementation choices made but not logged. Call create_provisional_decision for each.
2. **Questions**: Unresolved questions raised but not logged. Call ask_question for each.
3. **Observations**: Contradictions, duplication, missing items, deprecated patterns, or anomalies noticed. Call log_observation for each.
4. **Task progress**: Tasks worked on whose status wasn't updated. Call update_task_status for each.
5. **Subtasks identified**: Work items or follow-up tasks discussed but not created. Call create_subtask for each (requires a parent task).
6. **Suggestions**: Optimizations, risks, opportunities, missing elements, or potential pivots noticed during work. Call create_suggestion for each with category (optimization|risk|opportunity|conflict|missing|pivot), rationale, and confidence (0-1).

After logging everything, respond with valid JSON in this exact shape:
{"decision":"approve","summary":"<one-line session summary>","decisions_made":["<decision-id>"],"questions_asked":["<question-id>"],"tasks_progressed":[{"task_id":"<task-id>","from_status":"<from>","to_status":"<to>"}],"files_changed":[{"path":"<path>","change_type":"created|modified|deleted"}],"observations_logged":["<observation-id>"],"subtasks_created":["<subtask-id>"],"suggestions_created":["<suggestion-id>"]}

If you cannot log required items (for example MCP unavailable), respond with:
{"decision":"block","reason":"Log these items first: ..."}`,
    },
  ],
  SessionEnd: [
    { type: "command", command: "brain system end-session" },
  ],
};

// ---------------------------------------------------------------------------
// CLAUDE.md (from plugin/CLAUDE.md)
// ---------------------------------------------------------------------------

export const BRAIN_CLAUDE_MD = `# Brain Knowledge Graph Integration

This project is connected to the Brain knowledge graph via MCP tools. The graph contains decisions, constraints, tasks, questions, and observations from all agents and humans working on this workspace.

## How Context Works

- **SessionStart** automatically loads your project context (decisions, tasks, constraints, recent changes)
- **UserPromptSubmit** checks for graph updates and alerts you to critical changes (e.g., a decision you depend on was superseded)
- **Stop** catches unlogged decisions before the session ends
- **SessionEnd** logs a session summary to the graph

## MCP Tools Available

### Read (use freely)
- \`get_project_context\` — Refresh full project context (decisions, tasks, constraints, questions)
- \`get_active_decisions\` — Decisions grouped by status (confirmed/provisional/contested)
- \`get_task_dependencies\` — Dependency tree for a task (depends on, depended by, subtasks)
- \`get_architecture_constraints\` — Hard and soft constraints from decisions and observations
- \`get_recent_changes\` — What changed since your last session
- \`get_entity_detail\` — Full detail for any entity (entity ID format: \`table:id\`)

### Reason (use when making choices)
- \`resolve_decision\` — Check if the graph already answers your question. **Always try this before creating a new decision.**
- \`check_constraints\` — Verify a proposed action doesn't conflict with existing decisions. **Use before adding dependencies or changing approaches.**

### Write (use to keep the graph current)
- \`create_provisional_decision\` — Record an implementation choice you made. Status is "provisional" — only humans confirm.
- \`ask_question\` — When genuinely uncertain, ask rather than guess. Creates a question for human review.
- \`update_task_status\` — Track progress. Triggers automatic subtask rollup on parent tasks.
- \`create_subtask\` — Break tasks into smaller pieces. Includes semantic dedup (returns existing if similar).
- \`log_implementation_note\` — Append notes about what was implemented and how.
- \`create_suggestion\` — Propose an optimization, risk, opportunity, conflict, missing element, or pivot for human review. Surfaces in the feed.

## Decision Governance

- **Your decisions are always \`provisional\` or \`inferred\`** — only humans confirm.
- This means you can move fast without blocking, while humans retain authority.
- Provisional decisions surface in the feed as DecisionReview cards for human approval.

## Best Practices

1. **Check before deciding.** Call \`resolve_decision\` first — the answer may already exist from another agent or human.
2. **Ask, don't guess.** If you're uncertain, \`ask_question\` is better than \`create_provisional_decision\`. A question says "I need input." A decision says "I picked this, review it."
3. **Log as you go.** Don't batch decisions for the end. Log each significant choice when you make it.
4. **Decompose tasks.** Use \`create_subtask\` to break work into pieces, then update status as each completes.
5. **Check constraints.** Before adding a dependency or changing an approach, call \`check_constraints\`.
6. **Write descriptive commit messages and include task IDs.** The pre-commit hook analyzes your diff and commit message against the knowledge graph to detect task completions, unlogged decisions, and constraint violations. Include the raw task ID(s) in the commit message to make webhook processing and follow-up linking/review unambiguous. Use a clear token like \`task:<raw-task-id>\` (or multiple, e.g. \`tasks: <id1>, <id2>\`). Vague messages like "wip" or "fix stuff" degrade analysis. Describe *what* changed and *why* — e.g., "task:4f5c2... switch rate limiting from fixed window to token bucket for bursty traffic" not "update rate limiter."`;

// ---------------------------------------------------------------------------
// Skills (from plugin/skills/)
// ---------------------------------------------------------------------------

export const BRAIN_SKILLS: Record<string, string> = {
  "brain-start-task.md": `---
name: brain-start-task
description: Start working on a specific task from the Brain knowledge graph
user_invocable: true
args: task_id
---

# /brain-start-task <task_id>

Start a task-scoped session focused on a specific task.

## Instructions

1. Call \`get_project_context\` with the task_id to get task-scoped context
2. Display the task details: title, description, status, dependencies
3. Show existing subtasks (if a previous agent already decomposed this task — do NOT re-decompose)
4. Show sibling tasks (for awareness of parallel work)
5. Show related decisions and constraints
6. Call \`update_task_status\` to set the task to "in_progress" if it's currently "todo" or "ready"
7. If the task has no subtasks, analyze what needs to be done and offer to create subtasks via \`create_subtask\`
8. Begin implementation, using Brain MCP tools throughout:
   - \`resolve_decision\` when hitting implementation choices
   - \`check_constraints\` before adding dependencies or changing approaches
   - \`create_provisional_decision\` when making choices the graph doesn't cover
   - \`ask_question\` when genuinely uncertain
   - \`update_task_status\` as subtasks complete`,

  "brain-status.md": `---
name: brain-status
description: Show current Brain knowledge graph context for this project
user_invocable: true
---

# /brain-status

Show the current project context from the Brain knowledge graph.

## Instructions

1. Call the \`get_project_context\` MCP tool with the current project ID
2. Display the results in a readable format:
   - Contested decisions (conflicts that need resolution)
   - Confirmed decisions (follow these)
   - Provisional decisions (follow but note for review)
   - Active tasks with status
   - Open questions
   - Recent changes
3. If there are contested decisions, highlight them prominently
4. Suggest next actions based on the context (e.g., "Task X is blocked by question Y")`,
};
