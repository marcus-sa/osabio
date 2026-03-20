# Data Models: Remove Embeddings

## Schema Changes Overview

### New BM25 Indexes (Phase 1 Migration)

Migration: `0062_add_learning_policy_fulltext_indexes.surql`

```sql
DEFINE INDEX OVERWRITE idx_learning_text_fulltext ON learning FIELDS text FULLTEXT ANALYZER entity_search BM25(1.2, 0.75);
DEFINE INDEX OVERWRITE idx_policy_description_fulltext ON policy FIELDS description FULLTEXT ANALYZER entity_search BM25(1.2, 0.75);
```

These use the existing `entity_search` analyzer (defined in migration 0002):
```sql
DEFINE ANALYZER entity_search
  TOKENIZERS blank, class, camel, punct
  FILTERS snowball(english), lowercase;
```

### Existing BM25 Indexes (Already Defined)

| Index | Table.Field | Source |
|-------|-------------|--------|
| `idx_task_fulltext` | `task.title` | migration 0002 |
| `idx_decision_fulltext` | `decision.summary` | migration 0002 |
| `idx_question_fulltext` | `question.text` | migration 0002 |
| `idx_observation_fulltext` | `observation.text` | migration 0002 |
| `idx_feature_fulltext` | `feature.name` | migration 0002 |
| `idx_project_fulltext` | `project.name` | migration 0002 |
| `idx_person_fulltext` | `person.name` | migration 0002 |
| `idx_message_fulltext` | `message.text` | migration 0002 |
| `idx_suggestion_fulltext` | `suggestion.text` | migration 0008 |
| `idx_objective_fulltext` | `objective.title` | migration 0034 |

### HNSW Indexes to Drop (Phase 3 Migration)

Migration: `0063_drop_embedding_infrastructure.surql`

18 HNSW indexes to remove:

| Index | Table |
|-------|-------|
| `idx_message_embedding` | `message` |
| `idx_project_embedding` | `project` |
| `idx_feature_embedding` | `feature` |
| `idx_task_embedding` | `task` |
| `idx_decision_embedding` | `decision` |
| `idx_question_embedding` | `question` |
| `idx_agent_session_description_embedding` | `agent_session` |
| `idx_observation_embedding` | `observation` |
| `idx_suggestion_embedding` | `suggestion` |
| `idx_person_embedding` | `person` |
| `idx_agent_description_embedding` | `agent` |
| `idx_document_chunk_embedding` | `document_chunk` |
| `idx_git_commit_embedding` | `git_commit` |
| `idx_intent_embedding` | `intent` |
| `idx_policy_embedding` | `policy` |
| `idx_learning_embedding` | `learning` |
| `idx_objective_embedding` | `objective` |
| `idx_conversation_embedding` | `conversation` (if index exists) |

### Embedding Fields to Remove (Phase 3 Migration)

All `embedding` fields (`option<array<float>>`) removed from:

| Table | Field | Line in schema |
|-------|-------|----------------|
| `conversation` | `embedding` | ~10 |
| `message` | `embedding` | ~22 |
| `project` | `embedding` | ~74 |
| `feature` | `embedding` | ~94 |
| `task` | `embedding` | ~124 |
| `decision` | `embedding` | ~155 |
| `question` | `embedding` | ~183 |
| `agent_session` | `description_embedding` | ~221 |
| `observation` | `embedding` | ~266 |
| `suggestion` | `embedding` | ~291 |
| `person` | `embedding` | ~305 |
| `agent` | `description_embedding` | ~329 |
| `document_chunk` | `embedding` | ~366 |
| `git_commit` | `embedding` | ~381 |
| `intent` | `embedding` | ~620 |
| `policy` | `embedding` | ~674 |
| `learning` | `embedding` | ~1253 |
| `objective` | `embedding` | ~1286 |

### Migration Scripts

#### Migration 0062: Add Missing BM25 Indexes (Phase 1)

```sql
-- No DEFINE ANALYZER needed -- entity_search already exists from migration 0002

BEGIN TRANSACTION;

DEFINE INDEX OVERWRITE idx_learning_text_fulltext ON learning FIELDS text FULLTEXT ANALYZER entity_search BM25(1.2, 0.75);
DEFINE INDEX OVERWRITE idx_policy_description_fulltext ON policy FIELDS description FULLTEXT ANALYZER entity_search BM25(1.2, 0.75);

COMMIT TRANSACTION;
```

