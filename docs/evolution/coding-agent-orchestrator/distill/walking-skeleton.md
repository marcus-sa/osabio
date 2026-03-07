# Walking Skeleton Test Plan -- Coding Agent Orchestrator

## Purpose

The walking skeleton proves that a user can accomplish their core goal:
**assign a coding task to an agent, monitor its progress, and accept the result**.

This is the minimum viable E2E path through the orchestrator. It touches all
architectural layers (route handler, assignment guard, session lifecycle,
worktree manager, database) as a consequence of the user journey, not as a
design goal.

## Skeleton Scenarios

### Skeleton 1: Assign, Monitor, Accept

**User goal**: "I want to hand off a coding task to an agent, see that it is
working, and merge the result when it is done."

```
Given a user with a workspace containing a task ready for work
When the user assigns the task to a coding agent
Then an agent session is created with a stream for monitoring
And the task status changes to "in_progress"

When the user checks the agent's progress
Then the session shows as active

When the user accepts the completed agent work
Then the task is marked as done
And the agent session is completed
```

**Stakeholder demo**: Yes -- shows the complete happy path from assignment
through completion.

**File**: `tests/acceptance/coding-agent-orchestrator/walking-skeleton.test.ts`
(first `it` block)

### Skeleton 2: Assign and Abort

**User goal**: "I assigned a task but the agent is going in the wrong direction.
I want to cancel it and get my task back."

```
Given a user with a task assigned to an agent
When the user aborts the agent session
Then the task returns to ready status
And the agent session is marked as aborted
```

**Stakeholder demo**: Yes -- shows the safety valve for unwanted agent work.

**File**: `tests/acceptance/coding-agent-orchestrator/walking-skeleton.test.ts`
(second `it` block)

## Implementation Sequence

1. Enable Skeleton 1 (the only non-skipped test)
2. Implement `POST /api/orchestrator/:ws/assign` route
3. Implement Assignment Guard (task status + one-agent check)
4. Implement Worktree Manager (create)
5. Implement Session Lifecycle (create, with mocked OpenCode)
6. Implement `GET /api/orchestrator/:ws/sessions/:id` route
7. Implement `POST /api/orchestrator/:ws/sessions/:id/accept` route
8. Skeleton 1 passes -- enable Skeleton 2
9. Implement `POST /api/orchestrator/:ws/sessions/:id/abort` route
10. Skeleton 2 passes -- begin focused scenarios

## Litmus Test Results

| Criterion | Skeleton 1 | Skeleton 2 |
|-----------|-----------|-----------|
| Title describes user goal? | Yes: "assigns a ready task, checks progress, accepts result" | Yes: "assigns then aborts, returning task to ready" |
| Given/When use user actions? | Yes: "assigns", "checks progress", "accepts" | Yes: "assigns", "aborts" |
| Then use user observations? | Yes: "session created", "task marked as done" | Yes: "task returns to ready" |
| Stakeholder confirms value? | Yes | Yes |

## What is NOT in the Skeleton

- SSE event streaming (deferred to event-bridge tests)
- Stall detection (deferred to stall-detection tests)
- Reject-with-feedback loop (deferred to review-flow tests)
- Plugin tool execution (deferred to plugin-tools tests)
- Multiple concurrent agents (deferred to assignment-guard tests)
- UI interactions (API-level only)
