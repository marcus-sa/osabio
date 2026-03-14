# Test Scenarios: Objective & Behavior Nodes

All acceptance test scenarios mapped to user stories. 45 total scenarios across 7 stories. Error/boundary ratio: 42% (19/45).

---

## US-OB-01: Create Strategic Objectives (7 scenarios)

| # | Scenario | Type | File | Status |
|---|----------|------|------|--------|
| 1 | @walking_skeleton Leader creates objective with title, priority, status, workspace scope | Happy | objective-crud.test.ts | Active |
| 2 | Objective stores multiple success criteria as key results | Happy | objective-crud.test.ts | Active |
| 3 | Objectives listed within workspace scope | Happy | objective-crud.test.ts | Active |
| 4 | Objective created without target date remains valid | Edge | objective-crud.test.ts | Active |
| 5 | Objectives in one workspace not visible from another | Boundary | objective-crud.test.ts | Active |
| 6 | Duplicate objective detected by semantic similarity > 0.95 | Error | objective-crud.test.ts | Skip |
| 7 | Objective status transitions follow lifecycle rules | Boundary | objective-crud.test.ts | Skip |

**Error/boundary ratio**: 3/7 = 43%

---

## US-OB-02: Automatic Intent-Objective Alignment (7 scenarios)

| # | Scenario | Type | File | Status |
|---|----------|------|------|--------|
| 1 | @walking_skeleton Supports edge created when intent aligns with objective | Happy | intent-alignment.test.ts | Active |
| 2 | Intent linked to best-matching objective with multiple matches | Happy | intent-alignment.test.ts | Skip |
| 3 | Manually-created supports edge records alignment method as manual | Happy | intent-alignment.test.ts | Active |
| 4 | Warning observation when no objective matches above 0.5 | Error | intent-alignment.test.ts | Skip |
| 5 | Informational feed card when no objectives exist | Error | intent-alignment.test.ts | Skip |
| 6 | Multiple intents can support the same objective | Boundary | intent-alignment.test.ts | Active |
| 7 | @property Alignment evaluation completes within 200ms | Boundary | intent-alignment.test.ts | Skip |

**Error/boundary ratio**: 4/7 = 57%

---

## US-OB-03: Behavioral Telemetry Collection (8 scenarios)

| # | Scenario | Type | File | Status |
|---|----------|------|------|--------|
| 1 | @walking_skeleton Behavior record created with metric, score, exhibits edge | Happy | behavior-telemetry.test.ts | Active |
| 2 | Multiple behavior metrics per agent (Security_First + TDD) | Happy | behavior-telemetry.test.ts | Active |
| 3 | Behavior trend visible across 5 sessions | Happy | behavior-telemetry.test.ts | Active |
| 4 | New sessions create new records (append-only) | Boundary | behavior-telemetry.test.ts | Active |
| 5 | New agent has empty behavior records | Boundary | behavior-telemetry.test.ts | Active |
| 6 | Score at boundary values 0.0 and 1.0 accepted | Boundary | behavior-telemetry.test.ts | Active |
| 7 | Telemetry unavailability does not block agent session | Error | behavior-telemetry.test.ts | Skip |
| 8 | Behavior records are workspace-scoped | Happy | behavior-telemetry.test.ts | Active (in skeleton) |

**Error/boundary ratio**: 4/8 = 50%

---

## US-OB-04: Behavior-Based Policy Enforcement (7 scenarios)

| # | Scenario | Type | File | Status |
|---|----------|------|------|--------|
| 1 | @walking_skeleton Intent vetoed when behavior score below policy threshold | Happy | behavior-policy.test.ts | Active |
| 2 | Intent proceeds when score above threshold | Happy | behavior-policy.test.ts | Active |
| 3 | Testing-mode policy logs without blocking | Edge | behavior-policy.test.ts | Active |
| 4 | Human override of behavior veto | Edge | behavior-policy.test.ts | Skip |
| 5 | Agent with no behavior data not vetoed | Error | behavior-policy.test.ts | Active |
| 6 | High veto rate triggers system observation | Boundary | behavior-policy.test.ts | Skip |
| 7 | Multiple policies evaluated in priority order | Boundary | behavior-policy.test.ts | Skip (implicit) |

**Error/boundary ratio**: 3/7 = 43%

---

## US-OB-05: Objective Progress Visibility (5 scenarios)

| # | Scenario | Type | File | Status |
|---|----------|------|------|--------|
| 1 | @walking_skeleton Objective shows correct supporting intent count | Happy | objective-progress.test.ts | Active |
| 2 | Success criteria track current vs target values | Happy | objective-progress.test.ts | Active |
| 3 | Objective with zero supporting intents identifiable | Edge | objective-progress.test.ts | Active |
| 4 | Expired objective detected by past target date | Boundary | objective-progress.test.ts | Active |
| 5 | Supporting intents counted per objective, not globally | Boundary | objective-progress.test.ts | Skip |

**Error/boundary ratio**: 2/5 = 40%

---

## US-OB-06: Coherence Auditor (6 scenarios)

| # | Scenario | Type | File | Status |
|---|----------|------|------|--------|
| 1 | @walking_skeleton Orphaned decision with no implementing task detectable | Happy | coherence-auditor.test.ts | Active |
| 2 | Stale objective with zero supports edges detectable | Happy | coherence-auditor.test.ts | Active |
| 3 | Connected objective not flagged as stale | Happy | coherence-auditor.test.ts | Active |
| 4 | Info observations excluded from orphan detection | Edge | coherence-auditor.test.ts | Active |
| 5 | Recently created decision not flagged as orphan | Error | coherence-auditor.test.ts | Active |
| 6 | Coherence score computed as connected/total | Boundary | coherence-auditor.test.ts | Skip |

**Error/boundary ratio**: 3/6 = 50%

---

## US-OB-07: Observer Behavior Learning Loop (7 scenarios)

| # | Scenario | Type | File | Status |
|---|----------|------|------|--------|
| 1 | @walking_skeleton 3+ consecutive below-threshold sessions produce drift pattern | Happy | behavior-learning.test.ts | Active |
| 2 | Improving scores after learning injection are detectable | Happy | behavior-learning.test.ts | Active |
| 3 | Learning proposal has correct observer metadata | Happy | behavior-learning.test.ts | Active |
| 4 | Flat scores after learning indicate ineffectiveness | Error | behavior-learning.test.ts | Active |
| 5 | Rate limit prevents excessive proposals (5/agent/7 days) | Boundary | behavior-learning.test.ts | Active |
| 6 | Single session does not trigger learning (requires 3+) | Boundary | behavior-learning.test.ts | Active |
| 7 | Learning blocked by policy collision | Error | behavior-learning.test.ts | Skip |

**Error/boundary ratio**: 4/7 = 57%

---

## Summary

| Metric | Value |
|--------|-------|
| Total scenarios | 47 |
| Walking skeletons | 7 |
| Happy path | 20 |
| Edge case | 6 |
| Error/boundary | 21 |
| Error/boundary ratio | 45% |
| Active (implemented) | 35 |
| Skipped (awaiting production code) | 12 |
| Stories covered | 7/7 |
| @property tagged | 2 |
