-- Migration 0026: Update graph traversal functions for governance edges
-- Adds governing, protects, triggered_by, gates edge tables to fn::entity_edges,
-- fn::edges_between, fn::graph_neighbors. Adds policy + intent collection to
-- fn::workspace_entity_ids.

DEFINE FUNCTION OVERWRITE fn::entity_edges($entity: record, $lim: int) {
  RETURN SELECT id, `in`, out, kind, confidence
    FROM entity_relation, belongs_to, has_feature, has_task, has_project,
         depends_on, owns, observes, suggests_for, subtask_of,
         governing, protects, triggered_by, gates
    WHERE `in` = $entity OR out = $entity
    LIMIT $lim;
};

DEFINE FUNCTION OVERWRITE fn::edges_between($ids: array) {
  RETURN SELECT id, `in`, out, kind, confidence
    FROM entity_relation, belongs_to, has_feature, has_task, has_project,
         depends_on, owns, observes, suggests_for, subtask_of,
         governing, protects, triggered_by, gates
    WHERE `in` IN $ids AND out IN $ids;
};

DEFINE FUNCTION OVERWRITE fn::graph_neighbors($ids: array) {
  RETURN SELECT `in`, out
    FROM entity_relation, belongs_to, has_feature, has_task, has_project,
         depends_on, owns, observes, suggests_for, subtask_of,
         governing, protects, triggered_by, gates
    WHERE `in` IN $ids OR out IN $ids;
};

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
  LET $policies = (SELECT VALUE `in` FROM protects WHERE out = $ws AND `in`.status IN ['active', 'testing']);
  LET $intents = (SELECT VALUE id FROM intent WHERE workspace = $ws AND status NOT IN ['completed', 'vetoed', 'failed']);
  LET $agent_sessions = (SELECT VALUE out FROM gates WHERE `in` IN $intents);
  RETURN array::distinct(
    [$ws] + $projects + $features + $tasks +
    $belongs_project + $belongs_feature +
    $identities + $provenance +
    $policies + $intents + $agent_sessions
  );
};
