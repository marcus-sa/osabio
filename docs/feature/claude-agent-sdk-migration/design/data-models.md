# Data Models: Claude Agent SDK Migration

## Core Type Definitions

### AgentHandle (replaces OpenCodeHandle)

```
AgentHandle = {
  abort: () -> void                       // Triggers AbortController.abort()
  messages: AsyncIterable<SdkMessage>     // Typed SDK message stream
}
```

**Removed from handle**: `sessionId` (SDK-internal concept, not needed), `sendPrompt` (SDK uses new query() per prompt), `eventStream` (renamed to `messages` for SDK alignment).

### SpawnAgentFn (replaces SpawnOpenCodeFn)

```
SpawnAgentFn = (config: AgentSpawnConfig) -> Promise<AgentHandle>
```

**Simplified signature**: Single config object instead of positional params `(config, worktreePath, taskId)`.

### AgentSpawnConfig

```
AgentSpawnConfig = {
  cwd: string                             // Worktree path
  systemPrompt: string                    // Task-scoped system prompt
  brainBaseUrl: string                    // Osabio server URL for MCP env vars
  workspaceId: string                     // Workspace ID for MCP env vars
  taskId: string                          // Task being worked on
  model?: string                          // Override model (default: claude-sonnet-4)
}
```

### AgentOptions (SDK Options object)

```
AgentOptions = {
  prompt: string                          // System prompt with task context
  cwd: string                             // Working directory (worktree)
  model: string                           // Claude model identifier
  permissionMode: "bypassPermissions"     // Autonomous operation
  mcpServers: {
    brain: {
      type: "stdio"
      command: "brain"
      args: ["mcp"]
      env: {
        OSABIO_SERVER_URL: string
        OSABIO_WORKSPACE_ID: string
      }
    }
  }
  hooks?: HookCallbacks                   // Lifecycle hook functions
  abortController?: AbortController       // Cancellation signal
}
```

### HookCallbacks

```
HookCallbacks = {
  onSessionStart?: () -> Promise<void>
  onPreToolUse?: (toolName: string, toolInput: unknown) -> Promise<void>
  onUserPromptSubmit?: (prompt: string) -> Promise<void>
  onStop?: () -> Promise<void>
  onPreCompact?: () -> Promise<string | undefined>
  onSessionEnd?: (summary: string) -> Promise<void>
}
```

All callbacks are fire-and-forget (errors swallowed with logging) except `onSessionEnd` which awaits with timeout.

## SDK Message Types (Input to Event Bridge)

The SDK `query()` returns `AsyncIterable<SdkMessage>`. Key message shapes:

```
SdkMessage =
  | { type: "assistant", content: ContentBlock[] }
  | { type: "result", subtype: "success", duration_ms: number, usage: Usage }
  | { type: "result", subtype: "error", error: string }
  | { type: "tool_use", name: string, input: unknown }
  | { type: "tool_result", name: string, output: string }
```

```
ContentBlock =
  | { type: "text", text: string }
  | { type: "tool_use", id: string, name: string, input: unknown }
  | { type: "tool_result", tool_use_id: string, content: string }
```

## Event Translation Map

### SdkMessage -> StreamEvent

```
transformSdkMessage(message: SdkMessage) -> StreamEvent | StreamEvent[] | undefined

Rules:
  assistant + text content   -> AgentTokenEvent { type: "agent_token", sessionId, token }
  tool_result + file change  -> AgentFileChangeEvent { type: "agent_file_change", sessionId, file, changeType }
  result + success           -> AgentStatusEvent { type: "agent_status", sessionId, status: "completed" }
  result + error             -> AgentStatusEvent { type: "agent_status", sessionId, status: "error", error }
  tool_use                   -> (step count increment for stall detector, no StreamEvent)
```

### File Change Detection

File changes are detected from tool results. The SDK provides tool output that includes file paths. The bridge inspects tool results for:
- Tool name patterns: `write_file`, `edit_file`, `create_file`, `delete_file` (Bash tool file ops)
- The existing `STEP_EVENT_TYPES` set is adapted to match SDK tool names instead of OpenCode event types

## Unchanged Types

### StreamEvent (contracts.ts) -- NO CHANGES

```
StreamEvent =
  | AgentTokenEvent
  | AgentFileChangeEvent
  | AgentStatusEvent
  | AgentStallWarningEvent
  | AgentPromptEvent
  | TokenEvent | ReasoningEvent | AssistantMessageEvent
  | ExtractionEvent | OnboardingSeedEvent | OnboardingStateEvent
  | ObservationEvent | DoneEvent | ErrorEvent
```

### OrchestratorStatus (types.ts) -- NO CHANGES

```
OrchestratorStatus = "spawning" | "active" | "idle" | "completed" | "aborted" | "error"
```

### SessionRow (session-lifecycle.ts) -- NO CHANGES

The `agent_session` DB record shape is unchanged. The `opencode_session_id` field becomes unused but is not removed (no migration needed -- schema change is a separate concern).

### EventBridgeDeps (event-bridge.ts) -- NO CHANGES

```
EventBridgeDeps = {
  emitEvent: (streamId: string, event: StreamEvent) -> void
  updateLastEventAt: (sessionId: string) -> Promise<void>
}
```

### StallDetectorHandle -- NO CHANGES

```
StallDetectorHandle = {
  recordActivity: () -> void
  incrementStepCount: () -> void
  stop: () -> void
}
```

## Data Flow Summary

```
buildAgentOptions(spawnConfig)
  |
  v
AgentOptions (pure value)
  |
  v
query(options) -> AsyncIterable<SdkMessage>
  |
  v
for await (message of messages)
  |
  v
transformSdkMessage(message) -> StreamEvent
  |
  v
emitEvent(streamId, streamEvent) -> SSE to browser
```

Every step in the pipeline is either a pure transform or an injected effect. No hidden state, no shared mutable references.
