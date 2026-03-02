DEFINE TABLE conversation SCHEMAFULL;
DEFINE FIELD createdAt ON conversation TYPE datetime;
DEFINE FIELD updatedAt ON conversation TYPE datetime;
DEFINE FIELD workspace ON conversation TYPE record<workspace>;
DEFINE FIELD source ON conversation TYPE option<string>;
DEFINE FIELD timestamp ON conversation TYPE option<datetime>;
DEFINE FIELD messages ON conversation TYPE option<array<record<message>>>;
DEFINE FIELD title ON conversation TYPE option<string>;
DEFINE FIELD title_source ON conversation TYPE option<string> ASSERT $value = NONE OR $value IN ["message", "entity"];
DEFINE FIELD embedding ON conversation TYPE option<array<float>>;
DEFINE INDEX conversation_createdAt ON conversation FIELDS createdAt;
DEFINE INDEX conversation_workspace ON conversation FIELDS workspace;

DEFINE TABLE message SCHEMAFULL;
DEFINE FIELD conversation ON message TYPE record<conversation>;
DEFINE FIELD role ON message TYPE string ASSERT $value IN ["user", "assistant"];
DEFINE FIELD text ON message TYPE string;
DEFINE FIELD createdAt ON message TYPE datetime;
DEFINE FIELD suggestions ON message TYPE option<array<string>>;
DEFINE FIELD clientMessageId ON message TYPE option<string>;
DEFINE FIELD embedding ON message TYPE option<array<float>>;
DEFINE INDEX message_conversation_createdAt ON message FIELDS conversation, createdAt;
DEFINE INDEX idx_message_embedding ON message FIELDS embedding HNSW DIMENSION 1536 DIST COSINE;

DEFINE TABLE entity SCHEMAFULL;
DEFINE FIELD kind ON entity TYPE string ASSERT $value IN ["task", "decision", "question"];
DEFINE FIELD text ON entity TYPE string;
DEFINE FIELD confidence ON entity TYPE float ASSERT $value >= 0 AND $value <= 1;
DEFINE FIELD sourceMessage ON entity TYPE record<message>;
DEFINE FIELD createdAt ON entity TYPE datetime;
DEFINE INDEX entity_createdAt ON entity FIELDS createdAt;

DEFINE TABLE relationship SCHEMAFULL;
DEFINE FIELD type ON relationship TYPE string ASSERT $value IN ["BELONGS_TO", "DEPENDS_ON"];
DEFINE FIELD fromText ON relationship TYPE string;
DEFINE FIELD toText ON relationship TYPE string;
DEFINE FIELD confidence ON relationship TYPE float ASSERT $value >= 0 AND $value <= 1;
DEFINE FIELD sourceMessage ON relationship TYPE record<message>;
DEFINE FIELD createdAt ON relationship TYPE datetime;
DEFINE INDEX relationship_createdAt ON relationship FIELDS createdAt;

DEFINE TABLE workspace SCHEMAFULL;
DEFINE FIELD name ON workspace TYPE string;
DEFINE FIELD status ON workspace TYPE string;
DEFINE FIELD description ON workspace TYPE option<string>;
DEFINE FIELD tools ON workspace TYPE option<array<string>>;
DEFINE FIELD onboarding_complete ON workspace TYPE bool;
DEFINE FIELD onboarding_turn_count ON workspace TYPE int;
DEFINE FIELD onboarding_summary_pending ON workspace TYPE bool;
DEFINE FIELD onboarding_started_at ON workspace TYPE datetime;
DEFINE FIELD onboarding_completed_at ON workspace TYPE option<datetime>;
DEFINE FIELD created_at ON workspace TYPE datetime;
DEFINE FIELD updated_at ON workspace TYPE option<datetime>;
DEFINE INDEX workspace_name ON workspace FIELDS name;

DEFINE TABLE project SCHEMAFULL;
DEFINE FIELD name ON project TYPE string;
DEFINE FIELD status ON project TYPE string;
DEFINE FIELD description ON project TYPE option<string>;
DEFINE FIELD embedding ON project TYPE option<array<float>>;
DEFINE FIELD created_at ON project TYPE datetime;
DEFINE FIELD updated_at ON project TYPE option<datetime>;
DEFINE INDEX project_name ON project FIELDS name;
DEFINE INDEX idx_project_embedding ON project FIELDS embedding HNSW DIMENSION 1536 DIST COSINE;

