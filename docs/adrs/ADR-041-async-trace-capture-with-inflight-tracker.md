# ADR-041: Async Trace Capture via Inflight Tracker

## Status
Proposed

## Context
Every LLM call must produce an `trace` graph node with RELATE edges. Graph writes to SurrealDB take 5-50ms. The proxy must not add perceptible latency to the SSE response (< 50ms p95 TTFT overhead). The existing Osabio codebase uses `deps.inflight.track()` for async background work, and acceptance tests call `drain()` before assertions.

## Decision
All post-response work (trace creation, edge creation, spend counter updates, failure observations) runs asynchronously via `deps.inflight.track()`. The SSE stream completes and the client connection closes before graph writes begin.

## Alternatives Considered

### Alternative 1: Synchronous graph write before returning response
- **What**: Write trace node before sending the first SSE byte
- **Expected impact**: Guaranteed trace exists before response
- **Why insufficient**: Adds 5-50ms to time-to-first-token. Violates US-LP-001's < 50ms p95 TTFT overhead requirement. SurrealDB unavailability would block agent responses.

### Alternative 2: Batch writes with periodic flush
- **What**: Buffer traces in memory, flush to SurrealDB every N seconds
- **Expected impact**: Fewer DB round-trips, higher throughput
- **Why insufficient**: Data loss risk if process crashes between flushes. Spend counters become stale between flushes (budget enforcement reads stale data). Adds complexity without clear benefit at current scale (100-500 calls/day per developer).

### Alternative 3: Message queue (Redis/NATS) for trace events
- **What**: Publish trace events to a queue, consume asynchronously
- **Expected impact**: Decoupled, resilient to DB outages
- **Why insufficient**: Introduces new infrastructure dependency (Redis/NATS). Overkill for single-server deployment. `deps.inflight.track()` already provides the async boundary with drain support for tests.

## Consequences
- **Positive**: Zero latency impact on SSE relay; consistent with existing Osabio async pattern; tests can drain pending work
- **Positive**: Retry logic (3x exponential backoff) handles transient SurrealDB failures; stderr JSON fallback prevents data loss
- **Negative**: Brief window where trace does not exist in graph (between response delivery and async write completion)
- **Negative**: Spend counters may be slightly stale for budget checks (acceptable: 100ms staleness at worst)
