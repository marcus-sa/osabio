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

## Project Context

At session start you receive a list of workspace projects with their IDs. Most MCP tools require a \`project_id\` — infer it from context:

- **Task-scoped work**: If you're given a task ID, call \`get_entity_detail\` — the task's graph relationships reveal its project.
- **Directory-scoped work**: Match the directory you're working in to a project. In a monorepo, each service/package directory typically maps to a project. In a monolith, a module or subpackage may map to a project or feature.
- **Single project**: If the workspace has only one project, use it.
- **Ambiguous**: If you can't determine the project, ask the user.

## Directory Mapping

Directories can be mapped to brain entities (project, feature) via \`CLAUDE.md\` files. When a directory has a brain mapping, any agent working in it automatically knows which entity to scope its work to.

**Auto-mapping**: When you determine which project or feature a directory corresponds to (from workspace context, task scope, or user input), check if the directory already has a brain mapping by looking for \`<!-- brain-map-start -->\` in its \`CLAUDE.md\`. If not, persist the mapping by running:

\`\`\`
brain map <directory> <type>:<id>
\`\`\`

Examples:
- \`brain map ./services/auth project:abc123\`
- \`brain map ./services/auth/oauth feature:def456 --project abc123\`

This creates a \`CLAUDE.md\` in the target directory with context-loading instructions. Future agents entering that directory will automatically load the right graph context.

**When to map**: Map a directory when you confidently identify it as the primary location for a brain entity. Do not map speculatively — only when the project/feature clearly corresponds to the directory scope.

## Hooks

- **SessionStart** loads workspace info (available projects and IDs)
- **UserPromptSubmit** checks for workspace-level graph updates
- **Stop** catches unlogged decisions before the session ends
- **SessionEnd** logs session summary to the graph

## Data Model

The knowledge graph has these entity types. Use this to pick the right MCP tools and understand tool results.

**Work hierarchy:** Project → Feature → Task
- **Project**: a named initiative with status, description. Linked to workspace via \`has_project\` edge.
- **Feature**: a capability or deliverable within a project. Linked via \`has_feature\` edge.
- **Task**: an actionable work item. Can belong to a feature (\`has_task\`) or directly to a project (\`belongs_to\`). Has status (open/todo/ready/in_progress/blocked/done/completed), priority, category, optional owner and deadline.

**Cross-cutting entities** (attach to any level via \`belongs_to\`):
- **Decision**: a choice that was made. Status lifecycle: extracted → proposed → provisional → confirmed → superseded. Can conflict with other decisions (\`conflicts_with\` edge).
- **Question**: an open question requiring a choice. Only for pending decisions, not informational queries.
- **Observation**: a lightweight signal (info/warning/conflict). Lifecycle: open → acknowledged → resolved. Used for cross-project intelligence.
- **Suggestion**: a proactive agent-to-human proposal. Categories: optimization, risk, opportunity, conflict, missing, pivot. Lifecycle: pending → accepted/dismissed/deferred → converted.

**Other entities:** Person (with ownership edges), Meeting, Document, Git Commit, Pull Request.

**Key relationships (graph edges):**
- \`has_project\`: workspace → project
- \`has_feature\`: project → feature
- \`has_task\`: feature → task
- \`belongs_to\`: task|decision|question → feature|project
- \`depends_on\`: task|feature → task|feature (blocks/needs/soft)
- \`conflicts_with\`: decision|feature ↔ decision|feature
- \`owns\`: person → task|project|feature
- \`observes\`: observation → project|feature|task|decision|question
- \`suggests_for\`: suggestion → project|feature|task|question|decision
- \`suggestion_evidence\`: suggestion → observation|decision|task|feature|project|question|person|workspace
- \`superseded_by\`: decision → decision

**Entity ID format:** MCP tools use \`table:id\` for polymorphic references (e.g. \`task:abc123\`, \`decision:def456\`).

## MCP Tools Available

### Context (progressive detail)
- \`get_workspace_context\` — Workspace overview: projects with entity counts, hot items, active sessions. Already loaded at session start.
- \`get_project_context\` — Full project context: decisions, tasks, questions, observations, suggestions. Requires project_id.
- \`get_task_context\` — Task-focused: subgraph (subtasks, deps, siblings) + project hot items. Requires task_id, resolves project automatically.

### Read (use freely)
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
6. **Write descriptive commit messages and include task IDs.** Include the raw task ID(s) in the commit message to make webhook processing and follow-up linking/review unambiguous. Use a clear token like \`task:<raw-task-id>\` (or multiple, e.g. \`tasks: <id1>, <id2>\`). Describe *what* changed and *why*.`;

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
