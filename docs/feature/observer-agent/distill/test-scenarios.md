# Observer Agent: Test Scenario Traceability

Maps user stories to acceptance test scenarios with implementation sequence.

## Story Coverage Matrix

| Story | ID | Scenario | File | Status |
|-------|----|----------|------|--------|
| **Story 1: Task Completion Verification** | S1-WS1 | Task completed -> observation created with verdict | walking-skeleton.test.ts | `it()` |
| | S1-1 | Task with passing CI -> verified observation | milestone-2 | `it.skip()` |
| | S1-2 | Task with failing CI -> conflict observation | milestone-2 | `it.skip()` |
| | S1-3 | Task with no signals -> inconclusive | milestone-2 | `it.skip()` |
| **Story 2: Intent Verification** | S2-1 | Completed intent -> verification observation | milestone-2 | `it.skip()` |
| | S2-2 | Failed intent -> failure observation | milestone-2 | `it.skip()` |
| **Story 2b: Commit Verification** | S2b-1 | New commit -> status verification | milestone-2 | `it.skip()` |
| **Story 3: Graceful Degradation** | S3-WS2 | External unavailable -> graceful degradation | walking-skeleton.test.ts | `it()` |
| | S3-1 | API failure -> warning, task not blocked | milestone-2 | `it.skip()` |
| | S3-2 | EVENT RETRY handles transient failures | milestone-2 | `it.skip()` |
| **Story 4: Schema Extensions** | S4-1 | verified field defaults to false | milestone-1 | `it.skip()` |
| | S4-2 | source field persists | milestone-1 | `it.skip()` |
| | S4-3 | data field stores evidence | milestone-1 | `it.skip()` |
| | S4-4 | observation_type accepts validation/error | milestone-1 | `it.skip()` |
| | S4-5 | observes edge accepts intent/commit/observation | milestone-1 | `it.skip()` |
| **Story 5: Observer Agent Core** | S5-1 | Agent returns structured output | milestone-3 | `it.skip()` |
| | S5-2 | Agent uses workspace context | milestone-3 | `it.skip()` |
| **Story 6: EVENT Definitions** | S6-1 | task completed fires event | milestone-1 | `it.skip()` |
| | S6-2 | task in_progress does NOT fire | milestone-1 | `it.skip()` |
| | S6-3 | intent completed fires event | milestone-1 | `it.skip()` |
| | S6-4 | commit created fires event | milestone-1 | `it.skip()` |
| | S6-5 | decision confirmed fires event | milestone-1 | `it.skip()` |
| | S6-6 | non-observer observation fires peer review | milestone-1 | `it.skip()` |
| | S6-7 | observer observation does NOT fire (no loop) | milestone-1 | `it.skip()` |
| **Story 7: Periodic Graph Scan** | S7-1 | Detects decision-implementation contradiction | milestone-3 | `it.skip()` |
| | S7-2 | Detects stale blocked task | milestone-3 | `it.skip()` |
| | S7-3 | Deduplicates existing observations | milestone-3 | `it.skip()` |
| | S7-4 | Detects status drift | milestone-3 | `it.skip()` |
| **Story 9: Decision Verification** | S9-1 | Confirmed -> implementations checked | milestone-4 | `it.skip()` |
| | S9-2 | Superseded -> stale implementations flagged | milestone-4 | `it.skip()` |
| **Story 10: Cross-Agent Peer Review** | S10-1 | PM observation -> observer cross-checks | milestone-4 | `it.skip()` |
| | S10-2 | Architect observation -> observer peer-reviews | milestone-4 | `it.skip()` |
| | S10-3 | Observer own -> no recursive review | milestone-4 | `it.skip()` |
| | S10-4 | No cascading reviews | milestone-4 | `it.skip()` |

## Error Path Ratio

- Total scenarios: 32
- Error/edge/degradation scenarios: 14 (S1-2, S1-3, S2-2, S3-1, S3-2, S3-WS2, S6-2, S6-7, S7-3, S9-2, S10-3, S10-4, S7-4, S5-2)
- Error path ratio: **43.75%** (target >= 40%)

## Implementation Sequence

1. Walking skeleton tests (2 scenarios) -- prove E2E pipeline works
2. Milestone 1: Schema + EVENTs (12 scenarios) -- foundation for all other tests
3. Milestone 2: Verification pipeline (8 scenarios) -- core claim-vs-reality logic
4. Milestone 3: Agent + scan (6 scenarios) -- Observer Agent and periodic scan
5. Milestone 4: Peer review (6 scenarios) -- cross-agent coordination

## Driving Ports

All tests invoke through these entry points only:

| Port | Type | Used By |
|------|------|---------|
| `POST /api/observe/:table/:id` | HTTP (EVENT target) | Walking skeleton, M1-M4 |
| `POST /api/observe/scan/:workspaceId` | HTTP (scan trigger) | M3 |
| SurrealDB direct (schema validation) | DB | M1 schema tests |
| SurrealDB EVENTs (async triggers) | DB EVENT | M1-M4 |

No internal components are imported or tested directly.
