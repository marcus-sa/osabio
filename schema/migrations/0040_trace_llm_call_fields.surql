-- Migration 0040: Add llm_call to trace type ASSERT and LLM-specific fields
-- Step: 01-01 (LLM proxy schema migrations)
--
-- Adds 'llm_call' to the trace.type ASSERT enum and defines optional
-- LLM-specific fields for model, provider, token usage, cost, and metadata.

BEGIN TRANSACTION;

-- Extend trace.type to include llm_call
DEFINE FIELD OVERWRITE type ON trace TYPE string
  ASSERT $value IN ["tool_call", "message", "subagent_spawn", "intent_submission", "bridge_exchange", "llm_call"];

-- LLM-specific optional fields
DEFINE FIELD OVERWRITE model ON trace TYPE option<string>;
DEFINE FIELD OVERWRITE provider ON trace TYPE option<string>;
DEFINE FIELD OVERWRITE input_tokens ON trace TYPE option<int>;
DEFINE FIELD OVERWRITE output_tokens ON trace TYPE option<int>;
DEFINE FIELD OVERWRITE cache_creation_tokens ON trace TYPE option<int>;
DEFINE FIELD OVERWRITE cache_read_tokens ON trace TYPE option<int>;
DEFINE FIELD OVERWRITE cost_usd ON trace TYPE option<float>;
DEFINE FIELD OVERWRITE stop_reason ON trace TYPE option<string>;
DEFINE FIELD OVERWRITE request_id ON trace TYPE option<string>;
DEFINE FIELD OVERWRITE latency_ms ON trace TYPE option<int>;

COMMIT TRANSACTION;
