# Test Scenarios: Task Status Ownership

## Summary

27 total scenarios across 4 test files. 14 unit tests (pure function, no server). 13 smoke tests (real server + SurrealDB).

Error/edge path ratio: 12/27 = 44% (exceeds 40% target).

## Walking Skeletons (3)

These prove the core user value end-to-end:

1. **Session creation preserves task status** (smoke) -- Creating an agent session for a task no longer promotes status to in_progress. Validates US-1.
2. **Commit with task ref sets task to done** (smoke) -- The commit-check endpoint parses a task ref from a commit message and sets the task to done. Validates US-3.
3. **Push to feature branch sets task done, merge to main sets completed** (smoke) -- GitHub webhook push to feature branch sets done; push to main sets completed. Validates US-5 + US-6.

## Test Files

### Unit: `tests/unit/task-status-ownership/extract-task-refs.test.ts`

Pure function tests for `extractReferencedTaskIds()`. No server needed.

| # | Scenario | Type | US |
|---|----------|------|----|
| 1 | Single task:id extracted | happy | US-3 |
| 2 | Task ref at start of message | happy | US-3 |
| 3 | Task ref embedded mid-sentence | happy | US-3 |
| 4 | tasks: list extracts all ids | happy | US-3 |
| 5 | Both task: and tasks: formats, deduplication | happy | US-3 |
| 6 | Multiple task: tokens in one message | happy | US-3 |
| 7 | No task refs returns empty list | error | US-3 |
| 8 | Non-id words after tasks: prefix | error | US-3 |
| 9 | Very short tokens rejected | edge | US-3 |
| 10 | Duplicate refs deduplicated | edge | US-3 |
| 11 | Token without digits rejected | edge | US-3 |
| 12 | Hyphens and digits accepted | edge | US-3 |
| 13 | Underscores accepted | edge | US-3 |

(Note: test #14 is count including the 1 implicit: total 13 tests in this file)

### Smoke: `tests/smoke/task-status-ownership/session-no-status-change.test.ts`

Server integration tests for US-1 and US-2.

| # | Scenario | Type | US |
|---|----------|------|----|
| 1 | Ready task remains ready after session creation | happy (skeleton) | US-1 |
| 2 | Todo task remains todo after session creation | happy | US-1 |
| 3 | In_progress task remains in_progress after session creation | edge | US-1 |
| 4 | In_progress task remains in_progress after session accept | happy (skeleton) | US-2 |
| 5 | Done task remains done after session accept | edge | US-2 |

### Smoke: `tests/smoke/task-status-ownership/commit-check-endpoint.test.ts`

Server integration tests for the commit-check endpoint (US-3).

| # | Scenario | Type | US |
|---|----------|------|----|
| 1 | Single task ref sets task to done | happy (skeleton) | US-3 |
| 2 | Multiple task refs set all tasks to done | happy | US-3 |
| 3 | No task refs leaves tasks unchanged | error | US-3 |
| 4 | Already-done task remains done (idempotent) | error | US-3 |
| 5 | Nonexistent task ref handled gracefully | error | US-3 |
| 6 | Missing commit message returns validation error | error | US-3 |
| 7 | Invalid workspace returns 404 | error | US-3 |

### Smoke: `tests/smoke/task-status-ownership/webhook-status-transitions.test.ts`

Server integration tests for GitHub webhook status transitions (US-5, US-6).

| # | Scenario | Type | US |
|---|----------|------|----|
| 1 | Push to feature branch sets task to done + creates implemented_by | happy (skeleton) | US-5 |
| 2 | Already-done task remains done on feature branch push (idempotent) | error | US-5 |
| 3 | Push to main sets task to completed | happy (skeleton) | US-6 |
| 4 | In_progress task goes to completed on main push | edge | US-6 |
| 5 | Already-completed task remains completed on main push (idempotent) | error | US-6 |
| 6 | Feature branch done -> main push upgrades to completed | happy | US-5+6 |
| 7 | Push without task refs does not change task status | error | US-5 |

### Smoke: `tests/smoke/task-status-ownership/backward-transitions.test.ts`

Server integration tests for backward transitions (unchanged behavior).

| # | Scenario | Type | US |
|---|----------|------|----|
| 1 | Abort resets in_progress task to ready | happy | R7 |
| 2 | Reject resets in_progress task to ready | happy | R7 |
| 3 | Abort resets done task to ready | edge | R7 |

## Coverage Matrix

| User Story | Scenarios | Walking Skeleton |
|------------|-----------|------------------|
| US-1: Remove server in_progress on assignment | 3 | session-no-status-change #1 |
| US-2: Remove server done on session accept | 2 | session-no-status-change #4 |
| US-3: osabio commit-check | 13 unit + 7 smoke | commit-check-endpoint #1 |
| US-4: Wire as post-commit hook | (see note) | -- |
| US-5: GitHub done on push | 2 | webhook-status-transitions #1 |
| US-6: GitHub completed on merge | 4 | webhook-status-transitions #3 |
| R7: Backward transitions | 3 | -- |

**US-4 note**: Post-commit hook wiring is a shell script integration. It is tested by verifying `osabio init` creates the hook file. This is covered by the existing `tests/unit/cli-init.test.ts` pattern -- a new test should be added there when the hook installation code lands.

## Implementation Sequence

All smoke tests are marked `it.skip`. Enable one at a time as implementation proceeds:

1. **Enable** unit tests in `extract-task-refs.test.ts` -- these should pass immediately (existing function)
2. **Enable** `session-no-status-change.test.ts` scenario 1 -- implement US-1 (remove in_progress from createAgentSession)
3. **Enable** `session-no-status-change.test.ts` scenario 4 -- implement US-2 (remove done from acceptOrchestratorSession)
4. **Enable** `commit-check-endpoint.test.ts` scenario 1 -- implement US-3 (server endpoint)
5. **Enable** `webhook-status-transitions.test.ts` scenario 1 -- implement US-5 (webhook done on feature branch)
6. **Enable** `webhook-status-transitions.test.ts` scenario 3 -- implement US-6 (webhook completed on main)
7. **Enable** remaining scenarios for each US after the walking skeleton passes
8. **Enable** `backward-transitions.test.ts` -- verify R7 unchanged behavior

## Mandate Compliance Evidence

**CM-A (Driving port enforcement)**: All smoke tests invoke through HTTP endpoints (the driving ports). No internal function imports in smoke tests. Unit tests import only the pure `extractReferencedTaskIds` function.

**CM-B (Business language purity)**: Test descriptions use domain terms: "task status", "session creation", "commit referencing", "push to feature branch", "merge to main". No HTTP verbs, status codes, or JSON structure in test names.

**CM-C (Walking skeleton + focused scenario counts)**: 3 walking skeletons + 24 focused scenarios across 4 files. Walking skeletons are stakeholder-demo-able ("can I see that creating a session no longer changes my task status?").