DEFINE TABLE feature SCHEMAFULL;
DEFINE FIELD name ON feature TYPE string;
DEFINE FIELD status ON feature TYPE string;
DEFINE FIELD description ON feature TYPE option<string>;
DEFINE FIELD prd ON feature TYPE option<string>;
DEFINE FIELD owner ON feature TYPE option<record<person>>;
DEFINE FIELD owner_name ON feature TYPE option<string>;
DEFINE FIELD embedding ON feature TYPE option<array<float>>;
DEFINE FIELD created_at ON feature TYPE datetime;
DEFINE FIELD updated_at ON feature TYPE option<datetime>;
DEFINE INDEX feature_name ON feature FIELDS name;
DEFINE INDEX idx_feature_embedding ON feature FIELDS embedding HNSW DIMENSION 1536 DIST COSINE;

DEFINE TABLE task SCHEMAFULL;
DEFINE FIELD title ON task TYPE string;
DEFINE FIELD owner ON task TYPE option<record<person>>;
DEFINE FIELD owner_name ON task TYPE option<string>;
DEFINE FIELD deadline ON task TYPE option<datetime>;
DEFINE FIELD status ON task TYPE string;
DEFINE FIELD priority ON task TYPE option<string>;
DEFINE FIELD created_at ON task TYPE datetime;
DEFINE FIELD updated_at ON task TYPE option<datetime>;
DEFINE FIELD source_message ON task TYPE option<record<message>>;
DEFINE FIELD extraction_confidence ON task TYPE option<float> ASSERT $value = NONE OR ($value >= 0 AND $value <= 1);
DEFINE FIELD extracted_at ON task TYPE option<datetime>;
DEFINE FIELD embedding ON task TYPE option<array<float>>;
DEFINE FIELD category ON task TYPE option<string>
  ASSERT $value IN ["engineering", "research", "marketing", "operations", "design", "sales"] OR $value IS NONE;
DEFINE INDEX task_status_deadline ON task FIELDS status, deadline;
DEFINE INDEX task_source_message ON task FIELDS source_message;
DEFINE INDEX idx_task_embedding ON task FIELDS embedding HNSW DIMENSION 1536 DIST COSINE;

DEFINE TABLE decision SCHEMAFULL;
DEFINE FIELD summary ON decision TYPE string;
DEFINE FIELD rationale ON decision TYPE option<string>;
DEFINE FIELD decided_by ON decision TYPE option<record<person>>;
DEFINE FIELD decided_by_name ON decision TYPE option<string>;
DEFINE FIELD decided_at ON decision TYPE option<datetime>;
DEFINE FIELD status ON decision TYPE string ASSERT $value IN ["extracted", "proposed", "confirmed", "superseded", "provisional", "inferred", "contested"];
DEFINE FIELD inferred_by ON decision TYPE option<string>;
DEFINE FIELD confirmed_by ON decision TYPE option<record<person>>;
DEFINE FIELD confirmed_at ON decision TYPE option<datetime>;
DEFINE FIELD options_considered ON decision TYPE option<array<string>>;
DEFINE FIELD based_on ON decision TYPE option<array<record>>;
DEFINE FIELD confirmation_notes ON decision TYPE option<string>;
DEFINE FIELD created_at ON decision TYPE datetime;
DEFINE FIELD updated_at ON decision TYPE option<datetime>;
DEFINE FIELD source_message ON decision TYPE option<record<message>>;
DEFINE FIELD extraction_confidence ON decision TYPE option<float> ASSERT $value = NONE OR ($value >= 0 AND $value <= 1);
DEFINE FIELD extracted_at ON decision TYPE option<datetime>;
DEFINE FIELD embedding ON decision TYPE option<array<float>>;
DEFINE FIELD category ON decision TYPE option<string>
  ASSERT $value IN ["engineering", "research", "marketing", "operations", "design", "sales"] OR $value IS NONE;
DEFINE INDEX decision_status_decided_at ON decision FIELDS status, decided_at;
DEFINE INDEX decision_source_message ON decision FIELDS source_message;
DEFINE INDEX idx_decision_embedding ON decision FIELDS embedding HNSW DIMENSION 1536 DIST COSINE;

