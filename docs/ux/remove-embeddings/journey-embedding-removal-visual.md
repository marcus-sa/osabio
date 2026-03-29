# Journey: Remove Embeddings from Osabio Knowledge Graph

## Journey Overview

```
PHASE 1 (High Confidence)           PHASE 2 (Medium Confidence)        PHASE 3 (Cleanup)
Replace 3 Use Cases                 Replace Proxy Context               Drop Infrastructure
        |                                   |                                   |
        v                                   v                                   v
+-------------------+              +-------------------+              +-------------------+
| 1. Chat Agent     |              | 4. Proxy Context  |              | 7. Drop HNSW      |
|    Search         |              |    Ranking         |              |    Indexes         |
| BM25 fulltext     |              | BM25 + recency    |              | 17 indexes removed |
+-------------------+              +-------------------+              +-------------------+
        |                                   |                                   |
        v                                   v                                   v
+-------------------+              +-------------------+              +-------------------+
| 2. Collision      |              | 5. Recent Changes |              | 8. Drop embedding  |
|    Detection      |              |    Classification  |              |    Fields          |
| BM25 + LLM gate   |              | Recency + graph   |              | All tables cleaned |
+-------------------+              +-------------------+              +-------------------+
        |                                   |                                   |
        v                                   v                                   v
+-------------------+              +-------------------+              +-------------------+
| 3. Objective      |              | 6. Intent Context |              | 9. Remove Config   |
|    Alignment      |              |    Resolution      |              |    & Module         |
| Graph traversal   |              | BM25 fallback     |              | embeddings.ts gone  |
+-------------------+              +-------------------+              +-------------------+
```

## Emotional Arc

- **Start**: Determined but cautious -- large cross-cutting refactoring with 26 file touchpoints
- **Phase 1**: Confidence building -- replacing 3 well-understood use cases with proven alternatives
- **Phase 2**: Focused attention -- proxy context is the highest-risk replacement
- **Phase 3**: Relief and satisfaction -- removing infrastructure debt, seeing simpler config and faster tests

---

## Step 1: Replace Chat Agent Search (search_entities tool)

### Current State
```
User query "authentication decisions"
    |
    v
createEmbeddingVector(query)  --> External API call (60s timeout)
    |
    v
searchEntitiesByEmbedding()
    |
    v
listScopedEntityCandidates()  --> Load 120+ rows WITH embeddings
    |
    v
cosineSimilarity() in JS     --> O(n * 1536) in-memory computation
    |
    v
Sort + slice top N
```

### Target State
```
User query "authentication decisions"
    |
    v
BM25 fulltext search         --> SurrealDB in-database (ms latency)
    |                              Uses existing entity_search analyzer
    v                              Snowball stemmer handles "auth" = "authentication"
Sort by BM25 score
    |
    v
Enrich with neighbors        --> Existing listEntityNeighbors (graph traversal)
```

### What Changes
- `search-entities.ts`: Replace `createEmbeddingVector` + `searchEntitiesByEmbedding` with BM25 queries modeled on `entity-search-route.ts`
- `graph/queries.ts`: Remove `searchEntitiesByEmbedding` and `listScopedEntityCandidates` (unused after migration)
- Tool description: Change "Semantic search" to "Full-text search" to set correct agent expectations
- Remove `embeddingModel` and `embeddingDimension` from `ChatToolDeps` (if no other tool uses them)

### What Breaks
- Queries using vocabulary not in the entity text won't match (e.g., searching "login" won't find a task titled "OAuth implementation"). Mitigated by: domain vocabulary in a single workspace is typically consistent.

### What Improves
- Search latency: ~60s worst case -> <100ms
- No external API dependency for search
- No in-memory cosine computation on 120+ candidates
- CI reliability: no embedding timeout failures in search tests

### Emotional State
- Entry: Cautious -- this is the first replacement
- Exit: Confident -- BM25 search is well-understood, proven in entity-search-route.ts

---

## Step 2: Replace Learning Collision Detection

### Current State
```
Observer proposes learning "enforce code review before merge"
    |
    v
createEmbeddingVector(text)   --> External API call
    |
    v
checkDismissedSimilarity()
    |
    v
Two-step KNN on learning table  --> HNSW index search
    |
    v
Brute-force fallback            --> Load ALL dismissed learnings with embeddings
    |
    v
cosineSimilarity() in JS        --> Compare against each dismissed learning
    |
    v
Threshold check (0.85 dismissed, 0.50 active coverage)
```

### Target State
```
Observer proposes learning "enforce code review before merge"
    |
    v
BM25 search against learning table  --> In-database fulltext search
    |                                     "enforce code review" matches existing
    v                                     Stemmer: "enforce"="enforcing", "review"="reviewed"
High BM25 score (>threshold)
    |
    +-- If dismissed match: block re-suggestion
    |
    +-- If active match: skip (already covered)
    |
    +-- If no match: allow proposal
```

### What Changes
- `learning/detector.ts`: Replace `checkDismissedSimilarity` with BM25 query against `learning` table
- Add BM25 fulltext index on `learning.text` field (new migration)
- Remove brute-force fallback (no longer needed)
- Remove embedding parameter from `suggestLearning`
- `observer/learning-diagnosis.ts`: Remove embedding generation for proposed learnings, remove centroid computation, replace coverage check with BM25

### What Breaks
- Paraphrased duplicates with no shared vocabulary won't be caught by BM25 alone. Mitigated by: learnings are short directive text ("enforce X", "require Y") -- vocabulary overlap is high for true duplicates. The 0.50 coverage threshold was already unreliable for cross-form comparisons.

