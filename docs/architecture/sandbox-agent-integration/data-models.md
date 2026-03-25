# Data Models: Sandbox Agent Integration

## 1. Schema Extension to `agent_session`

SandboxAgent session state lives directly on `agent_session`. Most fields already exist — only sandbox-specific fields are added.

### Existing fields reused

| SandboxAgent concept | Existing field | Notes |
|---------------------|---------------|-------|
| Runtime session ID | `external_session_id` | Already optional string. SandboxAgent runtime ID goes here (changes on restoration). |
| Agent type | `agent` | Already required string. "claude", "codex", "opencode", etc. |
| Status | `orchestrator_status` | Already has values like "running", "completed", "error". Extend with "restoring". |
| Working directory | `worktree_path` | Already optional string. Worktree path for local, sandbox path for cloud. |
| Workspace | `workspace` | Already required. |
| Created | `created_at` | Already required. |
| Started | `started_at` | Already required. |
| Ended / destroyed | `ended_at` | Already optional datetime. |
| Last event time | `last_event_at` | Already optional datetime. |
| Error info | `error_message` | Already optional string. |
| Worktree branch | `worktree_branch` | Already optional string. Still used for local provider. |

### New fields

```sql
-- schema/migrations/NNNN_sandbox_agent_fields.surql
BEGIN TRANSACTION;

-- Sandbox provider: "local", "docker", "e2b", "daytona"
-- Needed on restart restoration to determine isolation strategy
-- (local = Brain manages worktree, cloud = sandbox handles isolation)
DEFINE FIELD OVERWRITE provider ON agent_session TYPE option<string>;

-- Session type discriminator: "claude_agent_sdk" (current) or "sandbox_agent" (new)
-- Needed to route session operations to the correct adapter on restart restoration
DEFINE FIELD OVERWRITE session_type ON agent_session TYPE option<string>;

COMMIT TRANSACTION;
```

### Fields NOT added

| Considered field | Why excluded |
|-----------------|-------------|
| `mcp_endpoint_url` | Derivable from agent name: `${brainUrl}/mcp/agent/${agentName}` |
| `event_count` | Derivable via query. Not on hot path. |
| `restoration_count` | Observability metric — belongs on traces/spans, not session schema |
| `last_restored_at` | Same — observability, not session state |
| `replay_max_events` | SDK default (50) is sufficient. Override via adapter config, not per-session DB field. |
| `replay_max_chars` | Same — SDK default (12,000) is sufficient. |
| `last_event_seq` | Only needed for SurrealDB persistence driver (deferred). In-memory driver tracks this internally. |

## 2. Session Event Persistence (Deferred)

For R1 (local provider), the SDK's built-in `InMemorySessionPersistDriver` handles event storage for session restoration. Brain and the agent process share the same host — if Brain restarts, the local agent process dies too, so persisted events have no consumer.

A custom SurrealDB `SessionPersistDriver` with a `sandbox_event` table and write buffering (ADR-077) is deferred until cloud provider support where sandboxes outlive Brain restarts. See GitHub issue for tracking.

## 3. Permission Decision Storage

Permission decisions are stored as trace records linked to the session, reusing the existing trace infrastructure rather than creating a new table.

```sql
-- Permission decisions use the existing trace table with specific fields:
-- trace.type = "permission_decision"
-- trace.metadata contains:
--   permission_id: string
--   tool_name: string
--   arguments: string
--   decision: "once" | "always" | "reject" | "timeout"
--   decided_by: "user" | "auto_approve" | "timeout"
--   response_time_ms: int
```

## 4. Migration from In-Memory Handle Registry

### Current State

```typescript
// session-lifecycle.ts -- module-level mutable singleton (anti-pattern per AGENTS.md)
const handleRegistry = new Map<string, AgentHandle>();
```

Session handles are stored in a `Map` at module scope. This violates the project convention against module-level mutable singletons and means all session state is lost on server restart.

### Target State

The `handleRegistry` is eliminated. Session lookup is always via SurrealDB:

1. **Active session discovery**: `SELECT * FROM agent_session WHERE orchestrator_status IN ["running", "idle", "restoring"] AND workspace = $ws AND session_type = "sandbox_agent"`
2. **Session restoration on restart**: Load active sandbox sessions and call `adapter.resumeSession(external_session_id)` for each
3. **Prompt routing**: `sendSessionPrompt()` looks up the `agent_session` record, retrieves `external_session_id`, and calls `adapter.prompt()` — no in-memory handle needed because the adapter talks to SandboxAgent Server via HTTP

### Migration Path

The `handleRegistry` is removed in R1 as part of the session-lifecycle refactor. There is no data migration needed — the in-memory state was always ephemeral.

## 5. Data Flow: Session Operations (R1)

### Lifecycle transitions

```
createSession:
  -> INSERT agent_session with session_type = "sandbox_agent", provider, orchestrator_status = "running"
  -> adapter.createSession() → returns external_session_id
  -> UPDATE agent_session SET external_session_id = $id

prompt:
  -> SELECT agent_session by RecordId
  -> adapter.prompt(external_session_id, messages)
  -> UPDATE agent_session SET last_event_at = time::now()

destroy:
  -> adapter.destroySession(external_session_id)
  -> UPDATE agent_session SET orchestrator_status = "completed", ended_at = time::now()
```

### Event streaming (no persistence)

```
SandboxAgent emits UniversalEvent (session.onEvent())
  -> Event bridge translates to Brain StreamEvent
  -> SSE registry delivers to connected clients
  -> No DB write (in-memory driver handles SDK-internal replay)
```
