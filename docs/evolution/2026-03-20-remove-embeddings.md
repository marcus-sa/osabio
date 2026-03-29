# Evolution: Remove Embeddings

**Date**: 2026-03-20
**Branch**: `marcus-sa/drop-embeddings`
**ADR**: ADR-062 — Replace embeddings with BM25 and graph traversal

## Summary

Removed all embedding infrastructure from the Osabio platform. Replaced KNN vector search with BM25 fulltext search, graph traversal, and LLM classification. Eliminated the embedding model dependency from the hot path (every LLM request through the proxy).

## Motivation

Embeddings added complexity (external API calls, HNSW index maintenance, dimension configuration) for marginal benefit in a domain-specific knowledge graph where:

- **Same-project entities** are reachable via graph traversal (task -> belongs_to -> project)
- **Keyword-matchable entities** are found by BM25 with stemming
- **Cross-project semantic discovery** is handled by the Observer agent creating explicit graph edges
- **Workspaces are bounded** — dozens to low hundreds of active decisions, not millions of documents

## What Changed

### Phase 1: BM25 Migration (01-01 through 01-05)

| Component | Before | After |
|-----------|--------|-------|
| Entity search (chat, MCP) | Load 120+ entities into memory, JS cosine | BM25 fulltext per-table queries |
| Learning collision detection | KNN brute-force + cosine threshold | BM25 text matching with boolean relevance |
| Objective alignment | KNN on objective embeddings | Graph traversal (task->project->objective) + BM25 fallback |
| Observation clustering | Embedding cosine similarity matrix | BM25 text similarity edges + BFS connected components |

### Phase 2: Proxy Context Migration (02-01 through 02-03)

| Component | Before | After |
|-----------|--------|-------|
| Context ranking | Cosine similarity * type weight | BM25 score * exponential recency decay |
| Recent changes classification | Embedding similarity thresholds | Time-based age tiers (urgent <=30min, update <=24h) |
| Recent changes retrieval | KNN on message embeddings | Time-ordered queries with `updated_at > cutoff` |

### Phase 3: Infrastructure Cleanup (03-01 through 03-03)

- Dropped all HNSW indexes and embedding fields from schema (migration 0063)
- Deleted `graph/embeddings.ts` and all embedding generation code paths
- Removed `EMBEDDING_MODEL`, `EMBEDDING_DIMENSION` from `ServerConfig`
- Removed `embeddingModel` from `ServerDependencies`
- Verified zero residual embedding references in application code

### Bonus: SurrealDB 3.0.4 Fixes (post-phase)

Upgraded SurrealDB from 3.0.0 to 3.0.4, which fixed two BM25 issues:

- `@N@` now works with SDK bound parameters (`$query`) — eliminated all string literal interpolation and the SQL injection surface
- `search::score()` returns real BM25 scores — removed score=0 fallback workarounds

Still-open SurrealDB issues (workarounds retained):
- AND matching: multi-term queries require all terms present in document
- >4-5 term queries silently return empty results

## Commits

| Commit | Step | Description |
|--------|------|-------------|
| `5829570f` | 01-01 | BM25 fulltext indexes migration |
| `a9d0aaad` | 01-02 | Chat agent + MCP BM25 search |
| `f08d5025` | 01-03 | Learning collision BM25 |
| `02bec2eb` | 01-04 | Graph-based objective alignment |
| `6851b473` | 01-05 | Observation clustering BM25 |
| `572ac6b1` | 02-01 | BM25+recency proxy context |
| `a2d61ef9` | 02-02 | Time-based classification |
| `ace495ae` | 02-03 | Time-based recent changes |
| `65075ca6` | 03-01 | Drop HNSW indexes + fields |
| `b6d17957` | 03-02 | Remove embedding code + config |
| `83d56293` | 03-03 | Cross-cutting regression check |
| `b9049605` | — | SurrealDB 3.0.4 bound params |

## Impact

- **78 files changed**, +3794 / -2204 lines (net +1590, mostly tests)
- **1433 unit tests pass**, 0 failures
- **No embedding API dependency** — application starts without `EMBEDDING_MODEL` env var
- **No HNSW index overhead** — write path is faster (no index maintenance on entity creation)
- **BM25 search is index-complete** — no brute-force fallback loading all entities into memory

### Post-Phase: RRF Fusion (ADR-063)

Replaced raw BM25 score concatenation with Reciprocal Rank Fusion (RRF, k=60) for cross-table result merging. BM25 scores are not comparable across tables with different corpus sizes — RRF normalizes by rank position, ensuring fair ranking regardless of per-table score distributions.

| Component | Before | After |
|-----------|--------|-------|
| Entity search merge (`bm25-search.ts`) | Flatten + sort by raw BM25 score | Per-table ranked lists fused via `applyRrf()` |
| UI search merge (`entity-search-route.ts`) | Flatten + sort by raw BM25 score | Per-table ranked lists fused via `applyRrf()` |

## Remaining Considerations

- If a workspace scales to thousands of active decisions, BM25 + LLM-generated query expansion covers the gap before needing to reintroduce embeddings
- The Observer's cross-project coherence scan creates explicit graph edges that replace semantic discovery — the graph gets smarter over time, unlike stateless embedding search
- `cosineSimilarity()` and `rankCandidates()` in `context-injector.ts` are dead code — `ContextCandidate` type is still used by the fallback pool in `anthropic-proxy-route.ts` but the embedding-based ranking function is not called
- The `classifyByAge` 24h hard cutoff could be replaced by letting decay + token budget handle stale-item filtering naturally
- RRF can be extended to fuse BM25 + graph-proximity + recency signals (hybrid retrieval) without requiring embeddings
