# Requirements: Coding Agent Orchestrator

## Scope

Enable users to assign engineering tasks to a coding agent (via OpenCode SDK) directly from the Brain UI. The agent reads project context via Brain MCP, implements changes, and reports back. Focus: self-hosted OpenCode SDK integration. Cloud (Modal sandboxes) deferred.

## Walking Skeleton (Feature 0)

Minimum end-to-end flow before layering features:

1. **Backend route** that takes a task ID, creates an opencode session, injects MCP config, sends task as prompt
2. **MCP integration** — opencode agent calls existing Brain MCP tools (already implemented)
3. **Status updates** — agent updates task status via MCP `update_task_status`
4. **UI** — "Assign to Agent" button on task card, basic status indicator (assigned/working/done/blocked)

## Functional Requirements

### FR-1: Task Assignment (Job 1)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-1.1 | User can assign a task with status `ready` or `todo` to a coding agent | Must |
| FR-1.2 | System validates task has title + description before allowing assignment | Must |
| FR-1.3 | System creates an opencode session configured with Brain MCP server | Must |
| FR-1.4 | System injects workspace + project context into the session | Must |
| FR-1.5 | System sends task description as initial agent prompt | Must |
| FR-1.6 | Task status transitions to `in_progress` upon assignment | Must |
| FR-1.7 | An `agent_session` record is created linking task ↔ opencode session | Must |
| FR-1.8 | Agent works on an auto-created git branch (`agent/<task-slug>`) | Should |
| FR-1.9 | User can select model/provider override at assignment time | Could |

### FR-2: Agent Monitoring (Job 2)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-2.1 | Platform subscribes to opencode event stream for active sessions | Must |
| FR-2.2 | Key events (file change, tool call, error, completion) forwarded to Brain SSE | Must |
| FR-2.3 | Task detail page shows live activity feed for assigned agent | Should |
| FR-2.4 | Agent can update task status via MCP (`in_progress`, `blocked`) | Must |
| FR-2.5 | Agent can create observations via MCP for blockers/risks | Must |
| FR-2.6 | Platform detects stalled/looping agents via timeout or step count | Should |

### FR-3: Review & Accept (Job 3)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-3.1 | When agent completes, task shows review state with diff summary | Must |
| FR-3.2 | Session trace (reasoning, tool calls) visible in review | Should |
| FR-3.3 | User can accept → task moves to `done` | Must |
| FR-3.4 | User can reject with feedback → sent as follow-up prompt, task back to `in_progress` | Should |
| FR-3.5 | Agent observations visible alongside diff in review | Should |

## Non-Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| NFR-1 | OpenCode session creation < 5s | Must |
| NFR-2 | SSE event forwarding latency < 1s from opencode → Brain UI | Should |
| NFR-3 | Agent session cleanup on abort/timeout (no orphaned processes) | Must |
| NFR-4 | Only one active agent session per task at a time | Must |
| NFR-5 | Agent authority scoped to `code_agent` role in authority framework | Must |

## Architecture Integration Points

### Existing infrastructure to leverage:
- **Authority framework** (`iam/authority.ts`) — define `code_agent` permissions
- **MCP route** (`mcp/mcp-route.ts`) — agent already has full MCP tool access
- **Agent session tracking** (`agent_session` table) — extend with opencode session ID
- **SSE registry** (`streaming/sse-registry.ts`) — extend with agent event forwarding
- **Tool composition** (`chat/tools/`) — reuse shared tools

### New components needed:
- **OpenCode orchestrator service** — manages opencode SDK lifecycle (create, prompt, subscribe, abort)
- **Agent assignment route** — `POST /api/workspaces/:wsId/tasks/:taskId/assign-agent`
- **Agent event bridge** — subscribes to opencode events, forwards to Brain SSE
- **UI: assign button + activity feed** — task card enhancement

## Out of Scope (v1)

- Cloud sandboxes (Modal) — deferred
- Multiple concurrent agents per task
- Agent-to-agent delegation
- Custom agent instructions beyond task context
- Cost tracking / billing per agent session
