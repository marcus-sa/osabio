# ADR-063: Reciprocal Rank Fusion for Cross-Table BM25 Result Merging

## Status

Accepted (extends ADR-062)

## Context

After ADR-062 replaced all embedding-based retrieval with BM25 fulltext search, entity search runs separate BM25 queries per table (task, decision, feature, observation, etc.) and merges results. The initial implementation concatenated results and sorted by raw BM25 score — but BM25 scores are not comparable across tables with different corpus sizes and document lengths.

A task table with 200 short titles produces different BM25 score distributions than a decision table with 50 longer summaries. Sorting by raw score silently biases results toward whichever table happens to produce higher absolute scores, regardless of actual relevance rank within each table.

This affects two merge sites:
1. `searchEntitiesByBm25()` in `bm25-search.ts` (chat agent, MCP context)
2. `handleEntitySearch()` in `entity-search-route.ts` (UI search)

## Decision

Apply Reciprocal Rank Fusion (RRF) to merge per-table BM25 result lists into a single ranking. RRF uses rank position rather than raw scores:

```
RRF_score(d) = Σ 1 / (k + rank_i(d))
```

Where `rank_i(d)` is document d's 1-based rank in the i-th result list, and `k = 60` (standard constant from Cormack et al., 2009).

### Implementation

A pure function `applyRrf<T>()` in `bm25-search.ts`:
- Takes N pre-sorted per-table result lists
- Identifies items by `_rrfKey` (e.g. `"task:abc123"`)
- Computes per-item RRF score by summing rank contributions across all lists
- Returns top-K items sorted by fused RRF score

Both merge sites (`searchEntitiesByBm25`, `handleEntitySearch`) call `applyRrf()` instead of the previous flatten/sort-by-score/slice pattern.

### Parameters

- `k = 60` — standard RRF constant that dampens the influence of high-rank outliers. Higher k produces more uniform rank contributions; lower k amplifies rank differences.
- Per-table `LIMIT $limit` on individual queries ensures each table contributes at most `limit` candidates before fusion.

## Alternatives Considered

### Alternative 1: Score normalization (min-max per table)

- **What**: Normalize each table's BM25 scores to [0, 1] before merging
- **Why Rejected**: Requires knowing score distribution per table per query. Empty or single-result tables produce degenerate normalizations. More complex, fragile, and query-dependent.

### Alternative 2: SurrealDB `search::rrf()` built-in

- **What**: Use SurrealDB's native RRF function
- **Why Rejected**: `search::rrf()` is designed for fusing vector + fulltext results within a single table, not cross-table fulltext merging. It also requires `search::score()` which has limitations inside stored functions (issue #7013).

### Alternative 3: Keep raw score concatenation

- **What**: Accept that BM25 scores are incomparable and live with the bias
- **Why Rejected**: The bias systematically favors tables with higher absolute scores. For a knowledge graph with heterogeneous entity types, this produces unreliable search results that degrade user trust.

## Consequences

### Positive

- **Fair cross-table ranking** — a rank-1 decision and rank-1 task get equal RRF scores regardless of their raw BM25 magnitudes
- **Extensible** — `applyRrf()` can fuse any combination of ranked lists (BM25 + graph proximity + recency in the future)
- **Pure function** — no IO, fully unit-testable, O(n) post-query
- **No query changes** — per-table BM25 queries remain unchanged; only the merge step changes

### Negative

- **Score semantics change** — consumers that interpreted `score` as BM25 magnitude now receive RRF scores (small floats ~0.01-0.03). This is a breaking change for any external consumer comparing scores across queries.
- **Intra-table score information lost** — RRF discards the magnitude difference between rank 1 and rank 2 within a table. Mitigated: the raw BM25 scores still determine per-table ordering, which RRF preserves.

### Neutral

- **No latency impact** — RRF is O(n) where n is total candidates across all tables. The per-table DB queries dominate latency.

## References

- Cormack, Clarke, Büttcher (2009): "Reciprocal Rank Fusion outperforms Condorcet and individual rankers"
- GitHub issue #172: RRF fusion for cross-table BM25 result merging
- ADR-062: Replace embeddings with BM25 and graph traversal
