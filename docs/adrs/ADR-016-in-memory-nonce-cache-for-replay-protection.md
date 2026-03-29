# ADR-016: In-Memory Nonce Cache for DPoP Replay Protection

## Status

Proposed

## Context

DPoP replay protection requires tracking seen `jti` (nonce) values from DPoP proofs. Each Osabio API request carries a DPoP proof with a unique `jti`. The nonce cache must:

1. Check `jti` uniqueness in < 1ms (NFR-1)
2. Handle ALL request volume (no tiering -- every Osabio operation uses DPoP)
3. Auto-expire entries (no unbounded memory growth)
4. Be dependency-injected, not a module-level singleton (project convention: BR-5, AGENTS.md)
5. Support concurrent access within a single Bun process

The existing codebase has no Redis or external cache infrastructure. SurrealDB is the only data store.

## Decision

Implement the nonce cache as an in-memory time-windowed `Map<string, number>` (jti -> timestamp), created via factory function and injected into `ServerDependencies`.

Design:
- **Storage**: `Map<string, number>` where key = jti, value = insertion timestamp
- **Lookup**: O(1) Map.has() -- well under 1ms
- **Insertion**: Add jti with current timestamp after successful verification
- **Expiry**: Periodic sweep (every 60s) removes entries older than the clock skew window (default: 65s = 60s past tolerance + 5s future tolerance)
- **Factory**: `createNonceCache(config)` returns a cache instance. Injected via `ServerDependencies.nonceCache`.
- **Cleanup**: Sweep runs via `setInterval`, cleared on server shutdown

## Alternatives Considered

### Alternative 1: SurrealDB table for nonce tracking

Store each jti as a SurrealDB record with TTL-based cleanup.

- **Pros**: Persistent across server restarts. Shared across hypothetical multiple processes.
- **Cons**: DB round-trip per nonce check violates < 1ms requirement (NFR-1). SurrealDB does not have native TTL/auto-expiry on records. Requires manual cleanup queries. Creates high write amplification (one INSERT per API request).
- **Rejected because**: Latency requirement (< 1ms) is incompatible with database round-trip. Nonce data is ephemeral and does not need persistence -- a server restart invalidates the clock skew window anyway.

### Alternative 2: Redis/external cache

Use Redis for nonce storage with native TTL.

- **Pros**: Native TTL. Shared across processes. Battle-tested for this use case.
- **Cons**: Redis is not in the existing infrastructure. Adds operational dependency for solo developer. Network hop per request. Over-engineered for single-process deployment.
- **Rejected because**: No Redis in the stack. Adding external infrastructure for a single Map is unjustified for a modular monolith with one process.

### Alternative 3: Module-level Map singleton

Simple `const nonceCache = new Map()` at module scope.

- **Pros**: Simplest implementation.
- **Cons**: Violates project convention against module-level mutable singletons (AGENTS.md: "Module-level state is shared across the entire process -- when multiple server instances run concurrently (e.g., smoke tests with --concurrent), they silently corrupt each other"). Not injectable for testing.
- **Rejected because**: Project convention explicitly forbids this pattern. Dependency injection is required.

## Consequences

### Positive

- Sub-millisecond lookup (O(1) Map access)
- Zero external dependencies
- Dependency-injected (testable, no shared mutable state between test suites)
- Auto-expiry prevents unbounded growth
- Simple implementation (~50 lines)

### Negative

- Nonce cache is lost on server restart (acceptable: clock skew window is 65s, so stale proofs from before restart are expired anyway)
- Single-process only (acceptable: modular monolith architecture)
- Periodic sweep is O(n) on cache size (acceptable: entries expire quickly, cache stays small)

### Memory Estimate

At 1000 requests/second (aggressive estimate), with 65-second window: ~65,000 entries. Each entry is ~60 bytes (UUID string + number). Total: ~4MB. Well within acceptable bounds.
