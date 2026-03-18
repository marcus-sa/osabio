BEGIN TRANSACTION;

DEFINE FUNCTION OVERWRITE fn::workspace_entity_ids($ws: record<workspace>) {
  LET $projects = (SELECT VALUE out FROM has_project WHERE `in` = $ws);
  LET $project_features = (SELECT VALUE out FROM has_feature WHERE `in` IN $projects);
  LET $workspace_features = (SELECT VALUE id FROM feature WHERE workspace = $ws);
  LET $features = array::distinct($project_features + $workspace_features);
  LET $feature_tasks = (SELECT VALUE out FROM has_task WHERE `in` IN $features);
  LET $workspace_tasks = (SELECT VALUE id FROM task WHERE workspace = $ws);
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
  LET $policies = (SELECT VALUE `in` FROM protects WHERE out = $ws AND `in`.status IN ['active', 'testing']);
  LET $intents = (SELECT VALUE id FROM intent WHERE workspace = $ws AND status NOT IN ['completed', 'vetoed', 'failed']);
  LET $agent_sessions = (SELECT VALUE out FROM gates WHERE `in` IN $intents);
  LET $objectives = (SELECT VALUE out FROM has_objective WHERE `in` = $ws OR `in` IN $projects);
  LET $behaviors = (SELECT VALUE id FROM behavior WHERE workspace = $ws);
  RETURN array::distinct(
    [$ws] + $projects + $features + $feature_tasks + $workspace_tasks +
    $belongs_project + $belongs_feature +
    $identities + $provenance +
    $policies + $intents + $agent_sessions +
    $objectives + $behaviors
  );
};

COMMIT TRANSACTION;
