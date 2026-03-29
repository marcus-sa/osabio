# ADR-065: TTL Cache for Tool Resolution

## Status
Proposed

## Context
Tool resolution (identity -> can_use edges -> mcp_tool records) runs on every proxy request. NFR-2 requires < 50ms overhead. The SurrealDB query itself is expected at < 5ms with indexes, but network round-trip and connection overhead add variance. The proxy already uses TTL caches for workspace validation (60s) and proxy token resolution (5min).

We need a caching strategy that balances latency with freshness. Tool grants change infrequently (admin action), so staleness is acceptable within bounds.

## Decision
In-memory `Map<string, { tools: ResolvedTool[], populatedAt: number }>` keyed by identity ID, with a 60-second TTL. Same pattern as `WorkspaceCache` in the proxy route. TTL enforced at read time (check `populatedAt` against `Date.now()`). Stale entries pruned by the existing periodic pruning interval in the proxy handler factory.

No event-driven invalidation. Cache entries expire naturally. An admin granting tool access takes effect within 60 seconds.

## Alternatives Considered

### Alternative 1: No cache (query every request)
- **What**: Query SurrealDB on every proxy request for tool resolution.
- **Expected impact**: Always fresh, 3-8ms per query.
- **Why rejected**: Under load, adds unnecessary round-trips. The proxy already caches workspace validation and proxy tokens for the same reason. Consistency with existing patterns.

### Alternative 2: SurrealDB LIVE SELECT for push invalidation
- **What**: Subscribe to `can_use` table changes via LIVE SELECT, invalidate specific cache entries on mutation.
- **Expected impact**: Near-instant invalidation, always fresh.
- **Why rejected**: LIVE SELECT requires a persistent WebSocket connection per subscription (ADR-056). Adds operational complexity for a cache that serves admin-initiated changes (infrequent). The 60s staleness is acceptable for the use case -- tools are granted by admins, not in real-time loops. Over-engineering for the current scale.

### Alternative 3: Redis/external cache
- **What**: Use Redis or another external cache for distributed caching.
- **Expected impact**: Shared cache across multiple server instances.
- **Why rejected**: Osabio runs as a single server instance (ADR-040). No multi-instance deployment exists. Adding Redis as a dependency for a simple TTL cache violates the simplest-solution principle and the OSS-minimalism constraint.

## Consequences
- **Positive**: Consistent with existing proxy caching patterns (workspace, token)
- **Positive**: Zero external dependencies
- **Positive**: < 1ms cache hit latency
- **Positive**: Pruning integrated into existing periodic cleanup interval
- **Negative**: Up to 60s staleness on tool grant changes (acceptable for admin-initiated operations)
- **Negative**: Cache is per-process (not shared) -- acceptable for single-instance deployment
