# ADR-076: Gateway Event Adapter Pattern

**Status**: Proposed
**Date**: 2026-03-24
**Context**: ADR-074 (OpenClaw Gateway Protocol Server)

## Decision

The gateway maps existing Brain `StreamEvent` variants to Gateway Protocol event frames via a pure adapter function. No new event types are created. Brain-internal events with no gateway mapping are silently dropped.

## Context

Brain's orchestrator produces `StreamEvent` variants via an event bridge that converts Claude Agent SDK messages. The existing streaming path is:

```
Claude SDK messages → Event Bridge → StreamEvent → SSE Registry → HTTP SSE client
```

The gateway needs a parallel path:

```
Claude SDK messages → Event Bridge → StreamEvent → Event Adapter → WebSocket client
```

### Options Evaluated

1. **New gateway-specific event types**: Rejected — creates parallel event hierarchies that must stay in sync. Increases maintenance burden.
2. **Modify StreamEvent to include gateway format**: Rejected — couples Brain internals to OpenClaw protocol. Violates separation of concerns.
3. **Pure mapping function (selected)**: A stateless function `(StreamEvent, seq) → GatewayEventFrame | undefined` translates at the boundary. StreamEvent remains Brain-internal. Gateway Protocol format is gateway-internal.

## Design

### Mapping Table

| StreamEvent | Gateway Event | Stream |
|------------|---------------|--------|
| `AgentTokenEvent` | `{ delta: token }` | `assistant` |
| `AgentFileChangeEvent` | `{ phase: "file_change", path, changeType }` | `lifecycle` |
| `AgentStatusEvent` | `{ phase: status }` | `lifecycle` |
| `AgentStallWarningEvent` | `{ phase: "stall_warning", seconds }` | `lifecycle` |
| `AgentPromptEvent` | `{ phase: "prompt" }` | `lifecycle` |
| `ErrorEvent` | `{ error: message }` | `error` |
| `DoneEvent` | `{ phase: "done" }` | `lifecycle` |
| `TokenEvent` | — (dropped) | — |
| `ExtractionEvent` | — (dropped) | — |
| `OnboardingSeedEvent` | — (dropped) | — |
| `OnboardingStateEvent` | — (dropped) | — |
| `ObservationEvent` | — (dropped) | — |

### Event Delivery

Events are sent directly on the WebSocket connection — not through the SSE registry. The SSE registry is used only for workspace-level presence broadcast.

Each connection maintains a monotonically increasing `seq` counter. Every event frame includes `seq` so clients can detect gaps after reconnection.

## Consequences

### Positive
- Zero changes to existing StreamEvent types or event bridge
- Pure function — trivially testable, no side effects
- Protocol changes require updating only the mapping function
- Dropped events are explicit in the mapping table

### Negative
- Gateway clients don't see extraction events, onboarding events, etc. — acceptable, as these are Brain-internal UI concerns
- If new StreamEvent variants are added to Brain, the mapper must be updated (or they're silently dropped — safe default)
