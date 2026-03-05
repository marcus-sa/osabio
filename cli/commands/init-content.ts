/**
 * Embedded plugin content for `brain init`.
 *
 * The compiled binary can't read plugin/ files at runtime,
 * so we embed hooks, CLAUDE.md, and commands as constants.
 */

// ---------------------------------------------------------------------------
// Hooks (from plugin/hooks/hooks.json)
// ---------------------------------------------------------------------------

export const BRAIN_HOOKS: Record<string, Array<{ type: string; command?: string; prompt?: string }>> = {
  PreToolUse: [
    { type: "command", command: "brain system pretooluse" },
  ],
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

## Getting Context

Use \`get_context\` with a description of what you're working on. The server automatically finds the right project, tasks, decisions, and constraints — no need to pass project IDs manually.

Example: \`get_context({ intent: "implementing OAuth flow for the auth service" })\`

You can include task IDs (\`task:abc123\`), project names, file paths, or just a plain description.

## Hooks

- **SessionStart** loads workspace/project context automatically
- **PreToolUse** injects brain context when dispatching subagents
- **UserPromptSubmit** checks for workspace-level graph updates
- **Stop** catches unlogged decisions before the session ends
- **SessionEnd** logs session summary to the graph

## Data Model

**Work hierarchy:** Project → Feature → Task
- **Project**: a named initiative with status, description.
- **Feature**: a capability or deliverable within a project.
- **Task**: an actionable work item. Status: open/todo/ready/in_progress/blocked/done/completed.

**Cross-cutting entities** (attach to any level):
- **Decision**: a choice that was made. Lifecycle: extracted → proposed → provisional → confirmed → superseded.
- **Question**: an open question requiring a choice. Only for pending decisions, not informational queries.
- **Observation**: a lightweight signal (info/warning/conflict). Lifecycle: open → acknowledged → resolved.
- **Suggestion**: a proactive agent-to-human proposal. Categories: optimization, risk, opportunity, conflict, missing, pivot.

**Entity ID format:** MCP tools use \`table:id\` for polymorphic references (e.g. \`task:abc123\`, \`decision:def456\`).

## Decision Governance

- **Your decisions are always \`provisional\` or \`inferred\`** — only humans confirm.
- This means you can move fast without blocking, while humans retain authority.

## Best Practices

1. **Check before deciding.** Call \`resolve_decision\` first — the answer may already exist from another agent or human.
2. **Ask, don't guess.** If uncertain, \`ask_question\` is better than \`create_provisional_decision\`.
3. **Log as you go.** Don't batch decisions for the end. Log each significant choice when you make it.
4. **Decompose tasks.** Use \`create_subtask\` to break work into pieces, then update status as each completes.
5. **Check constraints.** Before adding a dependency or changing an approach, call \`check_constraints\`.
6. **Include task IDs in commit messages.** Use \`task:<raw-task-id>\` (or \`tasks: <id1>, <id2>\`). Describe *what* changed and *why*.`;

// ---------------------------------------------------------------------------
// Commands (slash commands installed to .claude/commands/)
// ---------------------------------------------------------------------------

export const BRAIN_COMMANDS: Record<string, string> = {
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
