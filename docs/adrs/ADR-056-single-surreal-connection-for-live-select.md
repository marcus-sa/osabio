# ADR-056: Single SurrealDB Connection for LIVE SELECT

## Status
Accepted

## Context
The reactive layer requires LIVE SELECT subscriptions to receive push-based graph change notifications. LIVE SELECT requires WebSocket transport. The question is whether to create a dedicated second Surreal WebSocket connection for LIVE SELECT subscriptions, or use the existing `surreal` connection.

## Decision
Use the existing `surreal` WebSocket connection for both request-scoped queries and LIVE SELECT subscriptions. The SurrealDB JS SDK v2 multiplexes queries and subscriptions over a single WebSocket connection.

## Alternatives Considered

### Alternative 1: Dedicated `reactiveSurreal` WebSocket Connection
- **What**: Create a second `Surreal` instance in `dependencies.ts`, connect via WebSocket, use exclusively for LIVE SELECT. Add to `ServerDependencies` type.
- **Expected Impact**: Prevents LIVE SELECT traffic from interfering with request-scoped queries. Separate reconnection logic.
- **Why Rejected**: The SurrealDB SDK already multiplexes over a single connection. LIVE SELECT events are small and infrequent relative to query traffic. A second connection adds configuration complexity, doubles connection management, and requires coordinating two auth sessions. No evidence of contention on the shared connection.

## Consequences
- **Positive**: No additional connection to manage. No changes to `dependencies.ts` or `ServerDependencies` type. Simpler startup and shutdown.
- **Positive**: Single auth session. Single reconnection handler.
- **Negative**: If LIVE SELECT event volume becomes very high, it could theoretically compete with request-scoped queries on the same connection. Mitigated: high-volume tables (trace, message, extracted_from) are excluded from LIVE SELECT subscriptions. If contention is observed in production, a dedicated connection can be added later without architectural changes.
