-- Migration 0044: Observer EVENT for per-trace analysis
--
-- Fires on trace CREATE when type='llm_call', posting to Observer webhook.
-- ASYNC + RETRY 3 ensures non-blocking, resilient delivery.
-- The Observer route returns 200 on all analysis errors to prevent retries
-- for non-transient failures.

BEGIN TRANSACTION;

-- EVENT 6: trace_llm_call_created — fires when a new LLM call trace is created
DEFINE EVENT OVERWRITE trace_llm_call_created ON trace
  ASYNC
  RETRY 3
  WHEN $event = "CREATE" AND $after.type = "llm_call"
  THEN {
    http::post("http://localhost:3000/api/observe/trace/" + <string> meta::id($after.id), $after)
  };

COMMIT TRANSACTION;
