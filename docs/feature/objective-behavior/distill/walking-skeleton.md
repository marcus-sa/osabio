# Walking Skeleton: Objective & Behavior Nodes

Implementation order using the one-at-a-time strategy. Each skeleton proves a user can accomplish a goal through the driving port. Enable one, implement until green, commit, repeat.

---

## Implementation Sequence

### Phase 1: Graph Layer Foundation

**Skeleton 1: Leader creates a strategic objective** (US-OB-01)
- File: `objective-crud.test.ts`
- Proves: Objective node created with all fields, workspace-scoped, persisted
- Driving port: SurrealDB (later: POST /api/workspaces/:workspaceId/objectives)
- Enable first. All subsequent skeletons depend on objective nodes existing.

**Skeleton 3: Observer records agent behavior** (US-OB-03)
- File: `behavior-telemetry.test.ts`
- Proves: Behavior record created with metric_type, score, source_telemetry; exhibits edge links identity to behavior
- Driving port: SurrealDB (later: Observer Agent session evaluation)
- Independent of Skeleton 1. Can be implemented in parallel.

### Phase 2: Alignment and Policy

**Skeleton 2: Intent aligned with active objective** (US-OB-02)
- File: `intent-alignment.test.ts`
- Proves: Supports edge created between intent and objective with alignment score
- Driving port: Intent authorization pipeline (simulated via DB + supports edge creation)
- Depends on: Skeleton 1 (objectives must exist)

**Skeleton 4: Behavior policy vetoes deploy intent** (US-OB-04)
- File: `behavior-policy.test.ts`
- Proves: Policy queries behavior score, score below threshold vetoes intent
- Driving port: Policy evaluation (simulated via DB queries + intent status update)
- Depends on: Skeleton 3 (behavior records must exist)

### Phase 3: Visibility and Auditing

**Skeleton 5: Objective progress from supporting intents** (US-OB-05)
- File: `objective-progress.test.ts`
- Proves: Supporting intent count computed, success criteria tracked
- Driving port: GET /api/workspaces/:workspaceId/objectives/:id
- Depends on: Skeleton 1 + Skeleton 2 (objectives and supports edges)

**Skeleton 6: Coherence auditor detects disconnected patterns** (US-OB-06)
- File: `coherence-auditor.test.ts`
- Proves: Orphaned decisions and stale objectives are detectable via graph queries
- Driving port: POST /api/observe/scan/:workspaceId
- Depends on: Skeleton 1 (objectives for stale detection)

### Phase 4: Learning Loop

**Skeleton 7: Observer proposes learning from behavior pattern** (US-OB-07)
- File: `behavior-learning.test.ts`
- Proves: 3+ consecutive below-threshold sessions produce detectable drift; learning proposal has correct metadata
- Driving port: Observer graph scan + POST /api/workspaces/:workspaceId/learnings
- Depends on: Skeleton 3 (behavior records for trend analysis)

---

## Skip Strategy

All focused scenarios within each test file are marked `it.skip` except the walking skeleton. After the skeleton passes:

1. Enable next focused scenario in the same file
2. Implement production code to make it pass
3. Commit
4. Repeat until all scenarios in the file are green
5. Move to the next skeleton in sequence

### Current Skip Status

| File | Active | Skipped | Total |
|------|--------|---------|-------|
| objective-crud.test.ts | 5 | 2 | 7 |
| intent-alignment.test.ts | 3 | 4 | 7 |
| behavior-telemetry.test.ts | 7 | 1 | 8 |
| behavior-policy.test.ts | 4 | 3 | 7 |
| objective-progress.test.ts | 4 | 1 | 5 |
| coherence-auditor.test.ts | 5 | 2 | 7 |
| behavior-learning.test.ts | 6 | 1 | 7 |
| **Total** | **34** | **14** | **48** |

Skipped scenarios require either:
- Embedding generation pipeline integration (semantic similarity checks)
- Full HTTP endpoint implementation (feed cards, SSE events)
- Performance benchmarking infrastructure (@property tests)
- Multi-agent orchestration (human override flows)

---

## Dependency Graph

```
Skeleton 1 (Objective CRUD)
  |
  +-- Skeleton 2 (Intent Alignment)
  |     |
  |     +-- Skeleton 5 (Progress Visibility)
  |
  +-- Skeleton 6 (Coherence Auditor)

Skeleton 3 (Behavior Telemetry)
  |
  +-- Skeleton 4 (Behavior Policy)
  |
  +-- Skeleton 7 (Behavior Learning Loop)
```

Skeletons 1 and 3 are independent starting points. The software crafter can begin both in parallel.

---

## Mandate Compliance Evidence

### CM-A: Driving Port Usage
All test files import from `objective-behavior-test-kit.ts` which delegates to:
- `acceptance-test-kit.ts` (server boot, DB isolation, auth)
- Direct SurrealDB queries (graph verification)
- HTTP endpoints via `fetch` (when API endpoints exist)

Zero internal component imports in test files.

### CM-B: Business Language Purity
Test scenarios use domain terms exclusively:
- "objective", "behavior score", "supports edge", "alignment"
- "policy threshold", "coherence auditor", "behavioral drift"
- Zero references to: HTTP status codes, JSON payloads, database tables, API paths in Gherkin comments

### CM-C: Walking Skeleton + Focused Scenario Counts
- Walking skeletons: 7 (one per user story)
- Focused scenarios: 41 (happy path + error + boundary)
- Error/boundary ratio: 45% (exceeds 40% minimum)
