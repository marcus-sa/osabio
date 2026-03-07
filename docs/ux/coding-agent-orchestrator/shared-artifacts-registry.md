# Shared Artifacts Registry: Coding Agent Orchestrator

## Artifact Definitions

| ID | Type | Schema/Shape | Source of Truth | Consumers |
|----|------|-------------|-----------------|-----------|
| `task` | SurrealDB record | `task` table (schema.surql L102-131) | Knowledge graph | UI, MCP, Agent |
| `agent_session` | SurrealDB record | `agent_session` table | Brain platform | UI, Review |
| `opencode_session` | External (OpenCode SDK) | `Session` type from SDK | OpenCode server | Platform orchestrator |
| `project_context` | MCP context packet | `get_project_context` response | Brain MCP server | Agent |
| `file_changes` | Git diff | Standard unified diff | Git repository | Review UI |
| `observation` | SurrealDB record | `observation` table | Knowledge graph | UI, Agent context |

## Variable Tracking

| Variable | First Set | Used By | Format |
|----------|-----------|---------|--------|
| `${taskId}` | Pre-existing | Assign, Monitor, Review | UUID string |
| `${workspaceId}` | Pre-existing | All phases | UUID string |
| `${opencodeSessionId}` | Assign:create-opencode-session | Monitor, Review | OpenCode session ID |
| `${agentSessionId}` | Assign:create-opencode-session | Monitor, Review | UUID (agent_session record) |
| `${branchName}` | Assign:create-opencode-session | Working, Review | `agent/${taskId}` pattern |

## Integration Points

### Brain Platform → OpenCode SDK
- `createOpencode()` or `createOpencodeClient()` to connect
- `session.create()` to start agent session
- `session.prompt()` to send task + inject context
- `session.abort()` to cancel runaway agents
- `event.subscribe()` to stream progress events

### OpenCode Agent → Brain MCP
- `get_task_context` — read task details, dependencies, related entities
- `get_project_context` — read project structure, decisions, conventions
- `update_task_status` — move task through lifecycle
- `create_observation` — signal blockers, risks, questions
- `search_entities` — find related work items
