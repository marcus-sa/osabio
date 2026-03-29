# Evolution: Observer Agent

**Date:** 2026-03-11
**Feature:** observer-agent
**Branch:** marcus-sa/observer-agent

## Summary

Built the Observer agent -- an autonomous verification layer that watches the knowledge graph for state transitions and validates claims against reality. The Observer detects contradictions between what agents claim and what actually happened, performs cross-agent peer review of observations, and scans the workspace graph for drift patterns (stale blocked tasks, status inconsistencies, decision-implementation misalignment).

The Observer closes the "reality drift" gap described in the Osabio architecture: without continuous verification, the knowledge graph becomes a delusion engine where agents trust each other's outputs without cross-checking.

## Implementation Stats

| Metric | Value |
|--------|-------|
| Phases | 4 |
| Steps | 13 |
| First event | 2026-03-11T07:31:09Z |
| Last event | 2026-03-11T10:32:30Z |
| Total elapsed | ~3 hours |
| Commits on branch | 18 |

All 13 steps passed all executed TDD phases (PREPARE, RED_ACCEPTANCE, GREEN, COMMIT). Unit test phases were skipped across all steps as the functional pipeline architecture is fully covered by acceptance-level tests.

## Steps Completed

| Step | Name | Status |
|------|------|--------|
| 01-01 | Observation schema extensions | Done |
| 01-02 | Extend observes relation OUT types | Done |
| 01-03 | SurrealDB EVENT definitions for observer triggers | Done |
| 02-01 | Observer HTTP route and task verification pipeline | Done |
| 02-02 | Intent and commit verification pipelines | Done |
| 02-03 | Graceful degradation on external failures | Done |
| 03-01 | Observer agent with ToolLoopAgent pattern | Done |
| 03-02 | Graph scan route for contradiction detection | Done |
| 03-03 | Graph scan deduplication and status drift detection | Done |
| 03-04 | Walking skeleton integration | Done |
| 04-01 | Decision confirmation and supersession verification | Done |
| 04-02 | Cross-agent peer review | Done |
| 04-03 | Cascade prevention and no-loop guarantee | Done |

## Key Decisions

### EVENT guards with `$event = "UPDATE"`

SurrealDB EVENTs on task, intent, and decision tables use `$event = "UPDATE"` guards to prevent CREATE operations from triggering verification. Only state transitions (status changes) are meaningful verification triggers. Git commit uses `$event = "CREATE"` since new commits are the trigger. Observation peer review uses `$event = "CREATE"` filtered by `source_agent != "observer_agent"` to prevent infinite loops.

### Graph scan deduplication strategy

Before creating observations during graph scans, the scanner queries existing open observer observations linked to the same entity. If an open observation already exists for the same issue, the scan skips it. This prevents duplicate noise from repeated scans without requiring external dedup infrastructure.

### Deterministic verification pipeline

The verification pipeline follows a functional composition pattern: `receiveEvent -> gatherSignals -> compareClaimVsReality -> createObservation`. Pure core functions handle comparison logic while the route boundary handles effects (DB reads/writes, external API calls). This makes the pipeline testable without mocking infrastructure.

### Cascade prevention via EVENT WHERE clause

Observer's own observations (`source_agent = "observer_agent"`) are excluded from the peer review EVENT trigger at the database level. This provides a hard guarantee against infinite observation loops without application-level checks.

## Architecture

```
State Transition (task completed, decision confirmed, commit created)
  |
  v
SurrealDB ASYNC EVENT (RETRY 3)
  |
  v
POST /api/observe/:table/:id
  |
  v
Verification Pipeline
  |-- Gather signals (linked entities, external CI status)
  |-- Compare claim vs reality
  |-- Observer Agent (ToolLoopAgent with structured output)
  |
  v
Observation created (linked via observes edge)
```

**Graph Scan** (periodic, triggered via `POST /api/observe/scan/:workspaceId`):
- Scans confirmed decisions against completed tasks for contradictions
- Detects tasks blocked longer than 14-day threshold
- Detects status drift (completed tasks with incomplete dependencies)
- Deduplicates against existing open observations

**Peer Review** (event-triggered):
- Non-observer agent observations trigger cross-check
- Observer validates the claim against graph state
- Peer review observation linked to original via observes edge

## Files Created/Modified

### Production code (new)

- `app/src/server/observer/observer-route.ts` -- HTTP route handler, table dispatch
- `app/src/server/observer/verification-pipeline.ts` -- functional verification pipeline per entity type
- `app/src/server/observer/external-signals.ts` -- external signal gathering with graceful degradation
- `app/src/server/observer/graph-scan.ts` -- workspace graph scan for contradictions and drift
- `app/src/server/agents/observer/agent.ts` -- ToolLoopAgent implementation
- `app/src/server/agents/observer/prompt.ts` -- system prompt with workspace context
- `app/src/server/agents/observer/tools.ts` -- composed tools (create_observation, get_entity_detail, search_entities)

### Schema

- `schema/surreal-schema.surql` -- observation table extensions (verified, source, data fields; expanded observation_type enum; observes OUT types)
- `schema/migrations/0027_observer_schema_extensions.surql` -- versioned migration

### Modified

- `app/src/server/runtime/start-server.ts` -- observer route registration

### Test files

- `tests/acceptance/observer-agent/milestone-1-schema-and-events.test.ts`
- `tests/acceptance/observer-agent/milestone-2-verification-pipeline.test.ts`
- `tests/acceptance/observer-agent/milestone-3-agent-and-scan.test.ts`
- `tests/acceptance/observer-agent/milestone-4-peer-review.test.ts`
- `tests/acceptance/observer-agent/walking-skeleton.test.ts`
- `tests/acceptance/observer-agent/observer-test-kit.ts`

## Test Coverage

- **34 acceptance tests**, 0 skipped
- **Milestone 1** (schema and events): schema field defaults, observes edge types, EVENT trigger conditions (fires/does-not-fire)
- **Milestone 2** (verification pipeline): task/intent/commit verification with passing/failing/missing signals, graceful degradation
- **Milestone 3** (agent and scan): structured agent output, observation linking, contradiction detection, stale-blocked detection, deduplication, status drift
- **Milestone 4** (peer review): decision confirmation/supersession verification, cross-agent observation review, cascade prevention
- **Walking skeleton**: end-to-end task completion trigger through observation creation

## Review Findings Addressed

Three findings from the software-crafter reviewer were addressed in the final commit:

1. **SQL injection prevention (table whitelist):** Observer route validates the `:table` path parameter against an explicit allowlist of supported tables (`task`, `intent`, `git_commit`, `decision`, `observation`). Rejects unknown tables with 400 before any DB query.

2. **UUID validation:** The `:id` path parameter is validated as a valid UUID format before constructing a `RecordId`. Malformed IDs are rejected with 400.

3. **EVENT round-trip tests unskipped:** Cascade prevention tests (S6-6, S6-7, S10-4) that were initially skipped pending EVENT wiring were unskipped and validated passing, confirming the `source_agent != "observer_agent"` EVENT guard works end-to-end.
