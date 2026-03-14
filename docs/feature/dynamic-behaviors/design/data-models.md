# Data Models: Dynamic Behavior Definitions

## New Table: `behavior_definition`

```sql
DEFINE TABLE behavior_definition SCHEMAFULL;

-- Core fields
DEFINE FIELD title ON behavior_definition TYPE string;
DEFINE FIELD goal ON behavior_definition TYPE string;
DEFINE FIELD scoring_logic ON behavior_definition TYPE string;
DEFINE FIELD scoring_mode ON behavior_definition TYPE string
  ASSERT $value IN ["llm", "deterministic"];
DEFINE FIELD telemetry_types ON behavior_definition TYPE array<string>;
DEFINE FIELD category ON behavior_definition TYPE option<string>;

-- Lifecycle
DEFINE FIELD status ON behavior_definition TYPE string
  ASSERT $value IN ["draft", "active", "archived"];
DEFINE FIELD version ON behavior_definition TYPE int
  ASSERT $value > 0;

-- Enforcement
DEFINE FIELD enforcement_mode ON behavior_definition TYPE string
  ASSERT $value IN ["warn_only", "automatic"]
  DEFAULT "warn_only";
DEFINE FIELD enforcement_threshold ON behavior_definition TYPE option<float>
  ASSERT $value = NONE OR ($value >= 0.0 AND $value <= 1.0);

-- Ownership
DEFINE FIELD workspace ON behavior_definition TYPE record<workspace>;
DEFINE FIELD created_by ON behavior_definition TYPE option<record<identity>>;

-- Timestamps
DEFINE FIELD created_at ON behavior_definition TYPE datetime;
DEFINE FIELD updated_at ON behavior_definition TYPE option<datetime>;

-- Indexes
DEFINE INDEX idx_behaviordef_workspace ON behavior_definition FIELDS workspace;
DEFINE INDEX idx_behaviordef_ws_status ON behavior_definition FIELDS workspace, status;
```

## Modified Table: `behavior`

The existing `metric_type` ASSERT enum is removed. `metric_type` becomes a free string that matches the `title` of a `behavior_definition`. A new `definition` field provides a direct reference.

```sql
-- Remove the ASSERT enum constraint
DEFINE FIELD OVERWRITE metric_type ON behavior TYPE string;

-- Reference to the definition that produced this score (REQUIRED)
DEFINE FIELD definition ON behavior TYPE record<behavior_definition>;

-- Definition version for audit trail (which version of the definition was used)
DEFINE FIELD definition_version ON behavior TYPE int ASSERT $value > 0;
```

### Why `definition` is required

Every behavior record is a measurement against a specific standard. Without a definition, a behavior has no enforcement weight and no audit trail. Emergent anomalies that don't fit any definition belong as `observation` records — the Observer can then propose new definitions from patterns of similar observations.

Deterministic scorers (TDD_Adherence, Security_First) get seed `behavior_definition` records, so their behavior records also reference a definition.

## New Edge: `defines` (optional, future use)

Not required for the walking skeleton. If needed later for graph traversal from workspace to definitions:

```sql
DEFINE TABLE defines TYPE RELATION IN workspace OUT behavior_definition SCHEMAFULL;
DEFINE FIELD created_at ON defines TYPE option<datetime>;
```

For now, workspace scoping is achieved via the `workspace` field on `behavior_definition` (same pattern as `learning`, `observation`, etc.).

## Existing Tables: No Changes Required

### `exhibits` edge
Already defined as `IN identity OUT behavior`. No changes needed -- new behavior records use the same edge.

### `policy` table
No schema changes. Policy rules already reference `behavior_scores.*` via string field names. The predicate evaluator resolves arbitrary dot-paths at runtime.

### `learning` table
No schema changes. Learning proposals reference behavior records via the existing `learning_evidence` relation (`IN learning OUT ... | behavior`).

### `learning_evidence` edge
Already includes `behavior` in its OUT union. No changes needed.

## Migration Script: `0037_behavior_definition.surql`

The migration creates the new table and removes the enum ASSERT from the existing behavior table.

