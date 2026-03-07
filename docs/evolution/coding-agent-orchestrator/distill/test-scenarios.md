# Test Scenario Inventory -- Coding Agent Orchestrator

## Summary

| Metric | Count |
|--------|-------|
| Total scenarios | 38 |
| Walking skeletons | 2 |
| Focused happy path | 15 |
| Focused error path | 17 |
| Focused edge case | 4 |
| Error path ratio | 44.7% |
| Property-shaped | 1 |

## Traceability Matrix

| User Story | Scenarios | File |
|-----------|-----------|------|
| US-0.1 Assign Task | 11 | walking-skeleton, assignment-guard |
| US-0.2 Agent Reads Context | 3 | plugin-tools |
| US-0.3 Agent Updates Status | 5 | plugin-tools |
| US-1.1 Stream Events | 4 | event-bridge |
| US-1.2 Stall Detection | 5 | stall-detection |
| US-2.1 Review Output | 4 | worktree-management, review-flow |
| US-2.2 Accept Output | 4 | walking-skeleton, review-flow |
| US-2.3 Reject with Feedback | 3 | review-flow |
| Cross-cutting (lifecycle) | 5 | plugin-lifecycle |

## Scenario Inventory

### walking-skeleton.test.ts (2 scenarios)

| # | Type | Scenario | Story | Status |
|---|------|----------|-------|--------|
| WS-1 | skeleton | User assigns ready task, checks progress, accepts result | US-0.1, US-2.2 | enabled |
| WS-2 | skeleton | User assigns task then aborts, returning task to ready | US-0.1 | enabled |

### assignment-guard.test.ts (8 scenarios)

| # | Type | Scenario | Story | Status |
|---|------|----------|-------|--------|
| AG-1 | happy | Accepts assignment for task with status "ready" | US-0.1 | enabled |
| AG-2 | happy | Accepts assignment for task with status "todo" | US-0.1 | skip |
| AG-3 | error | Rejects assignment for task already in progress | US-0.1 | skip |
| AG-4 | error | Rejects assignment for completed task | US-0.1 | skip |
| AG-5 | error | Rejects assignment for nonexistent task | US-0.1 | skip |
| AG-6 | error | Rejects second assignment while first agent still working | US-0.1 | skip |
| AG-7 | happy | Allows reassignment after previous session aborted | US-0.1 | skip |
| AG-8 | happy | Allows reassignment after previous session accepted | US-0.1 | skip |
| AG-9 | error | Rejects assignment without task identifier | US-0.1 | skip |
| AG-10 | error | Rejects assignment to workspace user does not belong to | US-0.1 | skip |

### worktree-management.test.ts (7 scenarios)

| # | Type | Scenario | Story | Status |
|---|------|----------|-------|--------|
| WT-1 | happy | Creates dedicated worktree branch on assignment | US-0.1 | skip |
| WT-2 | happy | Creates separate worktrees for different tasks | US-0.1 | skip |
| WT-3 | happy | Review shows files changed and diff statistics | US-2.1 | skip |
| WT-4 | happy | Review includes session activity summary | US-2.1 | skip |
| WT-5 | happy | Merges agent branch when work is accepted | US-2.2 | skip |
| WT-6 | happy | Removes agent branch when session is aborted | US-0.1 | skip |
| WT-7 | error | Review not available for aborted session | US-2.1 | skip |

### plugin-tools.test.ts (8 scenarios)

| # | Type | Scenario | Story | Status |
|---|------|----------|-------|--------|
| PT-1 | happy | Agent receives task details when requesting context | US-0.2 | skip |
| PT-2 | happy | Agent receives project overview when requesting context | US-0.2 | skip |
| PT-3 | error | Agent receives error for nonexistent task context | US-0.2 | skip |
| PT-4 | happy | Agent changes task status to blocked with reason | US-0.3 | skip |
| PT-5 | happy | Agent changes task status to done | US-0.3 | skip |
| PT-6 | error | Agent cannot set invalid status value | US-0.3 | skip |
| PT-7 | happy | Agent creates warning observation for risk | US-0.3 | skip |
| PT-8 | happy | Agent creates conflict observation for contradictions | US-0.3 | skip |

### plugin-lifecycle.test.ts (5 scenarios)

| # | Type | Scenario | Story | Status |
|---|------|----------|-------|--------|
| PL-1 | happy | Creates session on plugin session.created hook | US-0.1 | skip |
| PL-2 | error | Rejects session start without agent type | US-0.1 | skip |
| PL-3 | happy | Records summary on plugin session.idle hook | US-0.1 | skip |
| PL-4 | error | Rejects session end for nonexistent session | US-0.1 | skip |
| PL-5 | edge | Duplicate session end is handled gracefully | US-0.1 | skip |

### event-bridge.test.ts (4 scenarios)

| # | Type | Scenario | Story | Status |
|---|------|----------|-------|--------|
| EB-1 | happy | File changes from agent appear in activity stream | US-1.1 | skip |
| EB-2 | happy | Agent status transitions appear in event stream | US-1.1 | skip |
| EB-3 | error | Stream for nonexistent session returns error | US-1.1 | skip |
| EB-4 | error | Agent errors are forwarded to event stream | US-1.1 | skip |

