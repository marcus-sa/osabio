# ADR-055: Graph-Native Context Injection Over context_queue Table

## Status
Accepted

## Context
Running agents need to be enriched with relevant graph changes that occurred since their last request. The LLM proxy's context injection pipeline (`context-injector.ts`) already loads graph context and injects it as XML into the system prompt. The question is how the proxy discovers which changes are relevant.

An earlier design proposed a `context_queue` table: the Coordinator writes per-session context updates, the proxy reads and marks them as "delivered." This was rejected because it introduces point-to-point messaging semantics into a system whose core principle is that agents coordinate through the graph, not through messages to each other.

## Decision
The proxy uses vector search to find relevant recent graph changes. On each request, it takes the current message embedding (or produces one), runs KNN against recent graph entity embeddings (scoped to workspace, filtered to entities updated since `agent_session.last_request_at`), and injects semantically relevant changes. High similarity → `<urgent-context>`. Moderate similarity → `<context-update>`.

No `context_queue` table. No "delivered" flag. The graph is the single source of truth.

## Alternatives Considered

### Alternative 1: context_queue Table (Coordinator Writes, Proxy Reads)
- **What**: Dedicated SCHEMAFULL table. Coordinator writes per-session rows with payload, level, created_at, delivered_at. Proxy queries by session + undelivered + TTL, marks delivered after injection.
- **Expected Impact**: Clean lifecycle separation. Per-session targeting. Audit trail via delivered_at timestamps.
- **Why Rejected**: Introduces point-to-point messaging into a graph-native system. "Delivered" flag implies each update is consumed once by one recipient — but multiple agents on related tasks should see the same changes. Per-session rows duplicate graph data. The Coordinator should not be in the business of writing context payloads — the graph already contains the data.

### Alternative 2: Timestamp-Based Query on Task Dependencies
- **What**: Proxy resolves session's task dependencies via graph edges, queries for changes since `last_request_at` on those specific entities.
- **Expected Impact**: Simple, no vector search needed. Direct graph queries.
- **Why Rejected**: Only catches changes on direct dependency edges. Misses semantically relevant changes that aren't on explicit depends_on/relates_to/belongs_to paths. Vector search is strictly more capable and the embedding infrastructure already exists.

## Consequences
- **Positive**: No new table. No "delivered" tracking. No per-session duplication. Graph is the only source of truth.
- **Positive**: Multiple agents on related tasks naturally see the same relevant changes — relevance is computed per-request via similarity, not pre-routed per-session.
- **Positive**: Catches relevant changes beyond explicit dependency edges — semantic similarity handles transitive and implicit relevance.
- **Positive**: Similarity score provides natural urgency signal — no separate classifier needed.
- **Negative**: Adds a KNN query per proxy request. Mitigated: HNSW index makes this sub-50ms. Filtered by `updated_at > last_request_at` which keeps candidate set small.
- **Negative**: Requires `agent_session.last_request_at` field to scope recency. Updated on each proxy request via fire-and-forget `deps.inflight.track()`.
