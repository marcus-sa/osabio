-- Add BM25 full-text search indexes for UI entity search.
-- Replaces vector-based KNN search (which requires embedding API calls per query)
-- with fast, deterministic full-text search using SurrealDB analyzers.
--
-- NOTE: search::score() and @N@ do not work inside DEFINE FUNCTION (SurrealDB v3.0).
-- Search queries run from the app layer instead. See: https://github.com/surrealdb/surrealdb/issues/7013

-- DEFINE ANALYZER cannot run inside a transaction in SurrealDB v3.0
DEFINE ANALYZER OVERWRITE entity_search
  TOKENIZERS blank, class, camel, punct
  FILTERS snowball(english), lowercase;

BEGIN TRANSACTION;

DEFINE INDEX OVERWRITE idx_task_fulltext ON task FIELDS title FULLTEXT ANALYZER entity_search BM25(1.2, 0.75);
DEFINE INDEX OVERWRITE idx_decision_fulltext ON decision FIELDS summary FULLTEXT ANALYZER entity_search BM25(1.2, 0.75);
DEFINE INDEX OVERWRITE idx_question_fulltext ON question FIELDS text FULLTEXT ANALYZER entity_search BM25(1.2, 0.75);
DEFINE INDEX OVERWRITE idx_observation_fulltext ON observation FIELDS text FULLTEXT ANALYZER entity_search BM25(1.2, 0.75);
DEFINE INDEX OVERWRITE idx_feature_fulltext ON feature FIELDS name FULLTEXT ANALYZER entity_search BM25(1.2, 0.75);
DEFINE INDEX OVERWRITE idx_project_fulltext ON project FIELDS name FULLTEXT ANALYZER entity_search BM25(1.2, 0.75);
DEFINE INDEX OVERWRITE idx_person_fulltext ON person FIELDS name FULLTEXT ANALYZER entity_search BM25(1.2, 0.75);
DEFINE INDEX OVERWRITE idx_message_fulltext ON message FIELDS text FULLTEXT ANALYZER entity_search BM25(1.2, 0.75);

COMMIT TRANSACTION;