DEFINE TABLE question SCHEMAFULL;
DEFINE FIELD text ON question TYPE string;
DEFINE FIELD assigned_to ON question TYPE option<record<person>>;
DEFINE FIELD assigned_to_name ON question TYPE option<string>;
DEFINE FIELD status ON question TYPE string;
DEFINE FIELD context ON question TYPE option<string>;
DEFINE FIELD created_at ON question TYPE datetime;
DEFINE FIELD updated_at ON question TYPE option<datetime>;
DEFINE FIELD source_message ON question TYPE option<record<message>>;
DEFINE FIELD extraction_confidence ON question TYPE option<float> ASSERT $value = NONE OR ($value >= 0 AND $value <= 1);
DEFINE FIELD extracted_at ON question TYPE option<datetime>;
DEFINE FIELD embedding ON question TYPE option<array<float>>;
DEFINE FIELD category ON question TYPE option<string>
  ASSERT $value IN ["engineering", "research", "marketing", "operations", "design", "sales"] OR $value IS NONE;
DEFINE INDEX question_status ON question FIELDS status;
DEFINE INDEX question_source_message ON question FIELDS source_message;
DEFINE INDEX idx_question_embedding ON question FIELDS embedding HNSW DIMENSION 1536 DIST COSINE;

DEFINE TABLE observation SCHEMAFULL;
DEFINE FIELD text ON observation TYPE string;
DEFINE FIELD severity ON observation TYPE string ASSERT $value IN ["info", "warning", "conflict"];
DEFINE FIELD status ON observation TYPE string ASSERT $value IN ["open", "acknowledged", "resolved"];
DEFINE FIELD category ON observation TYPE option<string>
  ASSERT $value IN ["engineering", "research", "marketing", "operations", "design", "sales"] OR $value IS NONE;
DEFINE FIELD source_agent ON observation TYPE string;
DEFINE FIELD workspace ON observation TYPE record<workspace>;
DEFINE FIELD source_message ON observation TYPE option<record<message>>;
DEFINE FIELD resolved_at ON observation TYPE option<datetime>;
DEFINE FIELD resolved_by ON observation TYPE option<record<person>>;
DEFINE FIELD created_at ON observation TYPE datetime;
DEFINE FIELD updated_at ON observation TYPE option<datetime>;
DEFINE FIELD embedding ON observation TYPE option<array<float>>;
DEFINE INDEX observation_workspace_status ON observation FIELDS workspace, status;
DEFINE INDEX observation_severity ON observation FIELDS severity;
DEFINE INDEX observation_created_at ON observation FIELDS created_at;
DEFINE INDEX idx_observation_embedding ON observation FIELDS embedding HNSW DIMENSION 1536 DIST COSINE;

DEFINE TABLE person SCHEMAFULL;
DEFINE FIELD name ON person TYPE string;
DEFINE FIELD role ON person TYPE option<string>;
DEFINE FIELD contact_email ON person TYPE option<string>;
DEFINE FIELD contact_phone ON person TYPE option<string>;
DEFINE FIELD identities ON person TYPE option<array<object>>;
DEFINE FIELD identities[*].provider ON person TYPE string;
DEFINE FIELD identities[*].id ON person TYPE string;
DEFINE FIELD embedding ON person TYPE option<array<float>>;
DEFINE FIELD created_at ON person TYPE datetime;
DEFINE FIELD updated_at ON person TYPE option<datetime>;
DEFINE INDEX person_name ON person FIELDS name;
DEFINE INDEX idx_person_embedding ON person FIELDS embedding HNSW DIMENSION 1536 DIST COSINE;

DEFINE TABLE meeting SCHEMAFULL;
DEFINE FIELD title ON meeting TYPE string;
DEFINE FIELD attendees ON meeting TYPE option<array<record<person>>>;
DEFINE FIELD transcript_ref ON meeting TYPE option<string>;
DEFINE FIELD calendar_event_ref ON meeting TYPE option<string>;
DEFINE FIELD source_provider ON meeting TYPE option<string>;
DEFINE FIELD recorded_at ON meeting TYPE datetime;
DEFINE FIELD created_at ON meeting TYPE datetime;
DEFINE FIELD updated_at ON meeting TYPE option<datetime>;
DEFINE INDEX meeting_recorded_at ON meeting FIELDS recorded_at;

DEFINE TABLE document SCHEMAFULL;
DEFINE FIELD workspace ON document TYPE record<workspace>;
DEFINE FIELD name ON document TYPE string;
DEFINE FIELD mime_type ON document TYPE string;
DEFINE FIELD size_bytes ON document TYPE int;
DEFINE FIELD uploaded_at ON document TYPE datetime;
DEFINE INDEX document_workspace_uploaded_at ON document FIELDS workspace, uploaded_at;

