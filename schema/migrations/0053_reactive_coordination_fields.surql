-- Migration 0053: Add reactive coordination fields
-- agent_session.last_request_at: tracks last MCP/heartbeat request time
-- agent.description_embedding: enables semantic agent matching via HNSW

BEGIN TRANSACTION;

DEFINE FIELD OVERWRITE last_request_at ON agent_session TYPE option<datetime>;

DEFINE FIELD OVERWRITE description_embedding ON agent TYPE option<array<float>>;
DEFINE INDEX OVERWRITE idx_agent_description_embedding ON agent FIELDS description_embedding HNSW DIMENSION 1536 DIST COSINE;

COMMIT TRANSACTION;