### What Improves
- No external API call for collision detection
- No brute-force fallback loading all learnings into memory
- Simpler, more predictable collision detection
- Coverage check becomes reliable (BM25 same-form comparison vs unreliable 0.50 cross-form cosine)

### Emotional State
- Entry: Growing confidence from Step 1 success
- Exit: Relieved -- the dual KNN + brute-force pattern was the most complex embedding usage

---

## Step 3: Replace Objective-Intent Alignment

### Current State
```
Authorizer evaluates intent
    |
    v
createEmbeddingVector(intent.description)  --> External API call
    |
    v
findAlignedObjectivesSurreal()
    |
    v
Two-step KNN on objective table  --> HNSW index search
    |
    v
computeCosineSimilarity()        --> Pure cosine between intent and objective embeddings
    |
    v
classifyAlignment()              --> matched (>=0.7) / ambiguous (>=0.5) / none (<0.5)
    |
    v
createSupportsEdge()             --> RELATE intent->supports->objective
```

### Target State
```
Authorizer evaluates intent
    |
    v
resolveIntentContext()           --> Already resolves to task/project level
    |
    v
Graph traversal                  --> task->belongs_to->project<-has_project<-workspace
    |                                  ->has_objective->objective (via supports or scopes edges)
    v
Deterministic path match         --> If path exists: matched
    |                                  If no path: check BM25 fallback
    v
BM25 fallback (optional)        --> For unresolved intents: keyword match
    |                                  intent description against objective title+description
    v
classifyAlignment()              --> Same classification, deterministic evidence
```

### What Changes
- `objective/alignment-adapter.ts`: Replace KNN search with graph traversal query
- `objective/alignment.ts`: Keep classification logic, remove cosine computation (or keep as utility)
- `intent/authorizer.ts`: Adjust to use graph-based alignment
- New migration: No schema changes needed (graph edges already exist)
- Supersede ADR-032 with new ADR documenting the switch rationale

### What Breaks
- Free-form intents without task references lose automatic alignment. Mitigated by: intent resolution pipeline already resolves most intents to task/project level before authorization reaches alignment check.

### What Improves
- Alignment is deterministic and auditable (graph path vs probabilistic score)
- No external API call for alignment
- No two-step KNN workaround
- Governance: alignment evidence is a concrete graph path, not a floating-point score

### Emotional State
- Entry: Confident -- graph traversal is the natural fit for structured relationships
- Exit: Satisfied -- this was the most obviously wrong use of embeddings

---

## Steps 4-6: Phase 2 -- Proxy Context (Deferred)

Phase 2 replaces the proxy context injection pipeline:
- **Step 4**: Replace `rankCandidates` cosine ranking with BM25 + recency weighting
- **Step 5**: Replace `classifyBySimilarity` thresholds with recency + graph proximity classification
- **Step 6**: Replace vector search step in `resolveContextLevel` with BM25 fallback

### Key Risk
Proxy context affects external coding agents. Changes here are less observable -- degradation manifests as "the coding agent seemed to miss context" which is hard to detect automatically.

### Mitigation
- Instrument context injection with span attributes (already done via `withTracing`)
- Compare before/after: log which items were injected, compare relevance via human review
- Keep recency as primary signal (recent decisions are almost always relevant)

---

## Steps 7-9: Phase 3 -- Infrastructure Removal (After Phase 1+2)

### Step 7: Drop HNSW Indexes
```sql
-- Single migration script
BEGIN TRANSACTION;
  REMOVE INDEX idx_message_embedding ON message;
  REMOVE INDEX idx_project_embedding ON project;
  REMOVE INDEX idx_feature_embedding ON feature;
  -- ... (17 total)
COMMIT TRANSACTION;
```

### Step 8: Drop Embedding Fields
```sql
BEGIN TRANSACTION;
  REMOVE FIELD embedding ON message;
  REMOVE FIELD embedding ON project;
  REMOVE FIELD embedding ON feature;
  -- ... (all entity tables)
  UPDATE message UNSET embedding;
  UPDATE project UNSET embedding;
  -- ... (clear data)
COMMIT TRANSACTION;
```

### Step 9: Remove Config and Module
- Delete `app/src/server/graph/embeddings.ts`
- Remove `EMBEDDING_MODEL` and `EMBEDDING_DIMENSION` from `runtime/config.ts`
- Remove `embeddingModel` and `embeddingDimension` from `ServerDependencies`
- Remove embedding-related imports from all 26 consuming files
- Update `surreal-schema.surql` to remove all embedding field definitions and HNSW index definitions

---

## Shared Artifacts

| Artifact | Source of Truth | Consumers |
|----------|----------------|-----------|
| BM25 analyzer definition | `schema/migrations/0002_fulltext_search_indexes.surql` | entity-search-route, search-entities tool, learning collision, intent context |
| Entity search SQL patterns | `entity-search-route.ts` (buildWorkspaceSearchSQL) | search-entities tool (new), intent-context (new) |
| Alignment classification thresholds | `objective/alignment.ts` | alignment-adapter, authorizer |
| Context injection XML builder | `proxy/context-injector.ts` | proxy route |
| Token budget selector | `proxy/context-injector.ts` (selectWithinBudget) | proxy route |

## Integration Checkpoints

1. **After Phase 1**: All acceptance tests pass without embedding model configured. `search_entities` tool returns results via BM25. Learning collision detection blocks duplicates via BM25. Alignment check uses graph traversal.
2. **After Phase 2**: Proxy context injection works without embedding model. Context injection span attributes show comparable item counts.
3. **After Phase 3**: No references to `createEmbeddingVector` in codebase. No HNSW indexes in schema. `EMBEDDING_MODEL` config removed.
