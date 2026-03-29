# Journey: Orchestrator Spawns Claude Agent

Maps to: **J1** (Orchestrator Spawns Coding Agent) + **J3** (Lifecycle Hooks)

## Current Journey (OpenCode)

```
User clicks "Assign Agent"
  |
  v
POST /api/orchestrator/sessions
  |
  v
validateAssignment() --- check task eligibility
  |
  v
createWorktree() --- git worktree add
  |
  v
buildOpencodeConfig() --- build {mcpServers, model, permissions}
  |                         ^^^ OpenCode-specific shape
  v
spawnOpenCode()
  |-- findFreePort()           <-- fragile: port allocation race
  |-- spawn("opencode", ["serve", ...])  <-- external process
  |-- wait for "listening on" stdout     <-- fragile: stdout parsing
  |-- createOpencodeClient({baseUrl})    <-- third-party SDK
  |-- client.session.create()            <-- OpenCode session API
  |-- client.event.subscribe()           <-- OpenCode event stream
  |-- client.session.command("osabio-start-task", taskId)
  v
OpenCodeHandle { sessionId, sendPrompt, eventStream, abort }
  |
  v
startEventIteration()
  |-- for await (event of eventStream)
  |-- event-bridge.ts transforms OpenCode events -> StreamEvent
  |-- emitEvent(streamId, event)
  v
SSE to browser
```

**Pain points**: 6 failure modes (port, process start, stdout parse, session create, event subscribe, command send). No lifecycle hooks for UserPromptSubmit, Stop, SessionEnd.

## Target Journey (Claude Agent SDK)

```
User clicks "Assign Agent"
  |
  v
POST /api/orchestrator/sessions
  |
  v
validateAssignment() --- unchanged
  |
  v
createWorktree() --- unchanged
  |
  v
buildAgentSdkOptions() --- build Options with hooks + MCP
  |
  v
query({ prompt, options })
  |-- options.mcpServers = { brain: { type: "stdio", command: "brain", args: ["mcp"] } }
  |-- options.hooks = {
  |     SessionStart: [{ hooks: [loadContextHook] }],
  |     PreToolUse: [{ hooks: [preToolUseHook] }],
  |     UserPromptSubmit: [{ hooks: [checkUpdatesHook] }],
  |     Stop: [{ hooks: [catchUnloggedHook] }],
  |     PreCompact: [{ hooks: [preserveContextHook] }],
  |   }
  |-- options.cwd = worktreePath
  |-- options.permissionMode = "bypassPermissions"
  |-- options.allowDangerouslySkipPermissions = true
  |-- options.systemPrompt = brainTaskPrompt
  v
AsyncIterable<SDKMessage>
  |
  v
for await (message of query)
  |-- message.type === "assistant" -> extract text, forward as StreamEvent
  |-- message.type === "result" -> session complete
  v
SSE to browser
```

**Improvements**: Single function call. No port allocation. No process management. No stdout parsing. No third-party SDK client. Typed messages. All 6 hooks available. MCP server runs as stdio subprocess managed by the SDK.

## Emotional Arc

| Step | Confidence | Notes |
|------|-----------|-------|
| Assignment validation | High | Unchanged, well-tested |
| Worktree creation | High | Unchanged |
| Agent spawn | Low -> **High** | Current: 6 failure modes. Target: single `query()` call |
| Event streaming | Medium -> **High** | Current: proprietary format + bridge. Target: typed SDK messages |
| Hook execution | Low -> **High** | Current: 3/6 hooks. Target: 6/6 hooks as typed callbacks |
| Session completion | Medium -> **High** | Current: must parse OpenCode events for completion. Target: `result` message type |
