# Ralph Fix Plan - Coding Agent Integration

## High Priority

### MCP Context Builder (Layer 1: Session Start)
- [x] Create `agent_session` table and `subtask_of` relation schema migration
- [x] Create MCP route handler (`/api/mcp/:workspaceId/context`, `/api/mcp/:workspaceId/projects`)
- [x] Implement `buildProjectContext()` — assembles full context packet for coding agents
- [x] Register MCP routes in `start-server.ts`
- [ ] Add workspace API key auth to MCP endpoints
- [ ] Implement task-scoped context auto-status (move task to "in_progress" on session start)
- [ ] Add `since` diff tracking (recent_changes since last session per directory)

### MCP Write Tools (Layer 2: Mid-Session)
- [ ] `update_task_status` — update task status with parent rollup computation
- [ ] `create_subtask` — create child task with `subtask_of` edge + semantic dedup
- [ ] `log_implementation_note` — append to entity `description_entries`
- [ ] Task status rollup logic (compute parent status from subtask states)

### Session Lifecycle (Layer 3: Session End)
- [ ] `session_start` endpoint — create `agent_session` entity, infer project, return context
- [ ] `session_end` endpoint — finalize session summary, link produced entities
- [ ] Git hook integration (`log_commit` endpoint for post-commit hook)

## Medium Priority
- [ ] Semantic dedup for subtask creation (prevent duplicate subtasks across agents)
- [ ] Token budgeting for context packets (priority-ordered truncation)
- [ ] Constraint extraction from decisions/features
- [ ] `get_task_dependencies` — full dependency tree traversal
- [ ] `get_architecture_constraints` — constraint extraction from decisions

## Low Priority
- [ ] Directory-to-project cache (`~/.brain/dir-cache.json`)
- [ ] Pre-commit hook governance check (constraint violation detection)
- [ ] Feed cards for agent sessions (SessionSummaryCard)

## Completed
- [x] Project enabled for Ralph
- [x] Schema migration: `agent_session`, `subtask_of`, `produced`, `asked`, `progressed` relations
- [x] MCP route handler with workspace/project validation
- [x] Context builder: decisions (confirmed/provisional/contested), active tasks, open questions, observations, recent changes
- [x] Task-scoped context: subtasks, parent feature, siblings, dependencies, related sessions

## Notes
- Existing chat tools (`create_provisional_decision`, `search_entities`, `get_entity_detail`, etc.) can be reused by MCP — they already support `actor: "mcp"` in `ChatToolExecutionContext`
- PM agent pattern (`agents/pm/`) is the reference for MCP tool composition
- All graph queries are workspace-scoped via `workspaceRecord`
- Schema is SCHEMAFULL — every field must be explicitly defined
