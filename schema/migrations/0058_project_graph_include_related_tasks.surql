BEGIN TRANSACTION;

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
  LET $seed_task_ids = array::distinct($tasks + $belongs_project + $belongs_feature);
  LET $seed_tasks = (SELECT VALUE id FROM task WHERE id IN $seed_task_ids AND workspace = $ws);
  LET $depends_on_out = (SELECT VALUE out FROM depends_on WHERE `in` IN $seed_tasks AND record::tb(out) = "task");
  LET $depends_on_in = (SELECT VALUE `in` FROM depends_on WHERE out IN $seed_tasks AND record::tb(`in`) = "task");
  LET $subtask_children = (SELECT VALUE `in` FROM subtask_of WHERE out IN $seed_tasks);
  LET $subtask_parents = (SELECT VALUE out FROM subtask_of WHERE `in` IN $seed_tasks);
  LET $entity_rel_out = (SELECT VALUE out FROM entity_relation WHERE `in` IN $seed_tasks AND record::tb(out) = "task");
  LET $entity_rel_in = (SELECT VALUE `in` FROM entity_relation WHERE out IN $seed_tasks AND record::tb(`in`) = "task");
  LET $related_task_ids = array::distinct(
    $depends_on_out + $depends_on_in + $subtask_children + $subtask_parents + $entity_rel_out + $entity_rel_in
  );
  LET $related_tasks = (SELECT VALUE id FROM task WHERE id IN $related_task_ids AND workspace = $ws);
  LET $project_tasks = array::distinct($seed_tasks + $related_tasks);
  LET $intents = (SELECT VALUE `in` FROM triggered_by WHERE out IN $project_tasks AND `in`.status NOT IN ['completed', 'vetoed', 'failed']);
  LET $objectives = (SELECT VALUE out FROM has_objective WHERE `in` = $project);
  RETURN array::distinct(
    [$project] + $features + $project_tasks +
    $belongs_project + $belongs_feature +
    $identities + $provenance + $intents +
    $objectives
  );
};

COMMIT TRANSACTION;