#### Migration 0063: Drop Embedding Infrastructure (Phase 3)

```sql
BEGIN TRANSACTION;

-- Drop all 18 HNSW indexes
REMOVE INDEX IF EXISTS idx_message_embedding ON message;
REMOVE INDEX IF EXISTS idx_project_embedding ON project;
REMOVE INDEX IF EXISTS idx_feature_embedding ON feature;
REMOVE INDEX IF EXISTS idx_task_embedding ON task;
REMOVE INDEX IF EXISTS idx_decision_embedding ON decision;
REMOVE INDEX IF EXISTS idx_question_embedding ON question;
REMOVE INDEX IF EXISTS idx_agent_session_description_embedding ON agent_session;
REMOVE INDEX IF EXISTS idx_observation_embedding ON observation;
REMOVE INDEX IF EXISTS idx_suggestion_embedding ON suggestion;
REMOVE INDEX IF EXISTS idx_person_embedding ON person;
REMOVE INDEX IF EXISTS idx_agent_description_embedding ON agent;
REMOVE INDEX IF EXISTS idx_document_chunk_embedding ON document_chunk;
REMOVE INDEX IF EXISTS idx_git_commit_embedding ON git_commit;
REMOVE INDEX IF EXISTS idx_intent_embedding ON intent;
REMOVE INDEX IF EXISTS idx_policy_embedding ON policy;
REMOVE INDEX IF EXISTS idx_learning_embedding ON learning;
REMOVE INDEX IF EXISTS idx_objective_embedding ON objective;

-- Remove embedding fields from all tables
REMOVE FIELD IF EXISTS embedding ON conversation;
REMOVE FIELD IF EXISTS embedding ON message;
REMOVE FIELD IF EXISTS embedding ON project;
REMOVE FIELD IF EXISTS embedding ON feature;
REMOVE FIELD IF EXISTS embedding ON task;
REMOVE FIELD IF EXISTS embedding ON decision;
REMOVE FIELD IF EXISTS embedding ON question;
REMOVE FIELD IF EXISTS description_embedding ON agent_session;
REMOVE FIELD IF EXISTS embedding ON observation;
REMOVE FIELD IF EXISTS embedding ON suggestion;
REMOVE FIELD IF EXISTS embedding ON person;
REMOVE FIELD IF EXISTS description_embedding ON agent;
REMOVE FIELD IF EXISTS embedding ON document_chunk;
REMOVE FIELD IF EXISTS embedding ON git_commit;
REMOVE FIELD IF EXISTS embedding ON intent;
REMOVE FIELD IF EXISTS embedding ON policy;
REMOVE FIELD IF EXISTS embedding ON learning;
REMOVE FIELD IF EXISTS embedding ON objective;

-- Clean embedding data from existing records
UPDATE conversation UNSET embedding;
UPDATE message UNSET embedding;
UPDATE project UNSET embedding;
UPDATE feature UNSET embedding;
UPDATE task UNSET embedding;
UPDATE decision UNSET embedding;
UPDATE question UNSET embedding;
UPDATE agent_session UNSET description_embedding;
UPDATE observation UNSET embedding;
UPDATE suggestion UNSET embedding;
UPDATE person UNSET embedding;
UPDATE agent UNSET description_embedding;
UPDATE document_chunk UNSET embedding;
UPDATE git_commit UNSET embedding;
UPDATE intent UNSET embedding;
UPDATE policy UNSET embedding;
UPDATE learning UNSET embedding;
UPDATE objective UNSET embedding;

COMMIT TRANSACTION;
```

### Graph Edges Used for Alignment (Existing, No Changes)

| Edge Table | Direction | Type |
|-----------|-----------|------|
| `has_objective` | `project\|workspace -> objective` | Relation |
| `belongs_to` | `task\|feature\|decision\|question -> project` | Relation |
| `has_task` | `feature -> task` | Relation |
| `supports` | `intent -> objective` | Relation (written by alignment) |

### Storage Impact

Removing embedding data reduces storage significantly:
- Each embedding: 1536 floats * 4 bytes = ~6KB per entity
- 18 HNSW indexes consume additional storage for graph structure
- Estimated savings: proportional to entity count * 6KB + index overhead
- Write performance improves: no HNSW index update on every entity create/update
