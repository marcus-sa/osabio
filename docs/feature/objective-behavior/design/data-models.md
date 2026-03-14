# Data Models: Objective & Behavior Nodes

## New Tables

### `objective` (SCHEMAFULL)

Strategic goal node. Created by humans via chat extraction or direct creation.

```sql
DEFINE TABLE objective SCHEMAFULL;

-- Core fields
DEFINE FIELD title ON objective TYPE string;
DEFINE FIELD description ON objective TYPE option<string>;
DEFINE FIELD target_date ON objective TYPE option<datetime>;
DEFINE FIELD priority ON objective TYPE int
  ASSERT $value >= 0 AND $value <= 100;
DEFINE FIELD status ON objective TYPE string
  ASSERT $value IN ["active", "expired", "completed", "archived"];

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
```

**Design rationale:**
- `success_criteria` as array of objects matches the KPI model from user stories. Each KPI has metric_name, target_value, current_value, unit -- sufficient for progress tracking without a separate KPI table
- `priority` as 0-100 int matches the intent priority range for consistency
- `status` enum covers the full lifecycle: active -> expired (target_date passed) | completed (human confirmed) | archived (retired)
- No `null` values per project convention -- omitted optional fields use `option<T>` which defaults to `NONE`

### `behavior` (SCHEMAFULL)

Agent craftsmanship metric record. Append-only -- one per agent session per metric type.

```sql
DEFINE TABLE behavior SCHEMAFULL;

-- Core fields
DEFINE FIELD metric_type ON behavior TYPE string
  ASSERT $value IN [
    "tdd_adherence",
    "security_first",
    "conciseness",
    "review_responsiveness",
    "documentation_quality"
  ];
DEFINE FIELD score ON behavior TYPE float
  ASSERT $value >= 0.0 AND $value <= 1.0;

-- Telemetry source data (metric-specific, flexible schema)
DEFINE FIELD source_telemetry ON behavior TYPE object FLEXIBLE;

-- Context
DEFINE FIELD workspace ON behavior TYPE record<workspace>;
DEFINE FIELD session ON behavior TYPE record<agent_session>;
DEFINE FIELD created_at ON behavior TYPE datetime;

-- Indexes
DEFINE INDEX behavior_workspace_metric ON behavior FIELDS workspace, metric_type;
DEFINE INDEX behavior_session ON behavior FIELDS session;
DEFINE INDEX behavior_created_at ON behavior FIELDS created_at;
```

**Design rationale:**
- `metric_type` as string enum is extensible via schema migration (add to ASSERT list). No code changes needed to add new metric types beyond the scorer function
- `source_telemetry` as `object FLEXIBLE` allows metric-specific data shapes (TDD: files_changed, test_files_changed; Security: cve_advisories, addressed_count) without requiring DEFINE FIELD for every sub-field
- `session` links to agent_session for provenance (which agent, which workspace, which project)
- No `identity` field on behavior itself -- the identity is resolved via `exhibits` edge or via `session -> agent_session.workspace + identity lookup`
- Append-only enforced at application layer (no UPDATE queries for behavior records)

### Metric Type Extensibility

Adding a new behavior metric:
1. Add value to `metric_type` ASSERT list in schema migration
2. Add scorer function in `behavior/scorer.ts` (pure function mapping telemetry to 0-1 score)
3. Add telemetry extraction logic in Observer behavior collector

No policy schema changes needed -- existing `RulePredicate` with `field: "behavior_scores.<new_metric>"` works immediately.

---

## New Relations

### `supports` (TYPE RELATION IN intent OUT objective)

Links an intent to the strategic objective it serves. Created by alignment evaluator during intent authorization.

```sql
DEFINE TABLE supports TYPE RELATION IN intent OUT objective SCHEMAFULL;
DEFINE FIELD alignment_score ON supports TYPE float
  ASSERT $value >= 0.0 AND $value <= 1.0;
DEFINE FIELD alignment_method ON supports TYPE string
  ASSERT $value IN ["automatic", "manual"];
DEFINE FIELD created_at ON supports TYPE datetime;
DEFINE INDEX supports_out ON supports FIELDS out;
```

**Design rationale:**
- `alignment_score` records the cosine similarity at time of linking (audit trail)
- `alignment_method` distinguishes automatic (Authorizer) from manual (human via feed card) links
- Index on `out` (objective) for efficient "all intents supporting this objective" queries
- Immutable once created (no UPDATE) -- if reassigned, a new edge is created and old one stays for history

### `exhibits` (TYPE RELATION IN identity OUT behavior)

Links an agent identity to a behavior record.

