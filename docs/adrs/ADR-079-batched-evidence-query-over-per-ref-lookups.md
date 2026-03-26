# ADR-079: Batched Evidence Query Over Per-Ref Lookups

## Status
Proposed

## Context

The evidence verification pipeline must resolve up to 10 evidence references per intent. Each reference must be checked for: existence, workspace scope, temporal ordering, and status liveness. The p95 latency target for the entire verification pipeline is < 100ms.

SurrealDB supports selecting multiple records by RecordId array in a single query: `SELECT id, workspace, status, created_at FROM $refs` where `$refs` is an array of `RecordId` objects. This returns all matching records in one round-trip.

Per the project's SurrealDB conventions: "Do NOT issue multiple sequential `surreal.query()` calls when the queries share the same bound parameters. Combine them into a single `.query()` call."

## Decision

Execute a **single batched SurrealDB query** that resolves all evidence refs (max 10) in one round-trip. The query returns each record's `id`, `workspace`, `status`, `created_at`, and author-relevant fields. All subsequent checks (existence, scope, temporal, liveness, authorship) operate on the returned result set as pure functions.

Cap evidence_refs at 10 per intent. Reject submissions with more than 10 refs at the API boundary.

## Alternatives Considered

### Sequential per-ref queries
- **Rejected**: O(N) round-trips. At 10 refs with ~5ms per query, minimum 50ms just for existence checks -- risking p95 target before any other pipeline work.

### Parallel per-ref queries
- **Rejected**: Per project conventions, multiple parallel `.query()` calls on the same WebSocket connection cause concurrency issues. Would require connection pooling or secondary connections.

### Pre-cached entity lookup table
- **Rejected**: Requires cache invalidation when entity status changes (which is frequent for tasks and decisions). Cache staleness would cause false negatives on liveness checks, violating the zero false negative requirement.

## Consequences

### Positive
- Single round-trip: O(1) regardless of ref count (up to 10)
- Predictable latency: single query at ~5-15ms, well within 100ms budget
- All data needed for subsequent pure-function checks available from one result set
- Consistent with project's SurrealDB query batching convention

### Negative
- Query returns a heterogeneous result set (records from different tables have different fields). The pipeline must handle missing fields gracefully per entity type.
- Max 10 refs cap is a hard limit. If future requirements need more, the query would need to be chunked.

### Validation Required
- Walking Skeleton acceptance tests must verify that SurrealDB correctly returns heterogeneous results when `SELECT ... FROM $refs` contains RecordIds from different tables (e.g. mix of `decision:abc`, `task:def`, `observation:ghi`). If SurrealDB does not support this, the fallback is per-table grouped queries (still a single `.query()` call with multiple statements).