DEFINE TABLE document_chunk SCHEMAFULL;
DEFINE FIELD document ON document_chunk TYPE record<document>;
DEFINE FIELD workspace ON document_chunk TYPE record<workspace>;
DEFINE FIELD content ON document_chunk TYPE string;
DEFINE FIELD section_heading ON document_chunk TYPE option<string>;
DEFINE FIELD position ON document_chunk TYPE int;
DEFINE FIELD embedding ON document_chunk TYPE option<array<float>>;
DEFINE FIELD created_at ON document_chunk TYPE datetime;
DEFINE INDEX document_chunk_document_position ON document_chunk FIELDS document, position;
DEFINE INDEX document_chunk_workspace_created_at ON document_chunk FIELDS workspace, created_at;
DEFINE INDEX idx_document_chunk_embedding ON document_chunk FIELDS embedding HNSW DIMENSION 1536 DIST COSINE;

DEFINE TABLE git_commit SCHEMAFULL;
DEFINE FIELD sha ON git_commit TYPE string;
DEFINE FIELD repository ON git_commit TYPE option<string>;
DEFINE FIELD message ON git_commit TYPE option<string>;
DEFINE FIELD authored_at ON git_commit TYPE option<datetime>;
DEFINE FIELD author ON git_commit TYPE option<record<person>>;
DEFINE FIELD url ON git_commit TYPE option<string>;
DEFINE FIELD created_at ON git_commit TYPE datetime;
DEFINE INDEX git_commit_sha ON git_commit FIELDS sha UNIQUE;

DEFINE TABLE pull_request SCHEMAFULL;
DEFINE FIELD external_id ON pull_request TYPE option<string>;
DEFINE FIELD title ON pull_request TYPE string;
DEFINE FIELD url ON pull_request TYPE string;
DEFINE FIELD status ON pull_request TYPE string;
DEFINE FIELD author ON pull_request TYPE option<record<person>>;
DEFINE FIELD repository ON pull_request TYPE option<string>;
DEFINE FIELD opened_at ON pull_request TYPE option<datetime>;
DEFINE FIELD merged_at ON pull_request TYPE option<datetime>;
DEFINE FIELD created_at ON pull_request TYPE datetime;
DEFINE INDEX pull_request_url ON pull_request FIELDS url UNIQUE;

DEFINE TABLE has_feature TYPE RELATION IN project OUT feature SCHEMAFULL;
DEFINE FIELD added_at ON has_feature TYPE datetime;

DEFINE TABLE has_project TYPE RELATION IN workspace OUT project SCHEMAFULL;
DEFINE FIELD added_at ON has_project TYPE datetime;

DEFINE TABLE has_task TYPE RELATION IN feature OUT task SCHEMAFULL;
DEFINE FIELD added_at ON has_task TYPE datetime;

DEFINE TABLE owns TYPE RELATION IN person OUT task | project | feature SCHEMAFULL;
DEFINE FIELD assigned_at ON owns TYPE datetime;

DEFINE TABLE member_of TYPE RELATION IN person OUT workspace SCHEMAFULL;
DEFINE FIELD role ON member_of TYPE option<string>;
DEFINE FIELD added_at ON member_of TYPE datetime;

DEFINE TABLE depends_on TYPE RELATION IN task | feature OUT task | feature SCHEMAFULL;
DEFINE FIELD type ON depends_on TYPE string ASSERT $value IN ["blocks", "needs", "soft"];
DEFINE FIELD added_at ON depends_on TYPE option<datetime>;

DEFINE TABLE extraction_relation TYPE RELATION IN message | document_chunk OUT workspace | project | person | feature | task | decision | question SCHEMAFULL;
DEFINE FIELD confidence ON extraction_relation TYPE float ASSERT $value >= 0 AND $value <= 1;
DEFINE FIELD extracted_at ON extraction_relation TYPE datetime;
DEFINE FIELD created_at ON extraction_relation TYPE datetime;
DEFINE FIELD model ON extraction_relation TYPE option<string>;
DEFINE FIELD from_text ON extraction_relation TYPE option<string>;
DEFINE FIELD evidence ON extraction_relation TYPE option<string>;
DEFINE FIELD evidence_source ON extraction_relation TYPE option<record<message>>;
DEFINE FIELD resolved_from ON extraction_relation TYPE option<record<message>>;
DEFINE FIELD to_text ON extraction_relation TYPE option<string>;
DEFINE INDEX extraction_relation_confidence ON extraction_relation FIELDS confidence;
DEFINE INDEX extraction_relation_extracted_at ON extraction_relation FIELDS extracted_at;
DEFINE INDEX extraction_relation_evidence_source ON extraction_relation FIELDS evidence_source;
DEFINE INDEX extraction_relation_resolved_from ON extraction_relation FIELDS resolved_from;

