-- Migration 0032: Objective table, has_objective relation, supports relation, observes OUT extension
-- Step 01-01 of the objective-behavior feature

BEGIN TRANSACTION;

-- Objective: strategic goal node
DEFINE TABLE objective SCHEMAFULL;

DEFINE FIELD title ON objective TYPE string;
DEFINE FIELD description ON objective TYPE option<string>;
DEFINE FIELD target_date ON objective TYPE option<string>;
DEFINE FIELD priority ON objective TYPE string
  ASSERT $value IN ["low", "medium", "high", "critical"];
DEFINE FIELD status ON objective TYPE string
  ASSERT $value IN ["draft", "active", "completed", "archived", "expired"];

-- Success criteria (array of KPI objects)
DEFINE FIELD success_criteria ON objective TYPE option<array<object>>;
DEFINE FIELD success_criteria[*].metric_name ON objective TYPE string;
DEFINE FIELD success_criteria[*].target_value ON objective TYPE float;
DEFINE FIELD success_criteria[*].current_value ON objective TYPE float;
DEFINE FIELD success_criteria[*].unit ON objective TYPE string;

-- Provenance
DEFINE FIELD workspace ON objective TYPE record<workspace>;
DEFINE FIELD source_message ON objective TYPE option<record<message>>;
DEFINE FIELD created_by ON objective TYPE option<record<identity>>;
DEFINE FIELD created_at ON objective TYPE datetime;
DEFINE FIELD updated_at ON objective TYPE option<datetime>;

-- Embedding for semantic matching
DEFINE FIELD embedding ON objective TYPE option<array<float>>;

-- Indexes
DEFINE INDEX objective_workspace_status ON objective FIELDS workspace, status;
DEFINE INDEX objective_target_date ON objective FIELDS target_date;
DEFINE INDEX idx_objective_embedding ON objective FIELDS embedding HNSW DIMENSION 1536 DIST COSINE;

-- has_objective: links project or workspace to its objectives
DEFINE TABLE has_objective TYPE RELATION IN project | workspace OUT objective SCHEMAFULL;
DEFINE FIELD added_at ON has_objective TYPE datetime;

-- supports: links an intent to the strategic objective it serves
DEFINE TABLE supports TYPE RELATION IN intent OUT objective SCHEMAFULL;
DEFINE FIELD alignment_score ON supports TYPE float
  ASSERT $value >= 0.0 AND $value <= 1.0;
DEFINE FIELD alignment_method ON supports TYPE string
  ASSERT $value IN ["embedding", "manual", "rule"];
DEFINE FIELD reasoning ON supports TYPE option<string>;
DEFINE FIELD added_at ON supports TYPE option<datetime>;
DEFINE INDEX supports_out ON supports FIELDS out;

-- Extend observes OUT to include objective
ALTER TABLE observes TYPE RELATION IN observation OUT project | feature | task | decision | question | intent | git_commit | observation | objective;

COMMIT TRANSACTION;
