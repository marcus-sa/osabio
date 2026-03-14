# Test Scenario Inventory: Dynamic Behavior Definitions

## Summary

| Category | Count |
|----------|-------|
| Walking skeleton | 1 |
| Happy path | 14 |
| Error path | 10 |
| Boundary/Edge | 8 |
| **Total** | **33** |
| Enabled (drives implementation) | 24 |
| Skipped (future implementation) | 9 |
| Error path ratio | 30% (10/33) |
| Error + boundary ratio | 55% (18/33) |

## Story Traceability

### US-DB-001: Behavior Definition CRUD

| # | Scenario | Type | Status | AC |
|---|----------|------|--------|-----|
| 1 | Definition created with title, goal, scoring logic, workspace scope | Happy | Enabled | AC-001.1, AC-001.2 |
| 2 | Multiple definitions coexist in workspace | Happy | Enabled | AC-001.2 |
| 3 | Draft definition activated | Happy | Enabled | AC-001.3 |
| 4 | Active definition archived | Happy | Enabled | AC-001.3 |
| 5 | Draft definition archived directly | Happy | Enabled | AC-001.3 |
| 6 | Active edit increments version to 2 | Happy | Enabled | AC-001.5 |
| 7 | Draft edit does not increment version | Boundary | Enabled | AC-001.5 |
| 8 | Deterministic scorer as behavior definition | Happy | Enabled | AC-001.1 |
| 9 | Definitions filtered by status | Happy | Enabled | AC-001.2 |
| 10 | Creation fails with missing goal | Error | Skipped | AC-001.4 |
| 11 | Creation fails with missing title | Error | Skipped | AC-001.4 |
| 12 | Creation fails with empty telemetry_types | Error | Skipped | AC-001.4 |
| 13 | Archived definition cannot be reactivated | Error | Skipped | AC-001.3 |
| 14 | Active definition cannot return to draft | Error | Skipped | AC-001.3 |
| 15 | Workspace isolation for definitions | Boundary | Enabled | AC-001.2 |
| 16 | Archiving preserves existing behavior records | Boundary | Enabled | AC-001.3 |

**File:** `definition-crud.test.ts`

### US-DB-002: Scorer Agent

| # | Scenario | Type | Status | AC |
|---|----------|------|--------|-----|
| 1 | Behavior record with score, rationale, definition reference | Happy | Enabled | AC-002.3, AC-002.4 |
| 2 | High score for evidence-supported claims | Happy | Enabled | AC-002.3 |
| 3 | Multiple definitions score same telemetry | Happy | Enabled | AC-002.5 |
| 4 | Deterministic scorer coexists with LLM | Happy | Enabled | AC-002.7 |
| 5 | No scoring when no definitions match type | Error | Enabled | AC-002.1 |
| 6 | Draft definitions not matched | Error | Enabled | AC-002.1 |
| 7 | LLM timeout queues for retry | Error | Skipped | AC-002.6 |
| 8 | Scorer failure does not block agent | Error | Skipped | AC-002.6 |
| 9 | Append-only behavior records | Boundary | Enabled | AC-002.4 |
| 10 | Definition version tracked per score | Boundary | Enabled | AC-002.4 |

**File:** `scorer-agent.test.ts`

### US-DB-003: Authorizer Integration

| # | Scenario | Type | Status | AC |
|---|----------|------|--------|-----|
| 1 | Intent denied when Honesty score below threshold | Happy | Enabled | AC-003.2 |
| 2 | Intent allowed when score above threshold | Happy | Enabled | AC-003.2 |
| 3 | Missing score does not deny intent | Happy | Enabled | AC-003.3 |
| 4 | Multiple scores: one fails, intent denied | Error | Enabled | AC-003.2 |
| 5 | Recovery threshold symmetric with restriction | Happy | Enabled | AC-003.4 |
| 6 | New agent with no scores passes gate | Error | Enabled | AC-003.3 |
| 7 | Feed item for restriction event | Boundary | Skipped | AC-003.5 |
| 8 | Feed item for recovery event | Boundary | Skipped | AC-003.5 |

**File:** `authorizer-integration.test.ts`

### US-DB-004: Observer Integration

| # | Scenario | Type | Status | AC |
|---|----------|------|--------|-----|
| 1 | Drift pattern detected for critical Honesty scores | Happy | Enabled | AC-004.1 |
| 2 | Learning proposed with metadata and evidence links | Happy | Enabled | AC-004.2 |
| 3 | Improving scores classified correctly | Happy | Enabled | AC-004.1 |
| 4 | Workspace trends include dynamic metrics | Happy | Enabled | AC-004.1 |
| 5 | Rate limit blocks learning when 5 exist | Error | Enabled | AC-004.3 |
| 6 | Archived definitions excluded from analysis | Error | Enabled | AC-004.4 |
| 7 | Single low score is insufficient data | Boundary | Enabled | AC-004.1 |
| 8 | Flat scores indicate ineffective learning | Boundary | Enabled | AC-004.1 |
| 9 | Drift in Evidence-Based Reasoning | Error | Enabled | AC-004.1 |

**File:** `observer-integration.test.ts`

### Feature 0: Walking Skeleton

| # | Scenario | Type | Status | AC |
|---|----------|------|--------|-----|
| 1 | Reflex circuit: definition -> scoring -> restriction | Walking Skeleton | Enabled | All |

**File:** `walking-skeleton.test.ts`

## Mandate Compliance Evidence

### CM-A: Driving Port Usage
All test files invoke through driving ports only:
- `enrichBehaviorScores` (context enrichment)
- `evaluateRulesAgainstContext` / `collectAndSortRules` / `buildGateResult` (policy gate pipeline)
- `analyzeTrend` (pure trend analysis)
- `queryWorkspaceBehaviorTrends` / `proposeBehaviorLearning` / `checkBehaviorLearningRateLimit` (observer pipeline)
- SurrealDB queries (verification)

Zero internal component imports (no validators, parsers, formatters, or repository internals).

### CM-B: Business Language Purity
Test descriptions and helper function names use domain terms only:
- `setupBehaviorWorkspace`, `createBehaviorDefinition`, `createScoredBehaviorRecord`
- `getBehaviorRecords`, `getLatestBehaviorScore`, `listBehaviorDefinitions`
- No HTTP verbs, status codes, JSON, or infrastructure terms in test names

### CM-C: Walking Skeleton + Focused Scenario Counts
- Walking skeletons: 1 (reflex circuit end-to-end)
- Focused scenarios: 32 (boundary tests covering individual business rules)
- Total: 33 scenarios across 5 test files