```sql
DEFINE TABLE exhibits TYPE RELATION IN identity OUT behavior SCHEMAFULL;
DEFINE FIELD created_at ON exhibits TYPE datetime;
```

**Design rationale:**
- Simple edge with timestamp. All rich data lives on the `behavior` node itself
- IN is `identity` (not agent_session) because behavior trends are tracked per-agent-identity across sessions
- Query pattern: `SELECT ->exhibits->behavior FROM identity:x WHERE metric_type = "tdd_adherence" ORDER BY created_at DESC LIMIT 5`

---

### `has_objective` (TYPE RELATION IN project | workspace OUT objective)

Links a project or workspace to its objectives. Follows the existing `has_project` (workspace->project) and `has_feature` (project->feature) pattern.

```sql
DEFINE TABLE has_objective TYPE RELATION IN project | workspace OUT objective SCHEMAFULL;
DEFINE FIELD added_at ON has_objective TYPE datetime;
```

**Design rationale:**
- Objectives are top-level strategic containers (intents support them), not sub-entities. They don't "belong to" something -- they are targets that other work serves
- `has_project` and `has_feature` establish the precedent: container `has` child via dedicated relation
- IN includes both `project` and `workspace` because some objectives are project-specific while others span the entire workspace
- The `objective.workspace` field provides workspace scoping for queries; `has_objective` provides the optional project linkage for graph traversal

---

## Extended Relations

### `observes` extension

The existing `observes` relation needs OUT type extended to include `objective` and `behavior`:

```sql
-- Current: IN observation OUT project | feature | task | decision | question | intent | git_commit | observation
-- Extended: add objective | behavior to OUT union
```

This allows coherence audit observations to link to the objective or behavior they concern.

### `learning_evidence` extension

The existing `learning_evidence` relation needs OUT type extended to include `behavior`:

```sql
-- Current: IN learning OUT message | trace | observation | agent_session
-- Extended: add behavior to OUT union
```

This allows behavior-driven learnings to reference the triggering behavior records as evidence.

---

## Key Query Patterns

### Latest behavior score per identity + metric

```sql
-- Used by policy gate to enrich IntentEvaluationContext
SELECT score, created_at FROM behavior
WHERE session IN (
  SELECT VALUE id FROM agent_session
  WHERE workspace = $ws
  AND ->member_of->identity CONTAINS $identity
)
AND metric_type = $metric
ORDER BY created_at DESC
LIMIT 1;
```

Alternative (via exhibits edge):
```sql
SELECT <-exhibits<-identity, score, created_at FROM behavior
WHERE workspace = $ws
AND metric_type = $metric
AND id IN (SELECT VALUE out FROM exhibits WHERE `in` = $identity)
ORDER BY created_at DESC
LIMIT 1;
```

### Objective alignment (KNN)

```sql
-- Two-step KNN pattern per SurrealDB HNSW+WHERE bug
LET $candidates = SELECT id, title, embedding,
  vector::similarity::cosine(embedding, $intent_embedding) AS similarity
FROM objective WHERE embedding <|10, COSINE|> $intent_embedding;

SELECT id, title, similarity FROM $candidates
WHERE workspace = $ws AND status = "active"
ORDER BY similarity DESC
LIMIT 5;
```

### Coherence: orphaned decisions

```sql
SELECT id, summary, created_at FROM decision
WHERE workspace = $ws
AND status = "confirmed"
AND created_at < $threshold_date
AND array::len(<-implemented_by<-git_commit) = 0
AND array::len(<-implemented_by<-pull_request) = 0
ORDER BY created_at ASC
LIMIT 50;
```

### Coherence: stale objectives

```sql
SELECT id, title, created_at FROM objective
WHERE workspace = $ws
AND status = "active"
AND created_at < $threshold_date
AND array::len(<-supports<-intent) = 0
ORDER BY created_at ASC
LIMIT 50;
```

### Behavior trend (last N sessions)

```sql
SELECT score, created_at FROM behavior
WHERE workspace = $ws
AND metric_type = $metric
AND id IN (SELECT VALUE out FROM exhibits WHERE `in` = $identity)
ORDER BY created_at DESC
LIMIT $n;
```

---

## Migration Plan

Three migrations, applied sequentially via `bun migrate`:

| Migration | Contents |
|-----------|----------|
| `0032_objective_table.surql` | `objective` table, `supports` relation, `has_objective` relation, extend `observes` OUT |
| `0033_behavior_table.surql` | `behavior` table, `exhibits` relation, extend `learning_evidence` OUT |
| `0034_objective_fulltext.surql` | Fulltext search index for objective title (BM25, reuses existing `entity_search` analyzer) |

Each migration wrapped in `BEGIN TRANSACTION; ... COMMIT TRANSACTION;` per project convention.
