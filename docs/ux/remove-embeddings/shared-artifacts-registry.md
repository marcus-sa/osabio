# Shared Artifacts Registry: Remove Embeddings

## Artifacts

### BM25 Analyzer Definition
- **Source of truth**: `schema/migrations/0002_fulltext_search_indexes.surql`
- **Consumers**: `entity-search-route.ts`, `search-entities.ts` (Phase 1), `detector.ts` (Phase 1), `intent-context.ts` (Phase 2)
- **Owner**: Schema layer
- **Integration risk**: LOW -- analyzer already defined, proven in production for UI entity search
- **Validation**: `INFO FOR DB` shows `entity_search` analyzer with snowball(english) + lowercase filters

### BM25 Search SQL Pattern
- **Source of truth**: `entity-search-route.ts` (`buildWorkspaceSearchSQL` / `buildProjectSearchSQL`)
- **Consumers**: `search-entities.ts` (new BM25 implementation), `intent-context.ts` (Phase 2 BM25 fallback)
- **Owner**: Entity search module
- **Integration risk**: LOW -- pattern reuse, not code duplication. Each consumer adapts the pattern to its entity types.
- **Validation**: Each consumer produces valid BM25 results for its target entity types

### Alignment Classification Thresholds
- **Source of truth**: `objective/alignment.ts` (`MATCHED_THRESHOLD=0.7`, `AMBIGUOUS_THRESHOLD=0.5`)
- **Consumers**: `alignment-adapter.ts`, `authorizer.ts`
- **Owner**: Objective module
- **Integration risk**: MEDIUM -- thresholds were calibrated for cosine similarity. Graph traversal produces binary match/no-match. BM25 fallback scores need recalibration.
- **Validation**: Acceptance tests verify classification for matched, ambiguous, and none cases

### Context Injection XML Builder
- **Source of truth**: `proxy/context-injector.ts` (`buildOsabioContextXml`, `buildRecentChangesXml`)
- **Consumers**: Proxy route
- **Owner**: Proxy module
- **Integration risk**: LOW -- XML construction is independent of ranking method. `selectWithinBudget` is pure and reusable.
- **Validation**: Existing unit tests for XML builder remain valid

### Learning Collision Thresholds
- **Source of truth**: `learning/detector.ts` (`DISMISSED_SIMILARITY_THRESHOLD=0.85`)
- **Consumers**: `suggestLearning`, `checkDismissedSimilarity`
- **Owner**: Learning module
- **Integration risk**: MEDIUM -- BM25 scores are not on the same scale as cosine similarity. Threshold must be recalibrated for BM25 scoring.
- **Validation**: Acceptance tests verify that near-identical dismissed learnings are blocked, and genuinely different learnings pass

### Fulltext Index Definitions (New)
- **Source of truth**: New migration `schema/migrations/NNNN_bm25_learning_index.surql`
- **Consumers**: `detector.ts` (collision detection), `learning-diagnosis.ts` (coverage check)
- **Owner**: Schema layer
- **Integration risk**: LOW -- follows established pattern from migration 0002
- **Validation**: `INFO FOR TABLE learning` shows fulltext index on `text` field

### Graph Alignment Query (New)
- **Source of truth**: `objective/alignment-adapter.ts` (new graph traversal query)
- **Consumers**: `authorizer.ts`
- **Owner**: Objective module
- **Integration risk**: MEDIUM -- depends on correct graph edges existing (task->belongs_to->project, workspace->has_objective->objective). Missing edges produce false negatives.
- **Validation**: Acceptance tests create full graph paths and verify alignment detection

## Integration Risk Summary

| Risk Level | Artifact | Mitigation |
|------------|----------|------------|
| MEDIUM | Alignment classification thresholds | Recalibrate for graph traversal (binary) + BM25 (score-based) |
| MEDIUM | Learning collision thresholds | Recalibrate for BM25 scoring scale |
| MEDIUM | Graph alignment query | Ensure graph edges are consistently created on entity writes |
| LOW | BM25 analyzer | Already proven in production |
| LOW | BM25 search pattern | Established pattern in entity-search-route.ts |
| LOW | Context injection XML | Independent of ranking method |
| LOW | Fulltext index definitions | Follows migration 0002 pattern |
