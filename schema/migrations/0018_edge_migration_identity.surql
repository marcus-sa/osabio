-- Migration 0018: Edge migration -- ownership and attribution fields
-- Migrates all record<person> ownership fields to record<identity>
-- Updates relation table constraints (owns, member_of, attended_by)
-- Updates graph traversal functions for identity references

BEGIN TRANSACTION;

-- 1. Ownership fields: change record<person> to record<identity>
DEFINE FIELD OVERWRITE owner ON feature TYPE option<record<identity>>;
DEFINE FIELD OVERWRITE owner ON task TYPE option<record<identity>>;
DEFINE FIELD OVERWRITE decided_by ON decision TYPE option<record<identity>>;
DEFINE FIELD OVERWRITE confirmed_by ON decision TYPE option<record<identity>>;
DEFINE FIELD OVERWRITE assigned_to ON question TYPE option<record<identity>>;
DEFINE FIELD OVERWRITE resolved_by ON observation TYPE option<record<identity>>;
DEFINE FIELD OVERWRITE author ON git_commit TYPE option<record<identity>>;
DEFINE FIELD OVERWRITE author ON pull_request TYPE option<record<identity>>;

-- 2. Relation table constraints: IN person -> IN identity
DEFINE TABLE OVERWRITE owns TYPE RELATION IN identity OUT task | project | feature SCHEMAFULL;
DEFINE FIELD OVERWRITE assigned_at ON owns TYPE datetime;

DEFINE TABLE OVERWRITE member_of TYPE RELATION IN identity OUT workspace SCHEMAFULL;
DEFINE FIELD OVERWRITE role ON member_of TYPE option<string>;
DEFINE FIELD OVERWRITE added_at ON member_of TYPE datetime;

DEFINE TABLE OVERWRITE attended_by TYPE RELATION IN meeting OUT identity SCHEMAFULL;
DEFINE FIELD OVERWRITE role ON attended_by TYPE option<string> ASSERT $value = NONE OR $value IN ["organizer", "attendee"];
DEFINE FIELD OVERWRITE added_at ON attended_by TYPE option<datetime>;

-- 3. Update graph functions for identity traversals

-- fn::entity_neighbors: add identity to traversal targets
DEFINE FUNCTION OVERWRITE fn::entity_neighbors($entity: record) {
  RETURN SELECT
    ->entity_relation->(workspace, project, person, identity, feature, task, decision, question) AS outgoing,
    <-entity_relation<-(workspace, project, person, identity, feature, task, decision, question) AS incoming
  FROM $entity;
};

-- fn::workspace_entity_ids: query identity instead of person via member_of
DEFINE FUNCTION OVERWRITE fn::workspace_entity_ids($ws: record<workspace>) {
  LET $projects = (SELECT VALUE out FROM has_project WHERE `in` = $ws);
  LET $features = (SELECT VALUE out FROM has_feature WHERE `in` IN $projects);
  LET $tasks = (SELECT VALUE out FROM has_task WHERE `in` IN $features);
  LET $belongs_project = (SELECT VALUE `in` FROM belongs_to WHERE out IN $projects);
  LET $belongs_feature = (SELECT VALUE `in` FROM belongs_to WHERE out IN $features);
  LET $identities = (SELECT VALUE `in` FROM member_of WHERE out = $ws);
  LET $provenance = (
    SELECT VALUE out FROM extraction_relation
    WHERE `in` IN (
      SELECT VALUE id FROM message
      WHERE conversation IN (
        SELECT VALUE id FROM conversation WHERE workspace = $ws
      )
    )
  );
  RETURN array::distinct(
    $projects + $features + $tasks +
    $belongs_project + $belongs_feature +
    $identities + $provenance
  );
};

-- fn::project_entity_ids: query identity instead of person via member_of
DEFINE FUNCTION OVERWRITE fn::project_entity_ids($ws: record<workspace>, $project: record<project>) {
  LET $features = (SELECT VALUE out FROM has_feature WHERE `in` = $project);
  LET $tasks = (SELECT VALUE out FROM has_task WHERE `in` IN $features);
  LET $belongs_project = (SELECT VALUE `in` FROM belongs_to WHERE out = $project);
  LET $belongs_feature = (SELECT VALUE `in` FROM belongs_to WHERE out IN $features);
  LET $identities = (SELECT VALUE `in` FROM member_of WHERE out = $ws);
  LET $provenance = (
    SELECT VALUE out FROM extraction_relation
    WHERE `in` IN (
      SELECT VALUE id FROM message
      WHERE conversation IN (
        SELECT VALUE id FROM conversation WHERE workspace = $ws
      )
    )
  );
  RETURN array::distinct(
    [$project] + $features + $tasks +
    $belongs_project + $belongs_feature +
    $identities + $provenance
  );
};

COMMIT TRANSACTION;
