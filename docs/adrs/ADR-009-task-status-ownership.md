# ADR-009: Task Status Transition Ownership Model

## Status

Proposed

## Context

Task status transitions are duplicated between the server (orchestrator) and agents/processors:

- `createAgentSession()` sets `in_progress` when a session is created for a task, but the agent also sets `in_progress` via `brain-start-task` -> `update_task_status`. The server transition is optimistic and fires even if the agent never starts work.
- `acceptOrchestratorSession()` sets `done` when a session is accepted, but this conflates review approval with code completion. A task can have committed code (done) before session review.

This creates orphaned states on agent crashes (task stuck in `in_progress` with no active session) and semantic confusion (what does "done" mean -- code committed or session reviewed?).

Quality attribute drivers: **reliability** (accurate status), **maintainability** (single ownership per transition), **operational simplicity** (no manual status cleanup).

## Decision

Forward transitions are owned by the entity doing the work. Backward transitions are owned by the server (orchestrator).

| Transition | Owner | Trigger |
|---|---|---|
| -> in_progress | Agent | `brain-start-task` calls `update_task_status` |
| -> done | commit-check (local) / GitHub processor (remote) | Commit with task refs |
| -> completed | GitHub processor | Merge to default branch |
| -> ready (abort) | Server | Session aborted |
| -> ready (reject) | Server | Session rejected |

Transitions are idempotent and forward-only: setting `done` on an already-`done` or `completed` task is a no-op.

## Alternatives Considered

### Alternative 1: Keep server-owned forward transitions, add deduplication

- **What**: Keep `in_progress` in `createAgentSession()` and `done` in `acceptOrchestratorSession()`, add idempotency guards so agent/processor transitions are no-ops when server already set the status.
- **Expected Impact**: Solves duplication conflicts (~60% of problem).
- **Why Insufficient**: Does not fix semantic confusion. `done` still means "session accepted" rather than "code committed." Orphaned `in_progress` on agent crash still possible because server sets it before agent starts.

### Alternative 2: Event sourcing for status transitions

- **What**: Record all transition events with source attribution; derive current status from event log.
- **Expected Impact**: Full audit trail (~100% of problem).
- **Why Insufficient**: Massive complexity increase for a simple ownership problem. Team size and system maturity do not justify event sourcing infrastructure. Violates simplest-solution-first principle.

### Alternative 3: Server as sole authority with agent status reports

- **What**: Only the server sets status. Agents report progress events; server decides transitions.
- **Expected Impact**: Single authority (~80% of problem).
- **Why Insufficient**: Adds indirection. The commit-check hook would need to report "commit happened" and wait for server to decide status. Increases latency and coupling for no gain -- the mapping from "commit with task ref" to "done" is deterministic.

## Consequences

### Positive

- Each transition has exactly one authoritative source -- no duplication
- `done` semantically means "code committed," `completed` means "merged to main"
- Agent crash does not orphan tasks (server never set `in_progress`)
- Solo developers get immediate feedback via post-commit hook
- Teams get dual coverage (local hook + GitHub webhook)

### Negative

- `in_progress` depends on agent calling `update_task_status` -- if agent skips `brain-start-task`, task stays in previous status
- `done` depends on task refs in commit messages -- commits without `task:id` do not trigger status change
- Small window where commit-check and GitHub processor may both attempt `done` (resolved by idempotency)
