-- Migration 0023: Introduce trace table and refactor intent.trace_id to record<trace>
--
-- A trace is a forensic "unit of thought" — the hierarchical call tree behind an intent.
-- Replaces the dumb UUID string with a graph-native record link.

DEFINE TABLE OVERWRITE trace SCHEMAFULL;
DEFINE FIELD type ON trace TYPE string
  ASSERT $value IN ["tool_call", "message", "subagent_spawn", "intent_submission", "bridge_exchange"];
DEFINE FIELD actor ON trace TYPE record<identity>;
DEFINE FIELD workspace ON trace TYPE record<workspace>;
DEFINE FIELD session ON trace TYPE option<record<agent_session>>;
DEFINE FIELD parent_trace ON trace TYPE option<record<trace>>;
DEFINE FIELD tool_name ON trace TYPE option<string>;
DEFINE FIELD input ON trace TYPE option<object> FLEXIBLE;
DEFINE FIELD output ON trace TYPE option<object> FLEXIBLE;
DEFINE FIELD duration_ms ON trace TYPE option<int>;
DEFINE FIELD created_at ON trace TYPE datetime;

DEFINE INDEX trace_parent ON trace FIELDS parent_trace;
DEFINE INDEX trace_session ON trace FIELDS session;
DEFINE INDEX trace_workspace ON trace FIELDS workspace;
DEFINE INDEX trace_created_at ON trace FIELDS created_at;

BEGIN TRANSACTION;

-- Refactor intent.trace_id from string to record<trace>
DEFINE FIELD OVERWRITE trace_id ON intent TYPE record<trace>;
DEFINE INDEX OVERWRITE intent_trace_id ON intent FIELDS trace_id;

COMMIT TRANSACTION;
