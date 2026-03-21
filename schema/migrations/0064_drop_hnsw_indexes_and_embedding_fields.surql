-- Migration 0064: Drop all HNSW indexes and embedding fields
--
-- ADR-062: Replace embeddings with BM25 and graph traversal.
-- This migration removes all vector embedding infrastructure from the schema.
-- HNSW indexes and embedding fields are no longer needed since all search
-- operations now use BM25 fulltext or graph traversal.

BEGIN TRANSACTION;

-- ── Remove HNSW indexes ──

REMOVE INDEX idx_message_embedding ON message;
REMOVE INDEX idx_project_embedding ON project;
REMOVE INDEX idx_feature_embedding ON feature;
REMOVE INDEX idx_task_embedding ON task;
REMOVE INDEX idx_decision_embedding ON decision;
REMOVE INDEX idx_question_embedding ON question;
REMOVE INDEX idx_observation_embedding ON observation;
REMOVE INDEX idx_suggestion_embedding ON suggestion;
REMOVE INDEX idx_person_embedding ON person;
REMOVE INDEX idx_document_chunk_embedding ON document_chunk;
REMOVE INDEX idx_git_commit_embedding ON git_commit;
REMOVE INDEX idx_intent_embedding ON intent;
REMOVE INDEX idx_policy_embedding ON policy;
REMOVE INDEX idx_learning_embedding ON learning;
REMOVE INDEX idx_objective_embedding ON objective;
REMOVE INDEX idx_agent_session_description_embedding ON agent_session;
REMOVE INDEX idx_agent_description_embedding ON agent;

-- ── Remove embedding fields ──

REMOVE FIELD embedding ON conversation;
REMOVE FIELD embedding ON message;
REMOVE FIELD embedding ON project;
REMOVE FIELD embedding ON feature;
REMOVE FIELD embedding ON task;
REMOVE FIELD embedding ON decision;
REMOVE FIELD embedding ON question;
REMOVE FIELD embedding ON observation;
REMOVE FIELD embedding ON suggestion;
REMOVE FIELD embedding ON person;
REMOVE FIELD embedding ON document_chunk;
REMOVE FIELD embedding ON git_commit;
REMOVE FIELD embedding ON intent;
REMOVE FIELD embedding ON policy;
REMOVE FIELD embedding ON learning;
REMOVE FIELD embedding ON objective;
REMOVE FIELD description_embedding ON agent_session;
REMOVE FIELD description_embedding ON agent;

-- ── Unset embedding data from existing rows ──

UPDATE conversation UNSET embedding;
UPDATE message UNSET embedding;
UPDATE project UNSET embedding;
UPDATE feature UNSET embedding;
UPDATE task UNSET embedding;
UPDATE decision UNSET embedding;
UPDATE question UNSET embedding;
UPDATE observation UNSET embedding;
UPDATE suggestion UNSET embedding;
UPDATE person UNSET embedding;
UPDATE document_chunk UNSET embedding;
UPDATE git_commit UNSET embedding;
UPDATE intent UNSET embedding;
UPDATE policy UNSET embedding;
UPDATE learning UNSET embedding;
UPDATE objective UNSET embedding;
UPDATE agent_session UNSET description_embedding;
UPDATE agent UNSET description_embedding;

COMMIT TRANSACTION;