DEFINE TABLE entity_relation TYPE RELATION IN workspace | project | person | feature | task | decision | question OUT workspace | project | person | feature | task | decision | question SCHEMAFULL;
DEFINE FIELD kind ON entity_relation TYPE string ASSERT string::len(string::trim($value)) > 0;
DEFINE FIELD confidence ON entity_relation TYPE float ASSERT $value >= 0 AND $value <= 1;
DEFINE FIELD source_message ON entity_relation TYPE option<record<message>>;
DEFINE FIELD source_chunk ON entity_relation TYPE option<record<document_chunk>>;
DEFINE FIELD extracted_at ON entity_relation TYPE datetime;
DEFINE FIELD created_at ON entity_relation TYPE datetime;
DEFINE FIELD from_text ON entity_relation TYPE option<string>;
DEFINE FIELD to_text ON entity_relation TYPE option<string>;
DEFINE INDEX entity_relation_kind ON entity_relation FIELDS kind;
DEFINE INDEX entity_relation_confidence ON entity_relation FIELDS confidence;
DEFINE INDEX entity_relation_source_message ON entity_relation FIELDS source_message;
DEFINE INDEX entity_relation_source_chunk ON entity_relation FIELDS source_chunk;
DEFINE INDEX entity_relation_extracted_at ON entity_relation FIELDS extracted_at;

DEFINE TABLE decided_in TYPE RELATION IN decision OUT conversation | meeting SCHEMAFULL;
DEFINE FIELD message_ref ON decided_in TYPE option<record<message>>;
DEFINE FIELD added_at ON decided_in TYPE option<datetime>;

DEFINE TABLE belongs_to TYPE RELATION IN task | decision | question OUT feature | project SCHEMAFULL;
DEFINE FIELD added_at ON belongs_to TYPE datetime;

DEFINE TABLE observes TYPE RELATION IN observation OUT project | feature | task | decision | question SCHEMAFULL;
DEFINE FIELD added_at ON observes TYPE option<datetime>;

DEFINE TABLE touched_by TYPE RELATION IN project OUT conversation SCHEMAFULL;
DEFINE FIELD first_mention_at ON touched_by TYPE datetime;
DEFINE FIELD entity_count ON touched_by TYPE int ASSERT $value >= 1;
DEFINE INDEX touched_by_unique ON touched_by FIELDS `in`, out UNIQUE;
DEFINE INDEX touched_by_out ON touched_by FIELDS out;

DEFINE TABLE conflicts_with TYPE RELATION IN decision | feature OUT decision | feature SCHEMAFULL;
DEFINE FIELD description ON conflicts_with TYPE option<string>;
DEFINE FIELD severity ON conflicts_with TYPE option<string>;
DEFINE FIELD detected_at ON conflicts_with TYPE option<datetime>;

DEFINE TABLE implemented_by TYPE RELATION IN decision OUT git_commit | pull_request SCHEMAFULL;
DEFINE FIELD commit_sha ON implemented_by TYPE option<string>;
DEFINE FIELD pr_url ON implemented_by TYPE option<string>;
DEFINE FIELD linked_at ON implemented_by TYPE option<datetime>;

DEFINE TABLE superseded_by TYPE RELATION IN decision OUT decision SCHEMAFULL;
DEFINE FIELD reason ON superseded_by TYPE option<string>;
DEFINE FIELD superseded_at ON superseded_by TYPE datetime;

DEFINE TABLE branched_from TYPE RELATION IN conversation OUT conversation SCHEMAFULL;
DEFINE FIELD branched_at ON branched_from TYPE datetime;
DEFINE FIELD branch_point_message ON branched_from TYPE record<message>;
DEFINE INDEX branched_from_out ON branched_from FIELDS out;
DEFINE INDEX branched_from_in ON branched_from FIELDS `in`;

DEFINE TABLE attended_by TYPE RELATION IN meeting OUT person SCHEMAFULL;
DEFINE FIELD role ON attended_by TYPE option<string> ASSERT $value = NONE OR $value IN ["organizer", "attendee"];
DEFINE FIELD added_at ON attended_by TYPE option<datetime>;

