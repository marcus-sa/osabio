-- Migration 0063: Add "graph" and "bm25" alignment methods to supports table
--
-- Step 01-04 of remove-embeddings feature: graph-based objective alignment
-- replaces embedding KNN with graph traversal and BM25 fallback.

BEGIN TRANSACTION;

DEFINE FIELD OVERWRITE alignment_method ON supports TYPE string
  ASSERT $value IN ["embedding", "manual", "rule", "graph", "bm25"];

COMMIT TRANSACTION;
