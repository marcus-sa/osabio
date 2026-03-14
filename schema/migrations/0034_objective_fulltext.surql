-- Add BM25 full-text search index for objective title.
-- Uses the existing entity_search analyzer defined in migration 0002.

BEGIN TRANSACTION;

DEFINE INDEX OVERWRITE idx_objective_fulltext ON objective FIELDS title FULLTEXT ANALYZER entity_search BM25(1.2, 0.75);

COMMIT TRANSACTION;
