# Requirements: Task Status Ownership

## Problem Statement

Task status transitions are duplicated between the server (orchestrator) and agents/processors. The server optimistically sets in_progress on assignment and done on session accept, but these are redundant with the agent's osabio-start-task command and the GitHub commit processor. This creates confusion about who owns the truth and causes orphaned states on agent crashes.

## Design Principle

**Forward transitions are agent/processor-owned. Backward transitions are server-owned.**

The entity doing the work owns progress signals. The orchestrator owns recovery.

| Transition | Owner | Trigger |
|---|---|---|
| → in_progress | Agent | osabio-start-task command |
| → done | commit-check hook (local) / GitHub processor (remote) | git commit with task refs |
| → completed | GitHub processor | merge to main |
| → ready (abort) | Server | Session aborted |
| → ready (reject) | Server | Session rejected |

## Requirements

### R1: Remove server-side forward transitions

Remove the in_progress transition from `createAgentSession()` in `mcp-queries.ts`. The server should still link `source_session` to the task but not change status.

Remove the done transition from `acceptOrchestratorSession()` in `session-lifecycle.ts`. Session accept is a review gate, not a completion event.

### R2: Agent owns in_progress

`osabio-start-task` already instructs the agent to call `update_task_status` → in_progress. This becomes the sole authority. No changes needed here.

### R3: Add `osabio commit-check` CLI command

New CLI command that:
1. Reads the most recent commit message (or accepts a commit SHA)
2. **Fast path**: parses task refs using existing `extractReferencedTaskIds()` from `commit-task-refs.ts`
3. **LLM fallback**: if no explicit refs found, uses the same LLM analysis as the GitHub commit processor to infer which task(s) the commit relates to
4. Calls the Osabio API to set each referenced/inferred task's status → done
5. Idempotent — setting done on an already-done task is a no-op

### R4: Wire commit-check as git post-commit hook

Install `osabio commit-check` as a git post-commit hook, similar to how Osabio already manages pre-commit hooks. The hook calls the Osabio HTTP API.

### R5: GitHub commit processor sets done on push

Extend `github-commit-processor.ts` to set task status → done (in addition to creating `implemented_by` relations) when commits are pushed to non-main branches.

### R6: GitHub commit processor sets completed on merge to main

When commits land on the main/default branch (via merge), set referenced tasks → completed. This is the "verified/merged" signal for teams.

### R7: Keep server-owned backward transitions

Abort and reject continue to reset task status on the server side:
- Abort → ready
- Reject → ready

No changes needed here.

## Setup-Dependent Behavior

| Setup | in_progress | done | completed |
|---|---|---|---|
| Solo/local | Agent (osabio-start-task) | commit-check post-commit hook | N/A or manual |
| Team/remote | Agent (osabio-start-task) | commit-check + GitHub processor | GitHub processor (merge to main) |

## Constraints

- **commit-check must not block git**: The post-commit hook must never fail the git workflow. API errors are logged but exit 0. This is a fire-and-forget signal.
- **Idempotent transitions**: Setting done on an already-done task, or completed on an already-completed task, is a no-op. Both commit-check and GitHub processor may fire for the same commit — that's fine.
- **Task ref convention required**: Completion detection depends on `task:<id>` or `tasks: <id1>, <id2>` in commit messages. No task refs = no status change. This is by design — not every commit maps to a task.

## Non-Requirements

- No migration of existing task statuses. Schema & data migration policy: breaking changes, no backfills.
- No new task status values. Existing statuses (open, todo, ready, in_progress, blocked, done, completed) are sufficient.
