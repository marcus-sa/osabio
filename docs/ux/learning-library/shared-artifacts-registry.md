# Shared Artifacts Registry: Learning Library

## Artifacts

### workspace_id

| Field | Value |
|-------|-------|
| Source of truth | Client-side `workspace-state` store, set during auth/workspace selection |
| Consumers | All API calls (`/api/workspaces/:workspaceId/learnings`), sidebar context |
| Owner | Workspace module |
| Integration risk | LOW -- already established pattern used by feed, graph, chat |
| Validation | Workspace must exist and user must be a member |

### learning_list

| Field | Value |
|-------|-------|
| Source of truth | API: `GET /api/workspaces/:workspaceId/learnings` with query params |
| Consumers | Learning list view (all tabs), tab counts, filter results |
| Owner | Learning module |
| Integration risk | MEDIUM -- filter params must match API query param names exactly |
| Validation | Response shape matches `LearningListItem` contract |

### pending_count

| Field | Value |
|-------|-------|
| Source of truth | Derived from `learning_list` filtered by `status=pending_approval` |
| Consumers | Pending tab label badge, sidebar "Learnings" nav badge |
| Owner | Learning module (client-side derived state) |
| Integration risk | HIGH -- must update in real-time after approve/dismiss actions |
| Validation | Count must decrement immediately after approve/dismiss, not wait for refetch |

### learning_type

| Field | Value |
|-------|-------|
| Source of truth | Schema enum: `constraint`, `instruction`, `precedent` |
| Consumers | Card badges, type filter dropdown, create/edit dialog type selector, detail view |
| Owner | Shared contracts (`LEARNING_TYPES` constant) |
| Integration risk | HIGH -- must be consistent across all display and filter contexts |
| Validation | Values from `LEARNING_TYPES` in `shared/contracts.ts` |

### target_agents

| Field | Value |
|-------|-------|
| Source of truth | Learning record field: `target_agents` (array of strings) |
| Consumers | Card agent chips, agent filter dropdown, create/edit dialog checkboxes, detail view |
| Owner | Learning module |
| Integration risk | MEDIUM -- empty array means "all agents", must be displayed as "All agents" not as empty |
| Validation | Known agent types: `chat_agent`, `pm_agent`, `observer_agent`, `mcp` |

### learning_status

| Field | Value |
|-------|-------|
| Source of truth | Learning record field: `status` |
| Consumers | Tab selection, card display, available actions per card |
| Owner | Learning module |
| Integration risk | HIGH -- status determines which actions are available (active->deactivate, pending->approve/dismiss) |
| Validation | Valid transitions: `pending_approval`->`active` (approve), `pending_approval`->`dismissed` (dismiss), `active`->`deactivated` (deactivate) |

### collision_results

| Field | Value |
|-------|-------|
| Source of truth | API response from create/approve endpoints (collision detection) |
| Consumers | Create dialog collision warning, approve dialog collision warning |
| Owner | Learning collision module (server-side) |
| Integration risk | MEDIUM -- collision check is async and may return after user has moved on |
| Validation | Each collision result includes: type, similar_learning_text, similarity_score |

### dismiss_reason

| Field | Value |
|-------|-------|
| Source of truth | User input in dismiss dialog |
| Consumers | API: `reason` field in dismiss action, dismissed learnings detail view |
| Owner | Learning module |
| Integration risk | LOW -- write-once field, read in dismissed tab |
| Validation | Required (non-empty) when dismissing |

## Known Agent Types

These values populate the agent filter dropdown and target agent checkboxes.

| Agent Type | Display Name | Description |
|------------|-------------|-------------|
| `chat_agent` | Chat Agent | Primary conversational agent |
| `pm_agent` | PM Agent | Product management subagent |
| `observer_agent` | Observer Agent | Pattern detection and conflict scanning |
| `mcp` | Coding Agents (MCP) | External coding agents via MCP protocol |

Source: Agent types are defined across `agents/pm/`, `agents/observer/`, `chat/`, and `mcp/` server modules. An explicit shared constant should be created during implementation.

## Integration Checkpoints

### Checkpoint 1: Tab Count Consistency

After any approve/dismiss/deactivate action, the tab counts MUST update without a full page reload. Optimistic updates are acceptable but must reconcile with server state on next fetch.

### Checkpoint 2: Filter-to-API Param Mapping

| UI Filter | API Query Param | Values |
|-----------|----------------|--------|
| Type dropdown | `?type=` | `constraint`, `instruction`, `precedent` |
| Agent dropdown | `?agent=` | `chat_agent`, `pm_agent`, `observer_agent`, `mcp` |
| Status (tab) | `?status=` | `active`, `pending_approval`, `dismissed`, `deactivated` |

### Checkpoint 3: Action Availability by Status

| Current Status | Available Actions | Unavailable Actions |
|---------------|-------------------|---------------------|
| `active` | Edit, Deactivate | Approve, Dismiss |
| `pending_approval` | Approve, Dismiss | Edit, Deactivate |
| `dismissed` | (view only) | All actions |
| `deactivated` | (view only) | All actions |

### Checkpoint 4: Empty Array Semantics

`target_agents: []` in the API means "applies to ALL agents." The UI must display this as "All agents" not as an empty or missing field. The create dialog defaults to "All agents" (sends empty array).
