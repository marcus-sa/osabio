# Technology Stack: Sandbox Agent Integration

## Core Dependencies

### SandboxAgent SDK

| Attribute | Value |
|-----------|-------|
| Package | `@anthropic-ai/sandbox-agent` (pending Q-01 confirmation) |
| Version | Pin to specific 0.x release (e.g., 0.4.x) |
| License | Apache 2.0 |
| GitHub | https://github.com/rivet-dev/sandbox-agent |
| Maintenance | Active development by Rivet; 1.2k stars; regular releases |
| Risk | 0.x semver -- breaking changes expected; mitigated by adapter interface (D-07) |

**Alternatives considered:**

1. **Direct Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`)** -- Current approach. Single-shot `query()`, no multi-turn, no session persistence, no sandbox abstraction. Rejected: does not meet multi-turn (US-04) or restoration (US-05) requirements.

2. **Custom agent process manager** -- Build sandbox orchestration from scratch using Docker SDK + E2B SDK. Rejected: 3-4x implementation effort for sandbox provider abstraction, session lifecycle, and event streaming that SandboxAgent already provides. Not justified given team size and timeline.

3. **OpenHands / SWE-agent** -- Alternative agent orchestration frameworks. Rejected: tied to specific agent models, no MCP support, no custom persistence driver interface, different governance model.

### SandboxAgent Server (Rust Binary)

| Attribute | Value |
|-----------|-------|
| Package | `sandbox-agent` (Rust binary, installed separately) |
| Version | Match SDK version |
| License | Apache 2.0 |
| Deployment | Local binary for development; containerized for production |
| Role | Manages agent processes in sandboxes; Brain communicates via SDK |

## Existing Infrastructure (No Changes)

These components are already in Brain and require no new dependencies:

| Component | Technology | Role in Integration |
|-----------|-----------|-------------------|
| SurrealDB | SurrealDB 3.0 (Docker) | Session persistence, event storage, trace records |
| LLM Proxy | Brain in-process module | LLM traffic routing, spend tracking |
| Tool Registry | Brain server module (#183) | Grant resolution, credential brokerage |
| SSE Registry | Brain server module | Real-time event delivery to UI |
| DPoP/RAR Auth | jose + Brain auth module | Token issuance for agent sessions |
| Worktree Manager | Brain orchestrator module | Git worktree isolation for local provider |

## Event Schema Mapping Strategy

SandboxAgent emits a universal event schema across all supported agent types. Brain must translate these events into its existing `StreamEvent` union type and trace graph entities.

### Event Type Mapping

| SandboxAgent Event | Brain StreamEvent | Trace Record | Notes |
|-------------------|-------------------|--------------|-------|
| `tool_call` | `agent_token` (tool name + args) | `trace` with tool call details | Includes tool name, arguments, result, duration |
| `file_edit` | `agent_file_change` | `trace` with file path + change type | Maps directly to existing file change event |
| `permission_request` | New: `agent_permission_request` | `trace` with permission details | New event type added to `StreamEvent` union |
| `text` / `message` | `agent_token` | None | Agent output text |
| `result` | `agent_status` (completed/error) | None | Terminal event |
| `system` | `agent_token` (informational) | None | Non-critical system messages |
| Unknown types | Logged + skipped | None | Forward-compatible with SDK updates |

### New StreamEvent Types

The `StreamEvent` union in `shared/contracts.ts` will be extended with:

```typescript
// New types for SandboxAgent events
type AgentPermissionRequestEvent = {
  type: "agent_permission_request";
  sessionId: string;
  permissionId: string;
  toolName: string;
  arguments: string;
  timeoutSeconds: number;
};

type AgentPermissionResponseEvent = {
  type: "agent_permission_response";
  sessionId: string;
  permissionId: string;
  decision: "once" | "always" | "reject" | "timeout";
};

type AgentRestorationEvent = {
  type: "agent_restoration";
  sessionId: string;
  status: "started" | "completed" | "failed";
  eventsReplayed?: number;
  totalEvents?: number;
};
```

## Session Persistence Strategy

### R1: In-Memory (Local Provider)

R1 uses the SDK's built-in `InMemorySessionPersistDriver` for event replay during session restoration. Session lifecycle state (`agent_session` table) is persisted in SurrealDB via the session store module.

Brain's session store operations (not the SDK persistence driver):

| Operation | SurrealDB Query | Notes |
|-----------|----------------|-------|
| Create session | `CREATE agent_session CONTENT {...}` | With `session_type = "sandbox_agent"`, `provider` |
| Get session | `SELECT * FROM $record` | By RecordId |
| List sandbox sessions | `SELECT * FROM agent_session WHERE workspace = $ws AND session_type = "sandbox_agent"` | Filtered by workspace + type |
| Update status | `UPDATE $record MERGE { orchestrator_status: $status }` | Status transitions |

### Deferred: SurrealDB Persistence Driver (Cloud Providers)

A custom SurrealDB `SessionPersistDriver` with `sandbox_event` table and 100ms write buffering is deferred until cloud provider support where sandboxes outlive Brain restarts. See ADR-077 and [#187](https://github.com/marcus-sa/brain/issues/187).

## Development Paradigm Alignment

All new code follows the functional paradigm established in CLAUDE.md:

| Principle | Application |
|-----------|------------|
| Types-first | Adapter interface, event types, persistence types defined as TypeScript types before implementation |
| Composition pipelines | Event bridge transforms as composed pure functions |
| Pure core / effect shell | Event translation is pure; SSE emission and DB writes are effects at the boundary |
| No classes | Adapter uses factory functions returning typed objects, not class instances |
| No module-level mutable state | Session lookup via SurrealDB, not in-memory Map (eliminates `handleRegistry`) |
| Injectable dependencies | All effects injected as function parameters |
