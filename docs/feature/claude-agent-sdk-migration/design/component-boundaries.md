# Component Boundaries: Claude Agent SDK Migration

## Module Architecture

The orchestrator follows dependency-inversion with function-signature ports. Domain logic is pure; effects (DB, network, process) are injected as function parameters.

```
                    +-----------------+
                    |   routes.ts     |  <- HTTP boundary (driving port)
                    +--------+--------+
                             |
                    +--------v--------+
                    | session-        |  <- Domain: session state machine
                    | lifecycle.ts    |     (pure logic + injected effects)
                    +--+---------+----+
                       |         |
          +------------+    +----+----------+
          |                 |               |
+---------v--+   +----------v---+   +-------v--------+
| spawn-     |   | event-       |   | stall-         |
| agent.ts   |   | bridge.ts    |   | detector.ts    |
| [NEW]      |   | [MODIFIED]   |   | [UNCHANGED]    |
+-----+------+   +------+-------+   +----------------+
      |                  |
+-----v------+    +------v-------+
| agent-     |    | StreamEvent  |  <- Shared contract
| options.ts |    | (contracts)  |     (unchanged)
| [NEW]      |    +--------------+
+-----+------+
      |
+-----v-----------+
| Claude Agent SDK |  <- Driven port (external dependency)
+------------------+
```

## File-by-File Change Map

### Deleted Files

| File | Reason |
|------|--------|
| `app/src/server/orchestrator/spawn-opencode.ts` | Replaced by `spawn-agent.ts` |
| `app/src/server/orchestrator/config-builder.ts` | Replaced by `agent-options.ts` |

### New Files

| File | Responsibility | Dependencies (inward only) |
|------|---------------|---------------------------|
| `app/src/server/orchestrator/spawn-agent.ts` | Invoke `query()`, return `AgentHandle` | `agent-options.ts`, `@anthropic-ai/claude-agent-sdk` |
| `app/src/server/orchestrator/agent-options.ts` | Build SDK `Options` from Osabio config (pure) | None (leaf module) |

### Modified Files

| File | What Changes | What Stays |
|------|-------------|------------|
| `event-bridge.ts` | `SdkMessage` replaces `OpencodeEvent` as input type; `transformSdkMessage()` replaces `transformOpencodeEvent()` | Bridge handle pattern, stall detector integration, `EventBridgeDeps` port shape |
| `session-lifecycle.ts` | `AgentHandle` replaces `OpenCodeHandle`; `SpawnAgentFn` replaces `SpawnOpenCodeFn`; `opencode_session_id` field no longer written | All session operations (create/abort/accept/reject/review/prompt), handle registry, event iteration, DB queries |
| `routes.ts` | `spawnOpenCodeImport` -> `spawnAgentImport`; `ORCHESTRATOR_MOCK_OPENCODE` env var rename | All route handlers, wiring pattern, SSE stream handler |
| `cli/commands/init-content.ts` | Remove `OPENCODE_PLUGIN_CONTENT`, `buildOpencodeJsonContent()`, `OPENCODE_MD_CONTENT` | `OSABIO_HOOKS`, `OSABIO_CLAUDE_MD`, `OSABIO_COMMANDS` (Claude Code integration unchanged) |
| `cli/commands/init.ts` | Remove or simplify `setupOpencode()` | All other init steps (auth, MCP, hooks, CLAUDE.md, commands, git hooks) |

### Unchanged Files

| File | Why Unchanged |
|------|--------------|
| `stall-detector.ts` | Consumes `StallDetectorHandle` interface -- no coupling to event source |
| `assignment-guard.ts` | Pre-spawn validation -- no coupling to agent runtime |
| `worktree-manager.ts` | Git operations -- no coupling to agent runtime |
| `types.ts` | `OrchestratorStatus` enum unchanged; session status machine unchanged |
| `routes.ts` (route handlers) | Handlers delegate to lifecycle functions -- no direct agent coupling |
| `app/src/shared/contracts.ts` | `StreamEvent` union unchanged -- UI contract preserved |
| `cli/mcp-server.ts` | Osabio MCP server unchanged -- same tools, same transport |

## Dependency Inversion: Port Signatures

### SpawnAgentFn (replaces SpawnOpenCodeFn)

```
Input:  AgentSpawnConfig { cwd, systemPrompt, brainBaseUrl, workspaceId, taskId }
Output: Promise<AgentHandle { abort: () => void, messages: AsyncIterable<SdkMessage> }>
```

The spawn function signature is the port. `session-lifecycle.ts` depends on this signature, not on the SDK. The SDK is only imported inside `spawn-agent.ts`.

### EventBridgeDeps (unchanged shape)

```
emitEvent: (streamId, event: StreamEvent) -> void
updateLastEventAt: (sessionId) -> Promise<void>
```

### AgentHandle (replaces OpenCodeHandle)

```
AgentHandle {
  abort: () -> void                       // triggers AbortController
  messages: AsyncIterable<SdkMessage>     // typed SDK message stream
}
```

Note: `sendPrompt` is removed from the handle. The Agent SDK's `query()` is a single-prompt call. Follow-up prompts create new `query()` invocations (or use the SDK's conversation continuation mechanism). The `sendSessionPrompt` lifecycle function will adapt accordingly.

## Effect Boundary Map

| Layer | Pure / Effect | Description |
|-------|--------------|-------------|
| `agent-options.ts` | **Pure** | Config -> Options transform |
| `event-bridge.ts` (transform) | **Pure** | SdkMessage -> StreamEvent |
| `stall-detector.ts` (checks) | **Pure** | checkStallTimeout, checkStepLimit |
| `spawn-agent.ts` | **Effect** | Creates AbortController, calls query() |
| `event-bridge.ts` (bridge handle) | **Effect** | Emits events, updates timestamps |
| `session-lifecycle.ts` | **Effect** | DB reads/writes, spawn orchestration |
| `routes.ts` | **Effect** | HTTP request/response |

## Test Impact

### Tests to Rewrite

| Test File | Reason |
|-----------|--------|
| `tests/unit/coding-agent-orchestrator/config-builder.test.ts` | Replaced by agent-options tests |
| `tests/unit/coding-agent-orchestrator/event-bridge.test.ts` | New SDK message types |
| `tests/unit/coding-agent-orchestrator/session-lifecycle.test.ts` | AgentHandle type change |
| `tests/unit/coding-agent-orchestrator/opencode-plugin-init.test.ts` | Plugin code removed |
| `tests/acceptance/coding-agent-orchestrator/event-bridge.test.ts` | New SDK message types |
| `tests/acceptance/coding-agent-orchestrator/plugin-tools.test.ts` | Plugin replaced by MCP |
| `tests/acceptance/coding-agent-orchestrator/plugin-lifecycle.test.ts` | Plugin replaced by hooks |

### Tests Unchanged

| Test File | Why |
|-----------|-----|
| `stall-detector.test.ts` | No coupling to event source |
| `assignment-guard.test.ts` | No coupling to agent runtime |
| `worktree-manager.test.ts` | No coupling to agent runtime |
| `routes.test.ts` | Tests route handler logic, not spawn internals |
| `walking-skeleton.test.ts` | Uses mock spawn (just needs type update) |
| All UI tests | No coupling to server orchestrator |
