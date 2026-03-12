# Observer Agent: Walking Skeletons

## Purpose

Walking skeletons prove the thinnest possible E2E path through the observer verification system. They answer: "Can the observer verify that reality matches claims, and degrade gracefully when it cannot?"

## Skeleton 1: Task Completion Triggers Observer Verification

**User goal**: When a task is marked as completed, the system independently verifies that the work was actually done and records its finding.

**Path**:
1. A workspace exists with a task linked to a source commit
2. The task status is updated to "completed"
3. The SurrealDB `task_completed` EVENT fires asynchronously
4. The EVENT POSTs the task record to `POST /api/observe/task/:id`
5. The Observer Agent processes the task, gathers available signals
6. The Observer creates an observation linked to the task via `observes` edge
7. The observation contains verification metadata (severity, source_agent, text)

**What it proves**:
- The SurrealDB EVENT mechanism correctly detects task completion transitions
- The EVENT-to-HTTP callback pipeline works end-to-end
- The Observer Agent processes the event and produces a structured observation
- The observation is linked back to the triggering entity in the graph
- The observation is queryable by workspace

**Stakeholder demo**: "When an agent marks a task as done, the Observer independently checks and records whether the work was actually completed. Here is the verification observation it created."

## Skeleton 2: Graceful Degradation When Signals Are Unavailable

**User goal**: When external verification signals (CI status, GitHub API) are unavailable, the Observer still creates a useful observation without blocking the workflow.

**Path**:
1. A workspace exists with a task that has no linked PR, no CI integration
2. The task status is updated to "completed"
3. The SurrealDB `task_completed` EVENT fires asynchronously
4. The Observer Agent processes the task, finds no external signals to verify
5. The Observer creates an informational observation noting the inconclusive result
6. The original task status remains "completed" (not reverted)

**What it proves**:
- The Observer never blocks or reverts the original workflow
- Missing external signals produce graceful informational observations (not errors)
- The system fails open, not closed
- The verification pipeline handles the "no signals" edge case without crashing

**Stakeholder demo**: "Even when we cannot verify externally, the Observer records what it found. The task stays completed -- the Observer informs, it does not gatekeep."

## Walking Skeleton Litmus Test

Both skeletons pass the litmus test:

| Criterion | Skeleton 1 | Skeleton 2 |
|-----------|-----------|-----------|
| Title describes user goal | Yes: "observer creates verification observation when task is completed" | Yes: "observer creates inconclusive observation when signals unavailable" |
| Given/When describe user actions | Yes: task marked completed | Yes: task marked completed, no external links |
| Then describes user observations | Yes: verification observation exists with metadata | Yes: informational observation exists, task not reverted |
| Non-technical stakeholder confirms | Yes: "the system checks completed work" | Yes: "the system handles missing data gracefully" |
