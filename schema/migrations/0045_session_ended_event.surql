-- Migration 0045: session_ended EVENT on agent_session
-- Fires when agent_session.ended_at transitions from NONE to a value.
-- ASYNC + RETRY 3 ensures the observer webhook runs after the write commits
-- and retries on transient failures.

BEGIN TRANSACTION;

DEFINE EVENT OVERWRITE session_ended ON agent_session
  WHEN $before.ended_at IS NONE AND $after.ended_at IS NOT NONE
  THEN {
    http::post(
      "http://127.0.0.1:" + <string> $env.PORT + "/api/observe/agent_session/" + <string> record::id($after.id),
      {
        ended_at: $after.ended_at,
        workspace: $after.workspace,
        agent: $after.agent,
      }
    );
  }
  ASYNC
  RETRY 3;

COMMIT TRANSACTION;
