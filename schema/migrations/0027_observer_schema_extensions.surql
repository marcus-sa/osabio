-- Observer agent schema extensions: add verified, source, data fields
-- and extend observation_type enum with "validation" and "error".

BEGIN TRANSACTION;

-- New fields on observation table
DEFINE FIELD OVERWRITE verified ON observation TYPE bool DEFAULT false;
DEFINE FIELD OVERWRITE source ON observation TYPE option<string>;
DEFINE FIELD OVERWRITE data ON observation TYPE option<object> FLEXIBLE;

-- Extend observation_type enum to include "validation" and "error"
DEFINE FIELD OVERWRITE observation_type ON observation TYPE option<string>
  ASSERT $value IN ["contradiction", "duplication", "missing", "deprecated", "pattern", "anomaly", "validation", "error"] OR $value IS NONE;

-- Extend observes relation OUT types to include intent, git_commit, observation
DEFINE TABLE OVERWRITE observes TYPE RELATION IN observation OUT project | feature | task | decision | question | intent | git_commit | observation SCHEMAFULL;
DEFINE FIELD OVERWRITE added_at ON observes TYPE option<datetime>;

COMMIT TRANSACTION;

-- Observer agent SurrealDB EVENTs (outside transaction — ASYNC EVENTs may not
-- work inside transactions in all SurrealDB versions).
-- The base URL is a placeholder; wireObserverEvents() overwrites in tests,
-- and production deploys configure via environment-specific migration.

-- EVENT 1: task_completed — fires when task transitions to completed/done
DEFINE EVENT OVERWRITE task_completed ON task
  ASYNC
  RETRY 3
  WHEN $event = "UPDATE"
    AND ($before.status != "completed" AND $before.status != "done")
    AND ($after.status = "completed" OR $after.status = "done")
  THEN {
    http::post("http://localhost:3000/api/observe/task/" + <string> meta::id($after.id), $after)
  };

-- EVENT 2: intent_completed — fires when intent transitions to completed/failed
DEFINE EVENT OVERWRITE intent_completed ON intent
  ASYNC
  RETRY 3
  WHEN $event = "UPDATE"
    AND ($before.status != "completed" AND $before.status != "failed")
    AND ($after.status = "completed" OR $after.status = "failed")
  THEN {
    http::post("http://localhost:3000/api/observe/intent/" + <string> meta::id($after.id), $after)
  };

-- EVENT 3: commit_created — fires on new git_commit creation
DEFINE EVENT OVERWRITE commit_created ON git_commit
  ASYNC
  RETRY 3
  WHEN $event = "CREATE"
  THEN {
    http::post("http://localhost:3000/api/observe/git_commit/" + <string> meta::id($after.id), $after)
  };

-- EVENT 4: decision_confirmed — fires when decision transitions to confirmed/superseded
DEFINE EVENT OVERWRITE decision_confirmed ON decision
  ASYNC
  RETRY 3
  WHEN $event = "UPDATE"
    AND $before.status != $after.status
    AND ($after.status = "confirmed" OR $after.status = "superseded")
  THEN {
    http::post("http://localhost:3000/api/observe/decision/" + <string> meta::id($after.id), $after)
  };

-- EVENT 5: observation_peer_review — fires on non-observer observation creation
-- Excludes observer_agent to prevent infinite recursion loops.
DEFINE EVENT OVERWRITE observation_peer_review ON observation
  ASYNC
  RETRY 3
  WHEN $event = "CREATE" AND $after.source_agent != "observer_agent"
  THEN {
    http::post("http://localhost:3000/api/observe/observation/" + <string> meta::id($after.id), $after)
  };
