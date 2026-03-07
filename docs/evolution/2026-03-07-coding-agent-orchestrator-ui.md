# Evolution: Coding Agent Orchestrator UI

**Date**: 2026-03-07
**Feature**: coding-agent-orchestrator-ui
**Continues from**: coding-agent-orchestrator (backend phases 01-04)
**Branch**: marcus-sa/coding-agent-orch

## Feature Overview

UI layer for the coding agent orchestrator, exposing agent delegation across three surfaces:

1. **Task popup** (EntityDetailPanel) -- AgentStatusSection with assign button, status badge, file counter, stall warning, and review navigation link.
2. **Governance feed** -- Agent session feed items at review-tier (idle) and blocking-tier (error) with review/abort/discuss actions.
3. **Agent review view** -- Full-screen review page at `/review/$sessionId` with DiffViewer, AgentActivityLog, and accept/reject flows.

### Motivation

The backend orchestrator (phases 01-04) provided API endpoints for agent lifecycle management but no user-facing controls. Users needed a way to assign tasks, monitor agent progress in real time via SSE, review diffs, and accept or reject agent output -- all without leaving the existing workspace UI.

## Architecture Decisions

### Pure reducer pattern for agent session state

The `useAgentSession` hook manages real-time agent state via SSE using a pure reducer. SSE events (`agent_status`, `agent_file_change`, `agent_stall_warning`) map to state transitions without side effects in the reducer itself. EventSource lifecycle (open, close, reconnect) is managed in effect hooks.

### SSE lifecycle per ADR-004

Per-session EventSource opened only when an active session exists. Bootstrap via status poll on mount (handles page reload). Native EventSource retry for connection loss. Explicit close on terminal status (`completed`, `aborted`, `error`) or unmount. Falls back to single status poll on 404 (expired session).

### Feed action routing

Feed items for agent sessions use the existing `GovernanceFeedItem` contract with an added `agentSessionId` field. The "review" action navigates to the review route instead of calling the entity action API. "Abort" calls the abort endpoint directly. "Discuss" uses existing chat navigation.

### Entity detail response extension

Task entity detail includes an optional `agentSession` field when an active session exists (status in spawning/active/idle). This avoids a separate HTTP call to discover sessions. One conditional query added for task entities only; no impact on other entity types.

## Phase Completion Summary

| Phase | Name | Steps | Status |
|-------|------|-------|--------|
| 05 | Client Foundation | 05-01 through 05-05 | All COMMIT/PASS |
| 06 | UI Components | 06-01 through 06-04 | All COMMIT/PASS |
| 07 | Walking Skeleton Integration | 07-01 | COMMIT/PASS |
| -- | L1-L4 Refactoring | refactor | COMMIT/PASS (-12 lines net) |

**Total steps**: 10 implementation + 1 refactoring pass
**All steps**: COMMIT/PASS with DES monitoring

### Execution Timeline

- First step started: 2026-03-07T12:10:32Z (05-01 PREPARE)
- Last step committed: 2026-03-07T12:51:43Z (refactor COMMIT)
- Total delivery time: ~41 minutes

## Key Files Created

### New Files (11)

| File | Purpose |
|------|---------|
| `app/src/client/graph/orchestrator-api.ts` | Typed fetch wrappers for orchestrator endpoints |
| `app/src/client/hooks/use-agent-session.ts` | SSE subscription hook for real-time agent state |
| `app/src/client/hooks/use-agent-review.ts` | Review data fetching and accept/reject mutations |
| `app/src/client/components/graph/AgentStatusSection.tsx` | Agent status display within EntityDetailPanel |
| `app/src/client/components/review/DiffViewer.tsx` | Unified diff renderer with file expand/collapse |
| `app/src/client/components/review/AgentActivityLog.tsx` | Agent activity timeline |
| `app/src/client/routes/review-page.tsx` | Agent review view page |
| `app/src/server/feed/feed-queries.ts` | Agent attention session query for feed |
| `tests/acceptance/orchestrator-ui/walking-skeleton.test.ts` | E2E walking skeleton test |
| `tests/acceptance/orchestrator-ui/orchestrator-ui-test-kit.ts` | Test helpers for UI acceptance tests |
| `docs/feature/coding-agent-orchestrator/design/ui-architecture.md` | Architecture design document |

### Modified Files (4)

| File | Change |
|------|--------|
| `app/src/client/router.tsx` | Added `/review/$sessionId` route |
| `app/src/client/components/graph/EntityDetailPanel.tsx` | Conditional AgentStatusSection rendering for tasks |
| `app/src/client/components/feed/GovernanceFeed.tsx` | Review action routing to review view |
| `app/src/server/entities/entity-detail-route.ts` | Optional agentSession field for task entities |
| `app/src/shared/contracts.ts` | agentSessionId on GovernanceFeedItem, GovernanceFeedAction union |
| `app/src/server/feed/feed-route.ts` | Agent items in blocking/review feed tiers |

## Defects Found and Fixed

Adversarial review found 12 defects. All critical and high severity defects were fixed:

| ID | Severity | Description | Resolution |
|----|----------|-------------|------------|
| D4 | Critical | Fixed during adversarial review | Code corrected |
| D5 | High | Fixed during roadmap validation | Criteria tightened |
| D6 | Critical | Fixed during adversarial review | Code corrected |
| D7 | Critical | Fixed during adversarial review | Code corrected |
| D8 | High | Fixed during roadmap validation | Criteria tightened |
| D9 | High | Fixed during roadmap validation | Criteria tightened |
| D10 | High | Fixed during roadmap validation | Criteria tightened |

Integrity verification passed after all fixes.

## Test Coverage Summary

| Category | Count | Notes |
|----------|-------|-------|
| Walking skeleton scenarios | 3 | Cross-surface E2E journeys |
| Focused happy path scenarios | 11 | Per-surface boundary tests |
| Focused error path scenarios | 9 | Error escalation and edge cases |
| Focused edge case scenarios | 2 | Guard conditions |
| **Total scenarios** | **25** | 44% error path ratio |

### Walking Skeleton Scenarios

1. **Assign from popup, monitor in feed, accept in review view** -- Full three-surface journey (enabled, passing)
2. **Reject agent work with feedback and see agent resume** -- Feedback loop iteration
3. **Agent error surfaces as blocking feed item** -- Error escalation path

## Post-Delivery Quality

- L1-L4 refactoring pass completed: -12 lines net reduction
- All existing tests continue to pass after refactoring
- No regressions introduced
