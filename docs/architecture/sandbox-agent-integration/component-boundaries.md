# Component Boundaries: Sandbox Agent Integration

## 1. Adapter Interface Design

The adapter interface is a narrow port wrapping only the SandboxAgent SDK methods Brain calls. It serves as the testability seam and dependency isolation boundary per D-07.

### Why an Adapter (Not Direct SDK Usage)

1. **SDK is 0.x** -- Breaking changes expected; adapter contains blast radius to one file
2. **Testability** -- Tests inject mock adapters without running SandboxAgent Server
3. **Functional paradigm** -- Factory function returns a typed object, no class hierarchy

### Adapter Port Type

The adapter exposes exactly the methods Brain's orchestrator needs. Nothing more.

```
SandboxAgentAdapter = {
  createSession: (config) => Promise<SessionHandle>
  resumeSession: (sessionId) => Promise<SessionHandle>
  destroySession: (sessionId) => Promise<void>
  setMcpConfig: (cwd, name, config) => Promise<void>
}

SessionHandle = {
  id: string
  prompt: (messages) => Promise<PromptResult>
  onEvent: (handler) => Unsubscribe
  onPermissionRequest: (handler) => Unsubscribe
  respondPermission: (id, decision) => Promise<void>
}
```

**Answer to Q-04**: The adapter abstracts at the **SDK level** (wrapping the SDK instance), not at the session level. Rationale: session handles are SDK-specific objects with SDK-specific event types. The adapter creates session handles through `createSession`/`resumeSession` and returns Brain-owned `SessionHandle` types that the orchestrator can work with. This keeps the SDK boundary at a single point (the adapter factory).

### Adapter Factory

```
createSandboxAgentAdapter: (config: {
  serverUrl: string
}) => SandboxAgentAdapter
```