```sql
BEGIN TRANSACTION;

-- 1. Create behavior_definition table
DEFINE TABLE behavior_definition SCHEMAFULL;
DEFINE FIELD title ON behavior_definition TYPE string;
DEFINE FIELD goal ON behavior_definition TYPE string;
DEFINE FIELD scoring_logic ON behavior_definition TYPE string;
DEFINE FIELD scoring_mode ON behavior_definition TYPE string
  ASSERT $value IN ["llm", "deterministic"];
DEFINE FIELD telemetry_types ON behavior_definition TYPE array<string>;
DEFINE FIELD category ON behavior_definition TYPE option<string>;
DEFINE FIELD status ON behavior_definition TYPE string
  ASSERT $value IN ["draft", "active", "archived"];
DEFINE FIELD version ON behavior_definition TYPE int ASSERT $value > 0;
DEFINE FIELD enforcement_mode ON behavior_definition TYPE string
  ASSERT $value IN ["warn_only", "automatic"]
  DEFAULT "warn_only";
DEFINE FIELD enforcement_threshold ON behavior_definition TYPE option<float>
  ASSERT $value = NONE OR ($value >= 0.0 AND $value <= 1.0);
DEFINE FIELD workspace ON behavior_definition TYPE record<workspace>;
DEFINE FIELD created_by ON behavior_definition TYPE option<record<identity>>;
DEFINE FIELD created_at ON behavior_definition TYPE datetime;
DEFINE FIELD updated_at ON behavior_definition TYPE option<datetime>;
DEFINE INDEX idx_behaviordef_workspace ON behavior_definition FIELDS workspace;
DEFINE INDEX idx_behaviordef_ws_status ON behavior_definition FIELDS workspace, status;

-- 2. Remove enum ASSERT from behavior.metric_type (allow any string)
DEFINE FIELD OVERWRITE metric_type ON behavior TYPE string;

-- 3. Add definition reference fields to behavior table (REQUIRED — no legacy compat)
DEFINE FIELD definition ON behavior TYPE record<behavior_definition>;
DEFINE FIELD definition_version ON behavior TYPE int ASSERT $value > 0;

COMMIT TRANSACTION;
```

## TypeScript Type Definitions

These types live in `app/src/server/behavior/definition-types.ts`:

### BehaviorDefinitionRecord (DB row shape)
```
- id: RecordId<"behavior_definition">
- title: string
- goal: string
- scoring_logic: string
- scoring_mode: "llm" | "deterministic"
- telemetry_types: string[]
- category?: string
- status: "draft" | "active" | "archived"
- version: number
- enforcement_mode: "warn_only" | "automatic"
- enforcement_threshold?: number
- workspace: RecordId<"workspace">
- created_by?: RecordId<"identity">
- created_at: string
- updated_at?: string
```

### CreateBehaviorDefinitionInput (API input shape)
```
- title: string
- goal: string
- scoring_logic: string
- scoring_mode: "llm" | "deterministic"
- telemetry_types: string[]
- category?: string
```

### UpdateBehaviorDefinitionInput (API input shape)
```
- goal?: string
- scoring_logic?: string
- telemetry_types?: string[]
- category?: string
- status?: "draft" | "active" | "archived"
- enforcement_mode?: "warn_only" | "automatic"
- enforcement_threshold?: number
```

### LlmScorerResult (structured output from LLM)
```
- score: number (0.0 - 1.0)
- rationale: string
- evidence_checked: string[]
```

## Extended BehaviorRow (existing type, extended)

Add required fields to existing `BehaviorRow`:
```
- definition: RecordId<"behavior_definition">
- definition_version: number
```

## Entity Relationships

```
workspace --[workspace field]--> behavior_definition
behavior_definition --[definition field]<-- behavior
identity --[exhibits]--> behavior
behavior --[learning_evidence]<-- learning
```

## Indexing Strategy

| Table | Index | Fields | Purpose |
|-------|-------|--------|---------|
| behavior_definition | idx_behaviordef_workspace | workspace | List definitions by workspace |
| behavior_definition | idx_behaviordef_ws_status | workspace, status | Filter active definitions per workspace |
| behavior (existing) | behavior_workspace_metric | workspace, metric_type | Query scores by workspace + metric (works with dynamic types) |
| behavior (existing) | behavior_created_at | created_at | Time-ordered queries for trends |

## Data Integrity Rules

1. **Append-only behaviors** -- behavior records are never updated or deleted
2. **Definition required** -- every behavior record references a `behavior_definition`; emergent anomalies without a standard belong as `observation` records
3. **Version increment** -- editing an active definition increments version by 1; editing draft does not
4. **Status transitions** -- draft->active, active->archived, draft->archived only
5. **Workspace scoping** -- definitions and behaviors filtered by workspace in all queries
6. **No null** -- absent values use optional fields (`field?: Type` in TS, `option<type>` in SurrealQL)
