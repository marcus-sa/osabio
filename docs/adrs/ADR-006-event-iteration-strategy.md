# ADR-006: Event Stream Iteration Strategy

## Status
Accepted

## Context
After spawning an OpenCode agent, the server must continuously consume events from the agent's async iterable event stream and forward them (via event bridge) to the SSE registry for client delivery. This iteration must not block the HTTP response that created the session.

## Decision
Use a fire-and-forget `for-await-of` loop launched as an unlinked async IIFE immediately after spawn succeeds in `createOrchestratorSession`. The loop:

1. Iterates `handle.eventStream` (AsyncIterable from OpenCode SDK)
2. Passes each event to `eventBridge.handleEvent()` (which transforms and emits to SSE)
3. Checks for terminal status events and breaks
4. Catches iteration errors, updates session status to `error`, and cleans up
5. Runs `eventBridge.stop()` and stall detector cleanup on exit

The loop is not awaited -- it runs in the background while the HTTP response returns the session ID and stream URL to the client.

## Alternatives Considered

### Alternative 1: Event emitter pattern
- What: Wrap the async iterable in a Node EventEmitter, attach listeners
- Expected Impact: Solves 100% with familiar event API
- Why Insufficient: Adds unnecessary abstraction. The async iterable is already the right primitive for ordered, backpressure-aware consumption. EventEmitter loses backpressure and adds error-handling complexity (unhandled rejection risks). The for-await-of pattern is simpler and matches the functional paradigm.

### Alternative 2: Worker thread for event consumption
- What: Spawn a dedicated worker thread to consume the event stream
- Expected Impact: Solves 100% with process isolation
- Why Insufficient: Massive over-engineering. Event consumption is I/O-bound (waiting for SSE events), not CPU-bound. Worker threads add serialization overhead for cross-thread communication. Solo dev maintaining worker thread infrastructure is unjustified complexity.

## Consequences
- Positive: Simplest possible implementation; no new abstractions; natural backpressure via async iteration
- Positive: Error boundary is a single try/catch around the loop
- Negative: Unlinked async work -- no awaitable handle to the iteration. Acceptable because lifecycle is tied to session (abort kills the stream, breaking the loop)
- Negative: Server restart terminates iteration without graceful shutdown. Known limitation (handle registry is already ephemeral).
