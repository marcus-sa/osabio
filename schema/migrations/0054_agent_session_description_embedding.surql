-- Migration 0054: Add description_embedding to agent_session for KNN routing
-- Enables the coordinator to do KNN directly on agent_session instead of
-- joining agent (HNSW) with agent_session (B-tree), which avoids the
-- SurrealDB v3.0 KNN + WHERE index conflict bug.

BEGIN TRANSACTION;

DEFINE FIELD OVERWRITE description_embedding ON agent_session TYPE option<array<float>>;
DEFINE INDEX OVERWRITE idx_agent_session_description_embedding ON agent_session FIELDS description_embedding HNSW DIMENSION 1536 DIST COSINE;

COMMIT TRANSACTION;
