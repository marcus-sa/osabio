# Four Forces Analysis: Remove Embeddings from Brain Knowledge Graph

## Forces Analysis: Overall Migration

### Demand-Generating
- **Push**: Embeddings impose disproportionate cost for marginal value. 60s timeouts causing CI failures. N+1 API calls per message. 17 HNSW indexes rebuilt on every write. Two-step KNN workaround required everywhere. In-memory cosine computation with 120+ candidates. Cross-form similarity comparisons produce unreliable scores.
- **Pull**: BM25 fulltext search already proven in production (migration 0002). Graph traversal provides deterministic results for structured data. Elimination of external embedding API dependency removes latency and failure modes. Simpler codebase with fewer moving parts.

### Demand-Reducing
- **Anxiety**: Semantic gap -- will BM25 miss entities that share meaning but not vocabulary? Proxy context injection is the weakest replacement (medium confidence). Regression risk during migration if behavior changes subtly.
- **Habit**: Embedding infrastructure is deeply embedded (17 HNSW indexes, 16 call sites, 26 files importing `createEmbeddingVector`). ADR-032 explicitly chose embeddings for intent-objective alignment. Team mental model treats "semantic search" as superior to "keyword search."

### Assessment
- Switch likelihood: **High** (3 of 4 use cases have high-confidence replacements)
- Key blocker: Proxy context injection replacement (Phase 2)
- Key enabler: BM25 already proven + graph traversal strictly more accurate for structured data
- Design implication: Phased migration. Phase 1 handles high-confidence replacements. Phase 2 tackles proxy context. Phase 3 removes infrastructure.

---

## Forces Analysis: Phase 1 -- Search, Collision Detection, Alignment

### Demand-Generating
- **Push (Search)**: `searchEntitiesByEmbedding` doesn't use HNSW at all. Loads 120+ candidates into JS memory. Requires embedding API call per search. CI timeout at 60s.
- **Push (Collision)**: Two-step KNN + brute-force fallback. Cross-form comparison (observation centroids vs learning text) at 0.50 threshold is barely above random.
- **Push (Alignment)**: Pure cosine between intent and objective embeddings. Misses obvious alignments where vocabulary differs. Graph path is deterministic.
- **Pull**: All three have clear, higher-quality replacements available today.

### Demand-Reducing
- **Anxiety (Search)**: BM25 stemmer handles "auth"/"authentication" but not "login"/"credential management". Mitigation: structured data has consistent vocabulary within a workspace.
- **Anxiety (Collision)**: BM25 may miss paraphrased duplicates. Mitigation: LLM classification as second stage for nuanced cases.
- **Anxiety (Alignment)**: Free-form intents without task references. Mitigation: intent resolution pipeline already resolves most intents to task/project level.
- **Habit**: Code paths are tested and working. Change requires touching 10+ files.

### Assessment
- Switch likelihood: **Very High**
- Key blocker: None significant -- all three replacements are well-understood
- Key enabler: BM25 infrastructure already exists, graph traversal already used elsewhere
- Design implication: Execute as a single coordinated change. All three can share the same BM25 query infrastructure.

---

## Forces Analysis: Phase 2 -- Proxy Context Injection

### Demand-Generating
- **Push**: Every proxy message requires an embedding API call. `rankCandidates` does in-memory cosine on all candidates. `classifyBySimilarity` uses arbitrary thresholds (0.4/0.7) on cosine scores. Recent changes search uses three parallel two-step KNN queries.
- **Pull**: Recency + graph proximity (decisions/tasks recently updated in the same project) is a strong signal for coding context. BM25 search on message text against decisions/learnings could replace semantic ranking. Token budget selection logic is reusable regardless of ranking method.

### Demand-Reducing
- **Anxiety**: This is the only use case where semantic similarity adds genuine value -- a coding task about "rate limiting" should surface a decision about "API throttling" even though vocabulary differs. Graph proximity may not capture cross-project relevance.
- **Habit**: The `context-injector.ts` module is well-factored (pure functions, clear types). The XML injection pipeline is independent of ranking method. Changing ranking feels risky because proxy behavior affects external coding agents.

### Assessment
- Switch likelihood: **Medium-High**
- Key blocker: Cross-vocabulary relevance for coding context
- Key enabler: Intent context resolution already has 4 fallback strategies; vector search is only step 3 of 4. Most proxy requests resolve via explicit refs or single-project shortcut.
- Design implication: Replace vector ranking with BM25 + recency weighting. Keep the pure function architecture. Add graph-proximity signal (same project/feature). Accept that a small percentage of cross-vocabulary matches will be lost -- this is an acceptable trade for eliminating the embedding API dependency.

---

## Forces Analysis: Phase 3 -- Infrastructure Removal

### Demand-Generating
- **Push**: 17 HNSW indexes consuming storage and rebuild time. `embedding` field on every entity type consuming disk. `EMBEDDING_MODEL` and `EMBEDDING_DIMENSION` config cluttering server config. `embeddingModel` dependency threaded through entire call chain.
- **Pull**: Clean codebase. Faster DB writes (no HNSW index update). Simpler config. Fewer external dependencies. Faster CI.

### Demand-Reducing
- **Anxiety**: What if we need embeddings back later? (Mitigation: adding them back is straightforward -- DEFINE FIELD, DEFINE INDEX, backfill.)
- **Habit**: Schema changes are breaking in this project (no backwards compatibility). But 17 simultaneous index drops is a large migration.

### Assessment
- Switch likelihood: **Very High** (once Phases 1-2 complete)
- Key blocker: Must verify zero remaining consumers before dropping
- Key enabler: Project policy explicitly states no backwards compatibility for schema changes
- Design implication: Single migration script. Drop all HNSW indexes, REMOVE FIELD embedding from all tables, remove config, remove `embeddings.ts` module.
