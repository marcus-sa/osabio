# Component Boundaries: Remove Embeddings

## Dependency Impact Analysis

### Core Modules Deleted (Phase 3)

| Module | Path | Importers | Impact |
|--------|------|-----------|--------|
| `embeddings.ts` | `graph/embeddings.ts` | 23 files | All `createEmbeddingVector` and `cosineSimilarity` imports removed |
| `embedding-writeback.ts` | `extraction/embedding-writeback.ts` | 1 file (`chat-processor.ts`) | `persistEmbeddings` call removed |

### Modules Modified Per Phase

#### Phase 1A: Chat Agent BM25 Search

| Module | Change | Boundary Impact |
|--------|--------|-----------------|
| `chat/tools/search-entities.ts` | Replace `createEmbeddingVector` + `searchEntitiesByEmbedding` with BM25 query function | Input: query string. Output: `RankedEntity[]`. Same contract. |
| `chat/tools/suggest-work-items.ts` | Replace `searchEntitiesByEmbedding` with same BM25 function | Same as above |
| `chat/context.ts` | Replace `searchEntitiesByEmbedding` with BM25 | Same contract |
| `mcp/mcp-route.ts` | Replace `searchEntitiesByEmbedding` with BM25 | Same contract |
| `mcp/intent-context.ts` | Replace `searchEntitiesByEmbedding` with BM25 | Same contract |
| `graph/queries.ts` | Remove `searchEntitiesByEmbedding`, `listScopedEntityCandidates` (no longer needed for search) | Functions removed. All callers migrated. |
| `chat/tools/types.ts` | Remove `embeddingModel`, `embeddingDimension` from `ChatToolDeps` | Narrower dependency surface |

#### Phase 1B: Collision Detection BM25

| Module | Change | Boundary Impact |
|--------|--------|-----------------|
| `learning/collision.ts` | Replace `findSimilarRecords` (KNN) with BM25 queries. Remove `learningEmbedding` param from `checkCollisions`. | Input loses `learningEmbedding`. Same output contract. |
| `learning/detector.ts` | Replace `checkDismissedSimilarity` (KNN+brute-force) with BM25. Remove `embedding` from `suggestLearning`. | `suggestLearning` signature changes (no `embedding`). |
| `learning/learning-route.ts` | Remove embedding generation before collision check | Simpler: no longer needs `embeddingModel` |
| `observer/learning-diagnosis.ts` | Remove `createEmbeddingVector` call for cluster coverage check | Coverage check uses BM25 instead |

#### Phase 1C: Graph Alignment

| Module | Change | Boundary Impact |
|--------|--------|-----------------|
| `objective/alignment-adapter.ts` | Replace KNN with graph traversal + BM25 fallback. Port signature changes: receives entity reference instead of embedding vector. | `FindAlignedObjectives` port signature changes |
| `intent/authorizer.ts` | Update `FindAlignedObjectives` type: no longer receives embedding | Port type updated |
| `objective/alignment.ts` | No change (pure classification) | Unchanged |

#### Phase 2: Proxy Context

| Module | Change | Boundary Impact |
|--------|--------|-----------------|
| `proxy/context-injector.ts` | Replace `rankCandidates` (cosine) with BM25+recency. Replace `classifyBySimilarity` with time-based. Replace `createSearchRecentChanges` (KNN) with BM25+time. | `ContextCandidate.embedding` field removed. `SearchRecentChanges` signature changes (no embedding param). |
| `proxy/anthropic-proxy-route.ts` | Remove embedding generation for message | No longer needs `embeddingModel` |
| `proxy/context-cache.ts` | Remove embedding from cache structure | Cache key simplified |

#### Phase 3: Infrastructure Cleanup

| Module | Change | Boundary Impact |
|--------|--------|-----------------|
| `graph/embeddings.ts` | **Deleted** | All 23 importers already migrated in P1/P2 |
| `extraction/embedding-writeback.ts` | **Deleted** | `chat-processor.ts` already migrated |
| `runtime/config.ts` | Remove `embeddingModelId`, `embeddingDimension` | Config narrower |
| `runtime/dependencies.ts` | Remove `embeddingModel` from factory | Dep injection narrower |
| `runtime/types.ts` | Remove from `ServerDependencies` | Type narrower |
| `chat/chat-processor.ts` | Remove `persistEmbeddings` call | Simpler async flow |
| `extraction/entity-upsert.ts` | Remove embedding threading | Simpler write path |

## Files Importing from `graph/embeddings.ts` (23 files)

### Direct `createEmbeddingVector` importers

| File | Usage | Phase |
|------|-------|-------|
| `chat/tools/search-entities.ts` | Query embedding for search | P1A |
| `chat/tools/suggest-work-items.ts` | Query embedding for dedup | P1A |
| `chat/tools/check-constraints.ts` | Embedding for constraint check | P1A |
| `chat/tools/create-observation.ts` | Embedding for observation | P3 |
| `chat/tools/create-suggestion.ts` | Embedding for suggestion | P3 |
| `chat/tools/create-work-item.ts` | Embedding for work item | P3 |
| `chat/tools/get-conversation-history.ts` | Embedding for history | P3 |
| `chat/tools/resolve-decision.ts` | Embedding for decision | P3 |
| `mcp/mcp-route.ts` | Embedding for MCP search | P1A |
| `mcp/intent-context.ts` | Embedding for intent context | P1A |
| `observer/learning-diagnosis.ts` | Embedding for cluster coverage | P1B |
| `observer/trace-response-analyzer.ts` | Embedding for trace analysis | P3 |
| `learning/learning-route.ts` | Embedding before collision check | P1B |
| `learning/detector.ts` | Embedding for dismissed check | P1B |
| `suggestion/queries.ts` | Embedding for suggestion creation | P3 |
| `observation/queries.ts` | Embedding for observation creation | P3 |
| `entities/work-item-accept-route.ts` | Embedding for accepted work item | P3 |
| `extraction/entity-upsert.ts` | Embedding threading | P3 |

### `cosineSimilarity` importers (subset)

| File | Usage | Phase |
|------|-------|-------|
| `graph/queries.ts` | `searchEntitiesByEmbedding` scoring | P1A |
| `proxy/context-injector.ts` | Context ranking | P2 |
| `learning/detector.ts` | Dismissed similarity | P1B |
| `observer/learning-diagnosis.ts` | Observation clustering | P3 |

## Boundary Principles

1. **Same output contracts** -- All BM25 replacements produce the same result types (`RankedEntity[]`, `CollisionCheckResult`, `AlignmentResult`, `RankedCandidate[]`). Downstream consumers unchanged.

2. **Input contracts narrow** -- Functions lose `embedding`/`queryEmbedding` parameters, gaining `queryText`/`learningText` instead. This is a simplification.

3. **Port signatures update** -- `FindAlignedObjectives`, `SearchRecentChanges`, `ChatToolDeps` types change. All changes propagate inward (dependency inversion preserved).

4. **Pure functions preserved** -- `alignment.ts` classification, `context-injector.ts` XML building, `selectWithinBudget` -- all pure functions that operate on scored/classified data remain unchanged.

5. **Phased removal** -- Embedding infrastructure stays functional until Phase 3. No intermediate broken states. Each phase can be deployed independently.
