# Component Boundaries: Objective & Behavior Nodes

## Module Decomposition

All new modules follow the existing project convention: pure query/logic functions at the module level, IO at boundaries only. Functional paradigm -- composition pipelines, types-first, pure core / effect shell.

### New Modules

```
app/src/server/
  objective/
    queries.ts          -- SurrealDB CRUD for objective table (create, update, list, get)
    alignment.ts        -- Pure: cosine similarity evaluation, alignment result classification
    objective-route.ts  -- HTTP routes for objective CRUD + progress view
  behavior/
    queries.ts          -- SurrealDB CRUD for behavior + exhibits edge
    scorer.ts           -- Pure: metric-specific score normalization functions
    trends.ts           -- Pure: trend computation from behavior record arrays
    behavior-route.ts   -- HTTP routes for behavior scores + trends
```

### Extended Modules (existing files, new functions)

```
app/src/server/
  intent/
    authorizer.ts       -- Add alignment evaluation step after policy gate
  policy/
    types.ts            -- Extend IntentEvaluationContext with behavior_scores
  observer/
    graph-scan.ts       -- Add behavior telemetry scan + coherence audit scan types
    learning-diagnosis.ts -- Add behavior trend input signal alongside observation clusters
  extraction/
    schema.ts           -- Add "objective" to extraction entity type enum
```

---

## Dependency Direction

```
                    ┌─────────────────────────┐
                    │   HTTP Routes (shell)    │
                    │ objective-route.ts       │
                    │ behavior-route.ts        │
                    └────────┬────────────────┘
                             │ depends on
                    ┌────────▼────────────────┐
                    │   Domain Logic (pure)    │
                    │ alignment.ts             │
                    │ scorer.ts                │
                    │ trends.ts                │
                    └────────┬────────────────┘
                             │ depends on
                    ┌────────▼────────────────┐
                    │   Data Access (effect)   │
                    │ objective/queries.ts     │
                    │ behavior/queries.ts      │
                    └────────┬────────────────┘
                             │ depends on
                    ┌────────▼────────────────┐
                    │   SurrealDB (infra)      │
                    └─────────────────────────┘
```

Dependencies point inward. Pure domain logic has no IO imports. Route handlers compose pure functions with data access at the boundary.

---

## Integration Contracts

### Authorizer -> Alignment Evaluator
- Input: intent goal embedding (number[]), workspace record
- Output: `AlignmentResult = { matched: boolean; objectiveId?: RecordId; score: number; ambiguous: boolean }`
- Contract: returns within 200ms. Pure cosine similarity + KNN query

### Policy Gate -> Behavior Query
- Input: identity record, workspace record, metric_types (string[])
- Output: `Record<string, number>` (metric_type -> latest score)
- Contract: enriches `IntentEvaluationContext.behavior_scores` before rule evaluation

### Observer -> Behavior Collector
- Input: agent_session record with files_changed, telemetry
- Output: behavior records written to DB, exhibits edges created
- Contract: fire-and-forget, failure does not propagate

### Observer -> Coherence Scanner
- Input: workspace record
- Output: observations created for disconnected patterns
- Contract: extends existing `GraphScanResult` type with coherence counts

### Observer -> Behavior Learning Bridge
- Input: behavior trend data (identity, metric_type, recent scores)
- Output: learning proposals via existing `suggestLearning()` function
- Contract: uses existing learning API, collision detection, dual-gate safety

---

## Boundary Rules

1. **objective/** and **behavior/** modules do NOT import from each other. They are independent subsystems connected only through the Observer (which reads both) and the Authorizer (which reads objectives and behavior scores independently)

2. **Pure modules** (alignment.ts, scorer.ts, trends.ts) have ZERO imports from `surrealdb`, `ai`, or any IO library. They receive data, return data

3. **Query modules** (queries.ts) accept `Surreal` and `RecordId` parameters. They do NOT import route-level types or HTTP types

4. **Route modules** compose queries + pure logic. They are the only modules that import from `../http/` utilities

5. **Observer extensions** follow existing graph-scan.ts pattern: pure query functions + pipeline composition. New scan types are added as functions called from the existing `runGraphScan` orchestrator
