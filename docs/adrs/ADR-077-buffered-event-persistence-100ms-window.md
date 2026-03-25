# ADR-077: Buffered Event Persistence with 100ms Write Window

## Status

Deferred — not needed until cloud provider support (E2B, Docker). For local provider, the SDK's built-in `InMemorySessionPersistDriver` is sufficient since Brain and agent processes share the same host lifecycle. Tracked in [#187](https://github.com/marcus-sa/brain/issues/187).

## Context

SandboxAgent can emit events at high frequency -- up to 50 events/second during test output or rapid file operations. The `SessionPersistDriver.insertEvent()` method is called for every event. Individual SurrealDB inserts at 50/second would create excessive load and risk backpressure on the event stream.

The NFR threshold is 50 events/second without backpressure. The event delivery SLA is < 500ms from emission to SSE delivery.

## Decision

Buffer events in a per-session in-memory queue. A flush timer fires every 100ms, batch-inserting accumulated events into SurrealDB. During transient SurrealDB outages (< 30 seconds), events continue buffering. On reconnection, the buffer is flushed. Buffer overflow (> 1000 events per session) logs a warning and drops oldest events.

## Alternatives Considered

### 1. Synchronous Per-Event Insert

Call `CREATE sandbox_event` for every event as it arrives.

- **Pro**: Simplest implementation, zero event loss risk
- **Con**: 50 SurrealDB round-trips/second at peak. Creates backpressure that blocks event delivery to SSE stream. Violates the 50 events/second throughput NFR.
- **Rejected**: Does not meet throughput requirement.

### 2. 1-Second Batch Window

Same buffering approach but with a 1-second flush interval.

- **Pro**: Fewer DB round-trips (10x less than 100ms window)
- **Con**: Up to 1 second of events lost on crash. 50 events potentially unrecoverable. Exceeds acceptable event loss window for session restoration.
- **Rejected**: 100ms window balances throughput and durability. Maximum 5 events at risk vs 50.

### 3. Write-Ahead Log (WAL) to Disk

Write events to a local file before batching to SurrealDB.

- **Pro**: Zero event loss even on process crash
- **Con**: Adds filesystem dependency. Doesn't work in cloud sandboxes where Brain process is separate from agent. Over-engineering for the problem scale.
- **Rejected**: The 100ms window limits exposure to ~5 events at risk. Session restoration works with partial event history. WAL complexity not justified.

## Consequences

### Positive

- Handles 50 events/second with ~10 DB round-trips/second (5x reduction)
- No backpressure on event stream delivery
- Transient SurrealDB outages (< 30s) buffered transparently
- Per-session buffers prevent cross-session interference

### Negative

- Up to ~5 events at risk on process crash (100ms window at 50 events/second)
- In-memory buffer adds per-session memory usage (~100KB per session at overflow limit)
- Buffer overflow drops oldest events (logged but unrecoverable)
- Slightly more complex than synchronous writes
