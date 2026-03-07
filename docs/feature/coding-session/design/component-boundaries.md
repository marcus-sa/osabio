# Coding Session -- Component Boundaries

## Server-Side Boundaries

### Orchestrator Domain (`app/src/server/orchestrator/`)

Owns: session lifecycle, agent process management, event forwarding, conversation log persistence.

```
orchestrator/
  session-lifecycle.ts    [MODIFY] -- add event iteration loop, prompt forwarding, log persistence calls
  routes.ts               [MODIFY] -- add prompt endpoint, log endpoint
  event-bridge.ts         [MODIFY] -- add log entry emission alongside SSE emission
  spawn-opencode.ts       [NO CHANGE] -- already complete
  stall-detector.ts       [NO CHANGE] -- already complete
  conversation-log.ts     [NEW] -- conversation log CRUD (SurrealDB queries)
  types.ts                [MODIFY] -- add ConversationLogEntry type if needed
```

### Streaming Domain (`app/src/server/streaming/`)

Owns: SSE stream lifecycle, event delivery to clients.

```
streaming/
  sse-registry.ts         [NO CHANGE] -- already supports orchestrator event types
```

### Runtime Wiring (`app/src/server/runtime/`)

Owns: dependency injection, route registration.

```
runtime/
  start-server.ts         [MODIFY] -- pass sseRegistry to orchestrator wiring, add stream + prompt + log routes
```

### Shared Contracts (`app/src/shared/`)

Owns: types shared between server and client.

```
shared/
  contracts.ts            [MODIFY] -- add AgentPromptEvent, ConversationLogEntry
```

## Client-Side Boundaries

### Agent Session UI (`app/src/client/components/graph/`)

Owns: agent session visualization, interaction controls.

```
components/graph/
  AgentStatusSection.tsx  [MODIFY] -- delegate to AgentSessionPanel when session active
  AgentSessionPanel.tsx   [NEW] -- composite: output + prompt input + abort button
  AgentSessionOutput.tsx  [NEW] -- token stream display with auto-scroll
  AgentLogView.tsx        [NEW] -- chronological conversation log for review page
```

### Hooks (`app/src/client/hooks/`)

Owns: SSE subscription, state management.

```
hooks/
  use-agent-session.ts    [MODIFY] -- accumulate tokens + file changes into structured entries
```

### API Layer (`app/src/client/graph/`)

Owns: typed fetch wrappers.

```
graph/
  orchestrator-api.ts     [MODIFY] -- add sendPrompt(), getConversationLog()
```

## Boundary Rules

1. **Orchestrator domain does NOT import from chat domain.** SSE registry is the shared integration point, injected via dependency.
2. **Event bridge is the ONLY component that transforms OpenCode events.** All consumers receive `StreamEvent` types.
3. **Handle registry is internal to session-lifecycle.** Routes access handles indirectly through lifecycle functions.
4. **Conversation log queries are isolated in conversation-log.ts.** Session-lifecycle calls log functions but does not construct queries directly.
5. **Client components consume `useAgentSession` hook state.** They do NOT directly interact with EventSource or SSE.

## File Change Summary

| Category | Existing Modified | New Files | Total |
|----------|-------------------|-----------|-------|
| Server | 4 | 1 | 5 |
| Client | 3 | 3 | 6 |
| Shared | 1 | 0 | 1 |
| Runtime | 1 | 0 | 1 |
| **Total** | **9** | **4** | **13** |

Step ratio check: 6 steps / 13 production files = 0.46 (well under 2.5 threshold).
