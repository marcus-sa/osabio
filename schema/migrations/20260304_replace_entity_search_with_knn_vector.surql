-- Replace substring entity search functions with KNN vector search
-- Adds observation, feature, project, person, and message to searchable entity types

DEFINE FUNCTION OVERWRITE fn::entity_search_workspace($vec: array<float>, $limit: int, $workspace: record<workspace>) {
  LET $safe_limit = math::min([math::max([$limit, 1]), 100]);

  LET $task_rows = SELECT
    id, "task" AS kind, title AS text,
    vector::similarity::cosine(embedding, $vec) AS similarity
  FROM task
  WHERE workspace = $workspace AND embedding <|20, COSINE|> $vec
  ORDER BY similarity DESC LIMIT $safe_limit;

  LET $decision_rows = SELECT
    id, "decision" AS kind, summary AS text,
    vector::similarity::cosine(embedding, $vec) AS similarity
  FROM decision
  WHERE workspace = $workspace AND embedding <|20, COSINE|> $vec
  ORDER BY similarity DESC LIMIT $safe_limit;

  LET $question_rows = SELECT
    id, "question" AS kind, text AS text,
    vector::similarity::cosine(embedding, $vec) AS similarity
  FROM question
  WHERE workspace = $workspace AND embedding <|20, COSINE|> $vec
  ORDER BY similarity DESC LIMIT $safe_limit;

  LET $observation_rows = SELECT
    id, "observation" AS kind, text AS text,
    vector::similarity::cosine(embedding, $vec) AS similarity
  FROM observation
  WHERE workspace = $workspace AND embedding <|20, COSINE|> $vec
  ORDER BY similarity DESC LIMIT $safe_limit;

  LET $feature_rows = SELECT
    id, "feature" AS kind, name AS text,
    vector::similarity::cosine(embedding, $vec) AS similarity
  FROM feature
  WHERE embedding <|20, COSINE|> $vec
  ORDER BY similarity DESC LIMIT $safe_limit;

  LET $project_rows = SELECT
    id, "project" AS kind, name AS text,
    vector::similarity::cosine(embedding, $vec) AS similarity
  FROM project
  WHERE workspace = $workspace AND embedding <|20, COSINE|> $vec
  ORDER BY similarity DESC LIMIT $safe_limit;

  LET $person_rows = SELECT
    id, "person" AS kind, name AS text,
    vector::similarity::cosine(embedding, $vec) AS similarity
  FROM person
  WHERE embedding <|20, COSINE|> $vec
  ORDER BY similarity DESC LIMIT $safe_limit;

  LET $message_rows = SELECT
    id, "message" AS kind, text AS text,
    vector::similarity::cosine(embedding, $vec) AS similarity
  FROM message
  WHERE conversation.workspace = $workspace AND embedding <|20, COSINE|> $vec
  ORDER BY similarity DESC LIMIT $safe_limit;

  LET $all = array::flatten([$task_rows, $decision_rows, $question_rows, $observation_rows, $feature_rows, $project_rows, $person_rows, $message_rows]);
  RETURN SELECT * FROM $all ORDER BY similarity DESC LIMIT $safe_limit;
};

DEFINE FUNCTION OVERWRITE fn::entity_search_project($vec: array<float>, $limit: int, $workspace: record<workspace>, $project: record<project>) {
  LET $safe_limit = math::min([math::max([$limit, 1]), 100]);
  LET $project_entity_ids = SELECT VALUE `in` FROM belongs_to WHERE out = $project;

  LET $task_rows = SELECT
    id, "task" AS kind, title AS text,
    vector::similarity::cosine(embedding, $vec) AS similarity
  FROM task
  WHERE workspace = $workspace AND id IN $project_entity_ids AND embedding <|20, COSINE|> $vec
  ORDER BY similarity DESC LIMIT $safe_limit;

  LET $decision_rows = SELECT
    id, "decision" AS kind, summary AS text,
    vector::similarity::cosine(embedding, $vec) AS similarity
  FROM decision
  WHERE workspace = $workspace AND id IN $project_entity_ids AND embedding <|20, COSINE|> $vec
  ORDER BY similarity DESC LIMIT $safe_limit;

  LET $question_rows = SELECT
    id, "question" AS kind, text AS text,
    vector::similarity::cosine(embedding, $vec) AS similarity
  FROM question
  WHERE workspace = $workspace AND id IN $project_entity_ids AND embedding <|20, COSINE|> $vec
  ORDER BY similarity DESC LIMIT $safe_limit;

  LET $observation_rows = SELECT
    id, "observation" AS kind, text AS text,
    vector::similarity::cosine(embedding, $vec) AS similarity
  FROM observation
  WHERE workspace = $workspace AND embedding <|20, COSINE|> $vec
  ORDER BY similarity DESC LIMIT $safe_limit;

  LET $feature_rows = SELECT
    id, "feature" AS kind, name AS text,
    vector::similarity::cosine(embedding, $vec) AS similarity
  FROM feature
  WHERE id IN $project_entity_ids AND embedding <|20, COSINE|> $vec
  ORDER BY similarity DESC LIMIT $safe_limit;

  LET $message_rows = SELECT
    id, "message" AS kind, text AS text,
    vector::similarity::cosine(embedding, $vec) AS similarity
  FROM message
  WHERE conversation.workspace = $workspace AND embedding <|20, COSINE|> $vec
  ORDER BY similarity DESC LIMIT $safe_limit;

  LET $all = array::flatten([$task_rows, $decision_rows, $question_rows, $observation_rows, $feature_rows, $message_rows]);
  RETURN SELECT * FROM $all ORDER BY similarity DESC LIMIT $safe_limit;
};
