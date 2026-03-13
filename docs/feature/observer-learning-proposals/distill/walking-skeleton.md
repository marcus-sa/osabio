# Observer Learning Proposals — Walking Skeleton Strategy

## Skeleton Selection Criteria

Each skeleton answers: "Can the observer accomplish this goal and produce an observable outcome?"

### WS-1: Observer diagnoses a recurring pattern and proposes a learning

**User goal**: When the observer detects a recurring problem pattern, it should diagnose the root cause and suggest a behavioral rule for human review.

**Why this is first**: This is the core E2E value proposition. It touches every component in the pipeline: observation clustering, root cause classification (LLM), learning proposer, and `suggestLearning()` with evidence edges. If this works, the feature delivers value.

**Observable outcome**: A learning record with `status=pending_approval` appears in the workspace, traceable back to the source observations via evidence edges.

### WS-2: Observer skips proposal when active learning covers pattern

**User goal**: The system should not suggest the same thing twice. If a learning already covers a pattern, the observer should recognize that and skip.

**Why this is second**: The coverage check is the primary dedup gate. Without it, the observer would spam learning proposals for patterns that are already addressed. This validates the KNN similarity check against active learnings.

**Observable outcome**: No new learning record is created. The active learning remains unchanged.

### WS-3: Pipeline completes gracefully on ambiguous patterns

**User goal**: The diagnostic pipeline should never crash or block the graph scan, even when it encounters patterns it cannot confidently classify.

**Why this is third**: Resilience. The observer runs on a periodic scan and in response to events. If the diagnostic step crashes, it takes down the entire scan. This validates the confidence gate and error handling.

**Observable outcome**: The graph scan response returns successfully with a parseable result.

## Implementation Order

```
WS-1 (propose learning)  -- enables: M3-1, M3-2, M3-3
  |
WS-2 (coverage skip)     -- enables: M1-5, M1-6
  |
WS-3 (graceful pipeline) -- enables: M2-2, M2-3, M2-4
  |
M1 scenarios (clustering) -- enables: M1-1 through M1-4
  |
M2 scenarios (classification) -- enables: M2-1
  |
M3 scenarios (proposer + scan) -- enables: M3-4, M3-5
  |
M4 scenarios (event escalation) -- enables: M4-1 through M4-5
```

## Driving Ports

All tests invoke through these entry points only:

| Port | Method | Purpose |
|------|--------|---------|
| `POST /api/observe/scan/:workspaceId` | HTTP | Triggers periodic graph scan (batch path) |
| `POST /api/observe/:table/:id` | SurrealQL EVENT | Triggers event-driven observer (real-time path) |
| SurrealDB direct queries | DB | Seed preconditions and verify outcomes |

No internal functions are imported or called directly in acceptance tests.

## Mandate Compliance

- **CM-A (Hexagonal)**: All tests invoke through HTTP endpoints or SurrealDB events. No imports from `observer/learning-diagnosis.ts` or `learning/detector.ts`.
- **CM-B (Business Language)**: Test descriptions and helper names use business terms: "diagnoses", "proposes", "covers pattern", "rate-limited". Zero HTTP verbs or status codes in test names.
- **CM-C (Walking Skeleton + Focused)**: 3 walking skeletons + 20 focused milestone scenarios = 23 total. Ratio: 13% skeleton, 87% focused.
