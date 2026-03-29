# US-AL-005: Learning Entity Schema

## Problem
Osabio's knowledge graph has entities for decisions, observations, suggestions, tasks, features, and questions -- but no entity for persistent behavioral rules. When Tomas Eriksson corrects an agent, the correction lives only in conversation history. There is no structured entity to store, query, version, or inject behavioral learnings into agent prompts.

## Who
- System (schema layer) | Database infrastructure | Needs a SCHEMAFULL table to persist learning records with lifecycle, provenance, and vector search

## Job Story Trace
- **Job 1, 2, 3, 4** (all jobs) -- this is the foundational schema enabling all learning flows.

## Solution
Create a `learning` SCHEMAFULL table following existing entity patterns (observation, suggestion) with fields for text, type, status, source, target_agents, workspace, embedding, provenance, and lifecycle timestamps. Include relation tables for evidence and supersession edges.

## Domain Examples

### 1: Happy Path -- Human-created constraint
Tomas creates a learning via the chat interface. The system creates a record:
- text: "Never use null for domain data values. Represent absence with omitted optional fields."
- learning_type: "constraint"
- status: "active"
- source: "human"
- target_agents: ["code_agent", "chat_agent"]
- workspace: workspace:brain-dev
- created_by: identity:tomas-eriksson
- created_at: 2026-03-13T10:30:00Z
- embedding: [0.12, -0.34, ...] (1536 dimensions)
- priority: "medium"

### 2: Edge Case -- Agent-suggested learning with evidence
Observer creates a suggestion:
- text: "When creating SurrealDB queries with KNN and WHERE, split into two steps."
- learning_type: "constraint"
- status: "pending_approval"
- source: "agent"
- suggested_by: "observer"
- confidence: 0.89
- target_agents: ["code_agent"]
- evidence_refs: [agent_session:a1b2, agent_session:c3d4, agent_session:e5f6]

### 3: Error/Boundary -- Superseded learning
Old learning "Use snake_case for DB fields" is superseded by new learning "Use camelCase for all SurrealDB field names":
- Old record: status changes to "superseded", superseded_by set to new learning ID
- New record: status "active", supersedes set to old learning ID
- Supersession chain preserved for history

## UAT Scenarios (BDD)

### Scenario: Learning table created with all required fields
Given the migration script is applied
When checking INFO FOR TABLE learning
Then the table is SCHEMAFULL
And contains fields: text (string), learning_type (string), status (string), source (string), target_agents (array of string), workspace (record of workspace), created_at (datetime), updated_at (option datetime), embedding (option array of float)

### Scenario: Human-created learning record persisted
Given Tomas creates a learning with text "Never use null" and type "constraint"
When the record is created in SurrealDB
Then the record has status "active" and source "human"
And created_by references Tomas's identity
And an embedding is generated and stored

### Scenario: Agent-suggested learning with evidence refs
Given the Observer creates a learning suggestion
When the record is created with source "agent" and suggested_by "observer"
Then status is "pending_approval"
And evidence_refs contains 3 agent_session record IDs
And confidence is stored as a float between 0 and 1

### Scenario: Status transition from pending_approval to active
Given a learning with status "pending_approval" exists
When Tomas approves it
Then status changes to "active"
And approved_by references Tomas's identity
And approved_at is set to current timestamp

### Scenario: Supersession preserves history
Given active learning A "Use snake_case" exists
When learning B "Use camelCase" supersedes it
Then learning A status changes to "superseded"
And learning A has superseded_by referencing learning B
And learning B has supersedes referencing learning A
And learning B status is "active"

## Acceptance Criteria
- [ ] `learning` table is SCHEMAFULL with all fields defined and type-constrained
- [ ] `learning_type` asserted IN ["constraint", "instruction", "precedent"]
- [ ] `status` asserted IN ["active", "pending_approval", "dismissed", "superseded", "deactivated"]
- [ ] `source` asserted IN ["human", "agent"]
- [ ] `target_agents` is array of strings, each asserted IN ["code_agent", "chat_agent", "pm_agent", "architect", "observer", "design_partner"]
- [ ] Embedding field supports HNSW index for vector search (duplicate/conflict detection)
- [ ] Workspace, status, and created_at indexes defined for query performance
- [ ] Supersession fields (superseded_by, supersedes) support learning evolution
- [ ] Migration script is versioned and transactional

## Technical Notes
- Schema follows existing patterns: observation table (text, status, workspace, embedding, source_agent, created_at) and suggestion table (text, status, workspace, embedding, confidence, suggested_by)
- HNSW index on embedding field using DIMENSION 1536 DIST COSINE (same as observation, suggestion)
- Workspace index for feed queries: `DEFINE INDEX learning_workspace_status ON learning FIELDS workspace, status`
- Migration file: `schema/migrations/NNNN_add_learning_table.surql` (next available prefix)
- No data migration needed -- new table, no existing data
- Relation tables: `learning_evidence` TYPE RELATION for evidence edges, `supersedes` TYPE RELATION for supersession
- `learning_evidence` must support polymorphic OUT targets: `message | trace | observation | agent_session` — these are the four data sources that can serve as evidence for a learning suggestion
- `evidence_refs` field on learning table is `array<record<message | trace | observation | agent_session>>` for direct record linking (in addition to the relation edges for graph traversal)

## Dependencies
- No dependencies -- this is the foundation other stories depend on
- Enables: US-AL-001, US-AL-002, US-AL-003, US-AL-004