### review-flow.test.ts (7 scenarios)

| # | Type | Scenario | Story | Status |
|---|------|----------|-------|--------|
| RF-1 | happy | Review provides diff summary and session trace | US-2.1 | skip |
| RF-2 | happy | Session status includes branch name | US-2.1 | skip |
| RF-3 | happy | Accepting marks task done and completes session | US-2.2 | skip |
| RF-4 | error | Cannot accept an aborted session | US-2.2 | skip |
| RF-5 | error | Cannot accept a nonexistent session | US-2.2 | skip |
| RF-6 | happy | Rejecting with feedback returns task to in-progress | US-2.3 | skip |
| RF-7 | error | Rejection without feedback text is refused | US-2.3 | skip |
| RF-8 | error | Cannot reject an already-accepted session | US-2.3 | skip |

### stall-detection.test.ts (5 scenarios)

| # | Type | Scenario | Story | Status |
|---|------|----------|-------|--------|
| SD-1 | happy | Agent aborted when no activity within timeout | US-1.2 | skip |
| SD-2 | happy | Observation created explaining stall reason | US-1.2 | skip |
| SD-3 | edge | Active agent not falsely detected as stalled | US-1.2 | skip |
| SD-4 | error | Agent aborted when max step count exceeded | US-1.2 | skip |
| SD-5 | edge/@property | Agent within step limit continues working | US-1.2 | skip |

## Implementation Sequence (One at a Time)

The recommended order for enabling tests during the DELIVER wave:

1. **WS-1** -- Walking skeleton: assign, monitor, accept (core E2E)
2. **WS-2** -- Walking skeleton: assign and abort
3. **AG-1** -- Assignment guard: ready task accepted
4. **AG-2** -- Assignment guard: todo task accepted
5. **AG-3** -- Assignment guard: in-progress rejected
6. **AG-4** -- Assignment guard: done rejected
7. **AG-5** -- Assignment guard: nonexistent rejected
8. **AG-6** -- One-agent-per-task enforcement
9. **AG-7** -- Reassignment after abort
10. **AG-9** -- Missing task ID validation
11. **AG-10** -- Workspace access control
12. **WT-1** -- Worktree creation
13. **WT-2** -- Worktree isolation
14. **PL-1** -- Plugin session start
15. **PL-3** -- Plugin session end
16. **PT-1** -- Task context retrieval
17. **PT-2** -- Project context retrieval
18. **PT-4** -- Task status blocked
19. **PT-5** -- Task status done
20. **WT-3** -- Diff review
21. **WT-4** -- Session summary review
22. **RF-1** -- Full review display
23. **RF-3** -- Accept flow
24. **RF-6** -- Reject with feedback flow
25. **EB-1** -- File change events
26. **EB-2** -- Status change events
27. **SD-1** -- Stall timeout detection
28. **SD-2** -- Stall observation
29. Remaining error/edge scenarios (AG-8, PT-3, PT-6, PT-7, PT-8, PL-2, PL-4, PL-5, EB-3, EB-4, WT-5, WT-6, WT-7, RF-2, RF-4, RF-5, RF-7, RF-8, SD-3, SD-4, SD-5)

## Mandate Compliance Evidence

### CM-A: Hexagonal Boundary Enforcement

All test files invoke through driving ports only:

| File | Driving Ports Used |
|------|--------------------|
| walking-skeleton.test.ts | POST /assign, GET /sessions/:id, POST /accept |
| assignment-guard.test.ts | POST /assign |
| worktree-management.test.ts | POST /assign, GET /sessions/:id/review, POST /accept, POST /abort |
| plugin-tools.test.ts | POST /mcp/:ws/task-context, POST /mcp/:ws/project-context, POST /mcp/:ws/tasks/status, POST /mcp/:ws/observations |
| plugin-lifecycle.test.ts | POST /mcp/:ws/sessions/start, POST /mcp/:ws/sessions/end |
| event-bridge.test.ts | POST /assign, GET /stream/:streamId |
| review-flow.test.ts | GET /sessions/:id/review, POST /accept, POST /reject |
| stall-detection.test.ts | POST /assign, GET /sessions/:id |

Zero internal component imports. All tests use `orchestrator-test-kit.ts` helpers
which delegate to HTTP endpoints (driving ports).

### CM-B: Business Language Purity

Grep for technical terms in test descriptions and GWT comments:

- Zero instances of: database, API, HTTP, REST, JSON, controller, service,
  status code (200, 404, etc. in descriptions), Redis, Kafka, Lambda
- Business terms used: "task", "agent", "workspace", "session", "branch",
  "review", "accept", "reject", "feedback", "observation", "stall"
- Technical assertions (response.status) used only in error path tests to
  verify rejection behavior, not in scenario descriptions

### CM-C: Walking Skeleton + Focused Scenario Counts

- Walking skeletons: 2 (user-centric, stakeholder-demonstrable)
- Focused scenarios: 36 (boundary tests with specific business rules)
- Error path ratio: 44.7% (exceeds 40% minimum)
