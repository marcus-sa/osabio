# Component Boundaries: Dynamic Behavior Definitions

## Module Map

```
app/src/server/behavior/           # Behavior domain (EXTENDED)
  |
  |-- scorer.ts                    # UNCHANGED: deterministic scorers (pure)
  |-- trends.ts                    # UNCHANGED: trend analysis (pure)
  |-- queries.ts                   # EXTENDED: add definition CRUD + workspace-scoped queries
  |-- behavior-route.ts            # EXTENDED: add definition + scoring endpoints
  |-- definition-types.ts          # NEW: type definitions for behavior_definition
  |-- definition-matcher.ts        # NEW: match telemetry to active definitions (pure)
  |-- llm-scorer.ts                # NEW: LLM scoring pipeline (prompt builder + LLM call)
  |-- scorer-dispatcher.ts         # NEW: routes to deterministic or LLM scorer (pure routing)

app/src/server/observer/           # Observer domain (MODIFIED)
  |-- graph-scan.ts                # MODIFIED: include dynamic metric types
  |-- learning-diagnosis.ts        # MODIFIED: enrich learning text with definition context

app/src/server/runtime/            # Runtime (MODIFIED)
  |-- config.ts                    # MODIFIED: add optional SCORER_MODEL env var
  |-- types.ts                     # MODIFIED: add optional scorerModel to ServerDependencies
  |-- dependencies.ts              # MODIFIED: initialize scorer model client

app/src/client/                    # Frontend (NEW files)
  |-- routes/behaviors-page.tsx    # NEW: Behavior Library page
  |-- components/behavior/         # NEW: behavior UI components
```

## Dependency Flow

```
                    behavior-route.ts (driving port / HTTP adapter)
                           |
                           v
                  scorer-dispatcher.ts (orchestrator)
                    /              \
                   v                v
           scorer.ts           llm-scorer.ts
         (deterministic)      (LLM adapter)
                                    |
                                    v
                          AI SDK generateObject
                          (driven port / LLM adapter)

     definition-matcher.ts    queries.ts
        (pure function)     (driven port / DB adapter)
```

### Dependency Rules

- `scorer.ts`, `trends.ts`, `definition-matcher.ts` -- **pure functions, zero IO imports**
- `llm-scorer.ts` -- effect boundary: prompt building is pure, LLM call is the single effect
- `queries.ts` -- driven port adapter: all DB interaction
- `behavior-route.ts` -- driving port adapter: HTTP request/response translation
- `scorer-dispatcher.ts` -- pure routing based on `scoring_mode`, receives scorer functions via parameters (not module-level imports for testability)

## Port Descriptions

### Driving Ports (inbound)

| Port | Adapter | Responsibility |
|------|---------|---------------|
| Behavior Definition CRUD | `behavior-route.ts` | HTTP endpoints for create/read/update/archive definitions |
| Telemetry Scoring | `behavior-route.ts` | HTTP endpoint to submit telemetry for scoring |
| Behavior Library UI | `behaviors-page.tsx` | Web page rendering definitions and scores |

### Driven Ports (outbound)

| Port | Adapter | Responsibility |
|------|---------|---------------|
| Definition Storage | `queries.ts` | CRUD for `behavior_definition` table |
| Score Storage | `queries.ts` | Append-only `behavior` record creation + `exhibits` edge |
| LLM Scoring | `llm-scorer.ts` | AI SDK `generateObject` call to LLM provider |
| Graph Evidence | `queries.ts` | Query graph entities referenced in telemetry claims |

## Data Flow: Scoring Pipeline

```
1. Telemetry arrives (HTTP POST)
2. definition-matcher.ts: pure filter of active definitions by telemetry_type
3. scorer-dispatcher.ts: for each matched definition:
   a. scoring_mode=deterministic -> scorer.ts (existing pure function)
   b. scoring_mode=llm -> llm-scorer.ts:
      i.   Build prompt (pure): definition.goal + definition.scoring_logic + telemetry payload
      ii.  Query graph evidence (IO): entities referenced in telemetry claims
      iii. Call LLM (IO): generateObject with scoring schema
      iv.  Return { score, rationale, evidence_checked }
4. queries.ts: createBehavior() persists score + creates exhibits edge
5. Response returned to caller
```

## Data Flow: Observer Learning Proposal

```
1. Observer graph scan triggers (existing cron/manual)
2. queryWorkspaceBehaviorTrends() returns ALL metric types (no change needed)
3. For actionable trends (drift/flat below threshold):
   a. NEW: Query behavior_definition by metric_type title
   b. Enrich learning proposal text with definition goal
   c. proposeBehaviorLearning() (existing pipeline, rate-limited)
```

## Data Flow: Authorizer Check

```
1. Intent arrives (existing flow)
2. enrichBehaviorScores() queries latest score per metric_type (no change needed)
   - Returns { "TDD_Adherence": 0.82, "Honesty": 0.05, ... }
3. Policy gate evaluates predicates (no change needed)
   - behavior_scores.Honesty resolved via resolveDotPath
   - undefined (no score) => predicate returns false => deny rule skipped
```

## Cross-Cutting Concerns

### Error Handling
- LLM scorer timeout (30s): no score recorded, retry queued, agent not blocked
- Definition not found: no-op, log warning
- Schema validation failure: 400 response with specific error

### Observability
- All operations use existing `logInfo`/`logError` with structured context
- New log domains: `behavior.definition.*`, `behavior.scorer.*`, `behavior.dispatcher.*`

### Background Work Tracking
- LLM scoring runs in background via `deps.inflight.track(scoringPromise)`
- Telemetry submission endpoint returns immediately
- Retry attempts are also tracked via inflight
