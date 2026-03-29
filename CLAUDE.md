Follow @AGENTS.md

## Development Paradigm

functional


<!-- osabio-plugin-start -->
# Osabio Knowledge Graph Integration

This project is connected to the Osabio knowledge graph via MCP tools. The graph contains decisions, constraints, tasks, questions, and observations from all agents and humans working on this workspace.

## Getting Context

Use `get_context` with a description of what you're working on. The server automatically finds the right project, tasks, decisions, and constraints — no need to pass project IDs manually.

Example: `get_context({ intent: "implementing OAuth flow for the auth service" })`

You can include task IDs (`task:abc123`), project names, file paths, or just a plain description.

## Hooks

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

**Entity ID format:** MCP tools use `table:id` for polymorphic references (e.g. `task:abc123`, `decision:def456`).

## Decision Governance

- **Your decisions are always `provisional` or `inferred`** — only humans confirm.
- This means you can move fast without blocking, while humans retain authority.

## Best Practices

1. **Check before deciding.** Call `resolve_decision` first — the answer may already exist from another agent or human.
2. **Ask, don't guess.** If uncertain, `ask_question` is better than `create_provisional_decision`.
3. **Log as you go.** Don't batch decisions for the end. Log each significant choice when you make it.
4. **Decompose tasks.** Use `create_subtask` to break work into pieces, then update status as each completes.
5. **Check constraints.** Before adding a dependency or changing an approach, call `check_constraints`.
6. **Include task IDs in commit messages.** Use `task:<raw-task-id>` (or `tasks: <id1>, <id2>`). Describe *what* changed and *why*.
<!-- osabio-plugin-end -->
