# ADR-062: Replace Embeddings with BM25 Fulltext Search and Graph Traversal

## Status

Accepted (supersedes ADR-032)

## Context

Brain uses 1536-dimension vector embeddings across 18 entity types for four use cases: entity search, collision detection, objective-intent alignment, and proxy context ranking. This creates several problems:

1. **Reliability**: External embedding API calls timeout at 60s, causing CI test failures and degraded user experience. The HNSW+WHERE bug in SurrealDB v3.0 requires two-step query workarounds everywhere.

2. **Latency**: Every search/collision/alignment operation requires a synchronous API call to generate a query embedding before any database operation can begin.

3. **Maintainability**: 18 HNSW indexes, embedding fields on every table, `embedding-writeback.ts` generating embeddings for every entity write, `cosineSimilarity` brute-force fallbacks loading all embeddings into memory.

4. **Testability**: Acceptance tests require a configured embedding model and network access. Tests are non-deterministic due to API availability.

Meanwhile, BM25 fulltext search already works well for UI entity search (`entity-search-route.ts`, migration 0002). The knowledge graph has explicit typed edges (belongs_to, has_objective, supports) that encode relationships more reliably than probabilistic cosine similarity.

Quality attribute priorities: reliability > latency > maintainability > testability.

## Decision

Replace all embedding-based retrieval with:

1. **BM25 fulltext search** (SurrealDB built-in) for text matching: entity search, collision detection, proxy context ranking
2. **Graph traversal** for objective-intent alignment (follows explicit edges: task -> belongs_to -> project <- has_objective <- objective)
3. **BM25 fallback** for alignment when intents don't resolve to a graph entity

Then remove all embedding infrastructure: HNSW indexes, embedding fields, embedding model config, embedding generation code.

### Use Case Mapping

| Use Case | Before | After |
|----------|--------|-------|
| Entity search (chat agent) | Embedding API + cosine similarity in JS | BM25 `@N@` queries (in-database) |
| Collision detection (learnings) | Embedding API + KNN + brute-force fallback | BM25 on learning/policy/decision tables |
| Objective-intent alignment | Embedding API + KNN on objectives | Graph edge traversal + BM25 fallback |
| Proxy context ranking | Embedding API + cosine * weight | BM25 score * recency decay |

### Migration Strategy

Three phases, each independently deployable:
- **Phase 1**: Replace search, collision, alignment (parallel)
- **Phase 2**: Replace proxy context ranking (depends on Phase 1 confidence)
- **Phase 3**: Drop embedding infrastructure (depends on all above)

## Alternatives Considered

### Alternative 1: Keep embeddings, optimize performance

- **What**: Add connection pooling, retry logic, local embedding cache, reduce timeout
- **Expected Impact**: Reduces latency by ~50%, doesn't eliminate API dependency
- **Why Insufficient**: Root cause is the external API dependency itself. HNSW+WHERE bug still requires workarounds. 1536-dim arrays still loaded into memory. CI tests still flaky. Adds complexity rather than removing it.

### Alternative 2: Local embedding model (Ollama)

- **What**: Run embedding model locally via Ollama, eliminating network dependency
- **Expected Impact**: Eliminates timeout issues, keeps semantic search capability
- **Why Insufficient**: Still requires 18 HNSW indexes, embedding fields, two-step KNN workaround. Adds operational burden (model management). BM25 handles the structured vocabulary of a knowledge graph without the overhead. Cosine similarity at 0.40-0.55 thresholds (cross-entity collision detection) is barely above random chance.

### Alternative 3: Hybrid (BM25 primary, embeddings for semantic fallback)

- **What**: Use BM25 for most operations, keep embeddings only for proxy context ranking
- **Expected Impact**: Removes 80% of embedding usage, keeps semantic ranking for proxy
- **Why Insufficient**: Retains full embedding infrastructure (indexes, fields, config, model dependency) for one use case. Recency + BM25 + project proximity provide stronger signals for proxy context than cosine similarity in a structured knowledge graph.

### Alternative 4: External search engine (Meilisearch, Typesense)

- **What**: Offload search to a dedicated fulltext engine
- **Expected Impact**: Better search quality than SurrealDB BM25
- **Why Insufficient**: Adds an external service dependency. SurrealDB's built-in BM25 is already proven in production for UI search. The structured, consistent vocabulary of a knowledge graph (not arbitrary user-generated content) doesn't need advanced NLP features.

## Consequences

### Positive

- **Eliminates external API dependency** for all search and retrieval operations
- **Sub-200ms search latency** (BM25 in-database vs 1-60s embedding API)
- **Deterministic, reproducible** search results (no model variance, no API availability)
- **CI reliability** -- no embedding timeout failures
- **Simpler codebase** -- remove ~200 lines of embedding infrastructure, 18 HNSW index definitions, 26 file imports
- **Reduced storage** -- no 1536-float arrays per entity, no HNSW index overhead
- **Faster writes** -- no HNSW index update on every entity create/update
- **Auditable alignment** -- graph edges are explicit and traceable vs probabilistic similarity

### Negative

- **No semantic matching** for vocabulary-disjoint queries (e.g., "auth" won't match "security posture"). Mitigated: knowledge graph vocabulary is consistent (extractors control entity text), and snowball stemmer handles morphological variants.
- **BM25 threshold calibration** required for collision detection. Different thresholds than cosine similarity. Mitigated: calibrate via acceptance tests with known duplicate/non-duplicate pairs.
- **Proxy context ranking quality** may differ from cosine-based ranking. Mitigated: recency + project proximity are strong signals for coding context. Instrument and compare.
- **Observation clustering** in `learning-diagnosis.ts` loses cosine similarity. Must be replaced with alternative approach before Phase 3.

### Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| BM25 misses semantically related entities | Medium | Low | Domain vocabulary is consistent. Stemmer handles variants. |
| Collision detection false negatives | Medium | Low | Calibrate thresholds. LLM classification still handles ambiguous matches. |
| Proxy context quality regression | Low | Medium | Recency + project proximity compensate. Instrument before/after. |
| Graph alignment misses unlinked objectives | Low | Low | BM25 fallback covers unresolved intents. |

## Conditions for Revisiting

Re-introduce embeddings if any of these conditions emerge:

1. **Cross-workspace search** becomes a product requirement -- semantic similarity across workspaces with different vocabulary requires embeddings
2. **Zero-result rate** (`search.result_count == 0`) exceeds 15% post-migration -- indicates the synonym gap is larger than estimated
3. **Data volume** exceeds ~10,000 entities per workspace -- the absolute recall gap between BM25 and hybrid search grows with scale
4. ~~**SurrealDB native hybrid search** (RRF fusion) becomes available~~ — Addressed by ADR-063: app-layer RRF fusion now merges cross-table BM25 results by rank position
5. **Semantic clustering** becomes a core feature -- automated grouping of semantically similar but lexically different entities requires vector representations

## Supersedes

- **ADR-032**: Embedding Similarity for Intent-Objective Alignment -- replaced by graph traversal with BM25 fallback. The structured knowledge graph has explicit edges that are more reliable and auditable than probabilistic cosine similarity.