DEFINE FUNCTION fn::entity_search_workspace($q: string, $limit: int, $workspace: record<workspace>) {
  LET $query = string::lowercase(string::trim($q));
  LET $safe_limit = math::min([math::max([$limit, 1]), 100]);
  LET $workspace_conversations = SELECT VALUE id FROM conversation WHERE workspace = $workspace;
  LET $workspace_messages = SELECT VALUE id FROM message WHERE conversation IN $workspace_conversations;

  LET $task_rows = SELECT
    id,
    "task" AS kind,
    title AS text,
    extraction_confidence AS confidence,
    source_message AS sourceMessage,
    created_at
  FROM task
  WHERE source_message != NONE
    AND source_message IN $workspace_messages
    AND extraction_confidence != NONE
    AND string::contains(string::lowercase(title), $query)
  ORDER BY created_at DESC
  LIMIT $safe_limit;

  LET $decision_rows = SELECT
    id,
    "decision" AS kind,
    summary AS text,
    extraction_confidence AS confidence,
    source_message AS sourceMessage,
    created_at
  FROM decision
  WHERE source_message != NONE
    AND source_message IN $workspace_messages
    AND extraction_confidence != NONE
    AND string::contains(string::lowercase(summary), $query)
  ORDER BY created_at DESC
  LIMIT $safe_limit;

  LET $question_rows = SELECT
    id,
    "question" AS kind,
    text AS text,
    extraction_confidence AS confidence,
    source_message AS sourceMessage,
    created_at
  FROM question
  WHERE source_message != NONE
    AND source_message IN $workspace_messages
    AND extraction_confidence != NONE
    AND string::contains(string::lowercase(text), $query)
  ORDER BY created_at DESC
  LIMIT $safe_limit;

  RETURN array::flatten([$task_rows, $decision_rows, $question_rows]);
};

DEFINE FUNCTION fn::entity_search_project($q: string, $limit: int, $workspace: record<workspace>, $project: record<project>) {
  LET $query = string::lowercase(string::trim($q));
  LET $safe_limit = math::min([math::max([$limit, 1]), 100]);
  LET $workspace_conversations = SELECT VALUE id FROM conversation WHERE workspace = $workspace;
  LET $workspace_messages = SELECT VALUE id FROM message WHERE conversation IN $workspace_conversations;
  LET $project_entity_ids = SELECT VALUE `in` FROM belongs_to WHERE out = $project;

  LET $task_rows = SELECT
    id,
    "task" AS kind,
    title AS text,
    extraction_confidence AS confidence,
    source_message AS sourceMessage,
    created_at
  FROM task
  WHERE source_message != NONE
    AND source_message IN $workspace_messages
    AND extraction_confidence != NONE
    AND id IN $project_entity_ids
    AND string::contains(string::lowercase(title), $query)
  ORDER BY created_at DESC
  LIMIT $safe_limit;

  LET $decision_rows = SELECT
    id,
    "decision" AS kind,
    summary AS text,
    extraction_confidence AS confidence,
    source_message AS sourceMessage,
    created_at
  FROM decision
  WHERE source_message != NONE
    AND source_message IN $workspace_messages
    AND extraction_confidence != NONE
    AND id IN $project_entity_ids
    AND string::contains(string::lowercase(summary), $query)
  ORDER BY created_at DESC
  LIMIT $safe_limit;

  LET $question_rows = SELECT
    id,
    "question" AS kind,
    text AS text,
    extraction_confidence AS confidence,
    source_message AS sourceMessage,
    created_at
  FROM question
  WHERE source_message != NONE
    AND source_message IN $workspace_messages
    AND extraction_confidence != NONE
    AND id IN $project_entity_ids
    AND string::contains(string::lowercase(text), $query)
  ORDER BY created_at DESC
  LIMIT $safe_limit;

  RETURN array::flatten([$task_rows, $decision_rows, $question_rows]);
};

DEFINE FUNCTION fn::conversation_recent($conversation: record<conversation>, $limit: int) {
  LET $safe_limit = math::min([math::max([$limit, 1]), 50]);
  RETURN SELECT id, role, text, createdAt
  FROM message
  WHERE conversation = $conversation
  ORDER BY createdAt DESC
  LIMIT $safe_limit;
};

DEFINE FUNCTION fn::entity_neighbors($entity: record) {
  RETURN SELECT
    ->entity_relation->(workspace, project, person, feature, task, decision, question) AS outgoing,
    <-entity_relation<-(workspace, project, person, feature, task, decision, question) AS incoming
  FROM $entity;
};