The factory creates the SDK instance (using the built-in `InMemorySessionPersistDriver` for R1) and returns the adapter. In tests, a mock adapter is injected directly. A custom SurrealDB persistence driver can be added later for cloud providers (#187).

## 2. Orchestrator Module Decomposition

### Current State (files and their fate)

| File | Current Role | Migration Action |
|------|-------------|-----------------|
| `spawn-agent.ts` | Wraps `query()` from Claude Agent SDK | **Replace**: new file delegates to SandboxAgent adapter |
| `agent-options.ts` | Builds Claude Agent SDK options (stdio MCP, allowed tools, etc.) | **Remove**: replaced by adapter config + `setMcpConfig()` |
| `event-bridge.ts` | Transforms Claude SDK `SdkMessage` to `StreamEvent` | **Replace**: new bridge for SandboxAgent universal event schema |
| `session-lifecycle.ts` | In-memory handle registry, create/abort/accept/reject/review/prompt | **Refactor**: eliminate `handleRegistry`, use SurrealDB for session lookup, delegate prompt to adapter |
| `routes.ts` | HTTP handlers + wiring factory | **Modify**: update wiring to use adapter instead of `QueryFn` |
| `types.ts` | Status types, assignment types | **Extend**: add new session-related types |
| `worktree-manager.ts` | Git worktree CRUD | **Keep**: used for local provider only (unchanged) |
| `stall-detector.ts` | Activity monitoring | **Adapt**: wire to new event bridge activity signals |
| `assignment-guard.ts` | Task validation | **Keep**: unchanged |

### New Components

| Component | File (proposed) | Responsibility |
|-----------|----------------|---------------|
| **SandboxAgent Adapter** | `orchestrator/sandbox-adapter.ts` | Narrow port type + production factory wrapping SDK |
| **Event Bridge v2** | `orchestrator/sandbox-event-bridge.ts` | Translate SandboxAgent events to `StreamEvent` + trace records |
| **Permission Handler** | `orchestrator/permission-handler.ts` | Map `onPermissionRequest` to SSE prompt + user response routing |
| **Session Store** | `orchestrator/session-store.ts` | SurrealDB queries for session CRUD (replaces in-memory registry) |

### Deprecated Components (to be removed after migration)

| Component | Reason |
|-----------|--------|
| `spawn-agent.ts` (current) | Replaced by adapter-based spawn in session-lifecycle |
| `agent-options.ts` | Claude SDK options no longer needed |
| `event-bridge.ts` (current) | Replaced by sandbox-event-bridge.ts |
| In-memory `handleRegistry` | Replaced by SurrealDB session store |

## 3. Dependency Graph

```
routes.ts
  -> session-lifecycle.ts
       -> sandbox-adapter.ts (port type only)
       -> session-store.ts (SurrealDB session CRUD)
       -> worktree-manager.ts (local provider only)
       -> assignment-guard.ts (unchanged)
  -> sandbox-event-bridge.ts
       -> permission-handler.ts
       -> stall-detector.ts
```

**Dependency rules:**
- `sandbox-adapter.ts` defines the port TYPE only. The production implementation wrapping the SDK is in a separate module or inline in wiring.
- `sandbox-event-bridge.ts`, `permission-handler.ts` must NOT import from `session-lifecycle.ts` (dependencies flow inward).
- Only `routes.ts` (the wiring layer) may import the concrete adapter factory.

## 4. What Stays Unchanged

| Component | Location | Why |
|-----------|----------|-----|
| Brain-native agents | `chat/`, `agents/pm/`, `observer/`, `agents/analytics/` | Not sandbox-executed; run in-process with AI SDK (D-06) |
| LLM Proxy | `proxy/` | Unchanged -- agents still route LLM traffic through same proxy URL |
| Tool Registry | `tool-registry/` | Unchanged -- dynamic MCP endpoint (R2) builds on existing grant resolution |
| SSE Registry | `streaming/sse-registry.ts` | Unchanged -- event bridge pushes to existing SSE infrastructure |
| DPoP/RAR Auth | `oauth/`, `auth/` | Unchanged -- proxy tokens and MCP auth issued through same flow |
| Assignment Guard | `orchestrator/assignment-guard.ts` | Unchanged -- task validation logic unaffected |

## 5. Interface Contracts (Between Components)

### Event Bridge -> SSE Registry

Uses existing `SseRegistry.emitEvent(streamId, StreamEvent)` interface. No changes needed to SSE registry.

### Event Bridge -> Trace Graph

New trace writes for SandboxAgent events:

```
createToolCallTrace: (sessionId, toolName, args, result, durationMs) => Promise<void>
createFileEditTrace: (sessionId, filePath, changeType) => Promise<void>
createPermissionTrace: (sessionId, permissionId, toolName, decision) => Promise<void>
```

### Session Lifecycle -> Sandbox Adapter

Uses the adapter port type defined in `sandbox-adapter.ts`. Production wiring injects the real adapter; tests inject mocks.

### Permission Handler -> SSE Registry + Route Handler

1. `onPermissionRequest` event arrives from adapter
2. Permission handler emits `AgentPermissionRequestEvent` to SSE registry
3. UI renders approve/reject controls
4. User response arrives via new HTTP endpoint `POST .../sessions/:id/permission/:permId`
5. Permission handler calls `adapter.respondPermission(id, decision)`
6. Trace record created for permission decision

## 6. Release Boundary Mapping

### Release 1: Multi-Turn + Persistence (Core Migration)

**Components modified/created:**
- `sandbox-adapter.ts` (new)
- `sandbox-event-bridge.ts` (new)
- `session-store.ts` (new)
- `session-lifecycle.ts` (refactored -- eliminate handleRegistry, wire adapter)
- `routes.ts` (modified -- update wiring factory)
- `types.ts` (extended)
- `shared/contracts.ts` (extended -- new event types)
- SurrealDB migration for `agent_session` sandbox fields (`provider`, `session_type`)

**Components unchanged:**
- `worktree-manager.ts`, `assignment-guard.ts`, `stall-detector.ts`

### Release 2: Dynamic MCP Endpoint + Governance

**Components modified/created:**
- Dynamic MCP endpoint route (new, in `mcp/` domain)
- `session-lifecycle.ts` (add `setMcpConfig` call during spawn)
- `permission-handler.ts` (new)
- Permission HTTP endpoint (new route in `routes.ts`)

### Release 3: Provider Configuration + Agent Portability

**Components modified/created:**
- Workspace settings for sandbox provider (new, in `workspace/` domain)
- Provider-specific session config (adapter factory parameterization)
- `session-lifecycle.ts` (conditional worktree creation based on provider)
