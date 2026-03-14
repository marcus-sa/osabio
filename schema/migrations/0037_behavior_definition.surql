BEGIN TRANSACTION;

-- 1. Create behavior_definition table
DEFINE TABLE behavior_definition SCHEMAFULL;
DEFINE FIELD title ON behavior_definition TYPE string;
DEFINE FIELD goal ON behavior_definition TYPE string;
DEFINE FIELD scoring_logic ON behavior_definition TYPE string;
DEFINE FIELD scoring_mode ON behavior_definition TYPE string
  ASSERT $value IN ["llm", "deterministic"];
DEFINE FIELD telemetry_types ON behavior_definition TYPE array<string>;
DEFINE FIELD category ON behavior_definition TYPE option<string>;
DEFINE FIELD status ON behavior_definition TYPE string
  ASSERT $value IN ["draft", "active", "archived"];
DEFINE FIELD version ON behavior_definition TYPE int ASSERT $value > 0;
DEFINE FIELD enforcement_mode ON behavior_definition TYPE string
  ASSERT $value IN ["warn_only", "automatic"]
  DEFAULT "warn_only";
DEFINE FIELD enforcement_threshold ON behavior_definition TYPE option<float>
  ASSERT $value = NONE OR ($value >= 0.0 AND $value <= 1.0);
DEFINE FIELD workspace ON behavior_definition TYPE record<workspace>;
DEFINE FIELD created_by ON behavior_definition TYPE option<record<identity>>;
DEFINE FIELD created_at ON behavior_definition TYPE datetime;
DEFINE FIELD updated_at ON behavior_definition TYPE option<datetime>;
DEFINE INDEX idx_behaviordef_workspace ON behavior_definition FIELDS workspace;
DEFINE INDEX idx_behaviordef_ws_status ON behavior_definition FIELDS workspace, status;

-- 2. Remove enum ASSERT from behavior.metric_type (allow any string)
DEFINE FIELD OVERWRITE metric_type ON behavior TYPE string;

-- 3. Add definition reference fields to behavior table
DEFINE FIELD definition ON behavior TYPE record<behavior_definition>;
DEFINE FIELD definition_version ON behavior TYPE int ASSERT $value > 0;

COMMIT TRANSACTION;
