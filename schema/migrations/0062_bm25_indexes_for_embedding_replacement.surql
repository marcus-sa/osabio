-- Add BM25 full-text search indexes for learning and policy tables.
-- Required by the remove-embeddings feature (Phase 1) to replace vector search
-- with deterministic BM25 full-text search.
--
-- Reuses the existing entity_search analyzer from migration 0002.
-- Pattern: DEFINE INDEX OVERWRITE for idempotency.

BEGIN TRANSACTION;

DEFINE INDEX OVERWRITE idx_learning_fulltext ON learning FIELDS text FULLTEXT ANALYZER entity_search BM25(1.2, 0.75);
DEFINE INDEX OVERWRITE idx_policy_fulltext ON policy FIELDS description FULLTEXT ANALYZER entity_search BM25(1.2, 0.75);

COMMIT TRANSACTION;
