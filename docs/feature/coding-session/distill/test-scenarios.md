# Coding Session: Acceptance Test Scenario Inventory

## Summary

| Category | Count |
|----------|-------|
| Walking skeletons | 3 |
| Focused scenarios | 28 |
| **Total** | **31** |
| Error/edge scenarios | 16 |
| Error path ratio | **52%** (target: 40%+) |

## Scenario Traceability

### Walking Skeletons

| # | Scenario | Stories | File |
|---|----------|---------|------|
| WS-1 | Assign, observe output, send follow-up | US-CS-003, US-CS-001, US-CS-002 | walking-skeleton.test.ts |
| WS-2 | Review conversation log after completion | US-CS-003, US-CS-004 | walking-skeleton.test.ts |
| WS-3 | Agent error stops session, notifies user | US-CS-001, US-CS-003 | walking-skeleton.test.ts |

### US-CS-003: Event Stream Wiring (7 scenarios)

| # | Scenario | Type | File |
|---|----------|------|------|
| 1 | Agent events flow to session stream | Happy | event-stream-wiring.test.ts |
| 2 | Session transitions to active after first event | Happy | event-stream-wiring.test.ts |
| 3 | Stall monitoring begins after session starts | Happy | event-stream-wiring.test.ts |
| 4 | Event stream error updates session to error | Error | event-stream-wiring.test.ts |
| 5 | Event iteration stops on completed status | Error | event-stream-wiring.test.ts |
| 6 | Event iteration stops on aborted status | Error | event-stream-wiring.test.ts |
| 7 | Nonexistent stream subscription fails | Edge | event-stream-wiring.test.ts |

### US-CS-001: Live Agent Output (6 scenarios)

| # | Scenario | Type | File |
|---|----------|------|------|
| 1 | Token events render as streaming text | Happy | live-agent-output.test.ts |
| 2 | File change events as inline notifications | Happy | live-agent-output.test.ts |
| 3 | Status transitions streamed to user | Happy | live-agent-output.test.ts |
| 4 | Files changed count increases | Happy | live-agent-output.test.ts |
| 5 | Stall warning on inactivity timeout | Error | live-agent-output.test.ts |
| 6 | Reconnection shows current status | Edge | live-agent-output.test.ts |

### US-CS-002: Follow-Up Prompt (9 scenarios)

| # | Scenario | Type | File |
|---|----------|------|------|
| 1 | Send prompt to active agent | Happy | follow-up-prompt.test.ts |
| 2 | Send prompt to idle agent (reactivates) | Happy | follow-up-prompt.test.ts |
| 3 | User prompt echoed in event stream | Happy | follow-up-prompt.test.ts |
| 4 | Prompt rejected for completed session | Error | follow-up-prompt.test.ts |
| 5 | Prompt rejected for aborted session | Error | follow-up-prompt.test.ts |
| 6 | Prompt rejected for error session | Error | follow-up-prompt.test.ts |
| 7 | Empty prompt text rejected | Edge | follow-up-prompt.test.ts |
| 8 | Prompt to nonexistent session fails | Edge | follow-up-prompt.test.ts |
| 9 | Prompt fails when handle missing | Edge | follow-up-prompt.test.ts |

### US-CS-004: Contextual Review (9 scenarios)

| # | Scenario | Type | File |
|---|----------|------|------|
| 1 | Review provides conversation log chronologically | Happy | contextual-review.test.ts |
| 2 | User prompts as distinct entries in log | Happy | contextual-review.test.ts |
| 3 | File change notifications in log | Happy | contextual-review.test.ts |
| 4 | Review includes session metadata | Happy | contextual-review.test.ts |
| 5 | Log without user prompts (agent-only) | Happy | contextual-review.test.ts |
| 6 | Log for nonexistent session fails | Error | contextual-review.test.ts |
| 7 | Log available for aborted session | Edge | contextual-review.test.ts |
| 8 | Reject feedback delivered, session resumes | Happy | contextual-review.test.ts |
| 9 | Log includes rejection feedback as prompt | Edge | contextual-review.test.ts |

## Acceptance Criteria Coverage Matrix

| AC Description | Scenario(s) |
|---------------|-------------|
| Event iteration starts after spawn | WS-1, ESW-1 |
| Events piped through event bridge to SSE | WS-1, ESW-1 |
| Stall detector starts after bridge wired | ESW-3 |
| Iteration stops on terminal status | ESW-5, ESW-6 |
| Stream errors update session to error | WS-3, ESW-4 |
| Session active after first event | ESW-2 |
| Token events stream into output | LAO-1 |
| File changes as inline notifications | LAO-2 |
| Status badge real-time updates | LAO-3 |
| Files changed count updates | LAO-4 |
| Stall warning after 30s inactivity | LAO-5 |
| Prompt delivers via POST (202) | WS-1, FUP-1 |
| Prompt to idle transitions to active | FUP-2 |
| User messages as distinct blocks | FUP-3 |
| Input disabled for completed session | FUP-4 |
| Input disabled for aborted session | FUP-5 |
| Input disabled for error session | FUP-6 |
| Prompt fails when handle missing | FUP-9 |
| Agent Log chronological trail | WS-2, CR-1 |
| User prompts distinct from agent output | CR-2 |
| File changes inline in log | CR-3 |
| Session metadata in review header | CR-4 |
| Reject with feedback resumes agent | CR-8 |

## Driving Ports Used

All tests invoke through these HTTP endpoints (driving ports):

- `POST /api/orchestrator/:ws/assign` -- session creation
- `GET  /api/orchestrator/:ws/sessions/:id` -- session status
- `GET  /api/orchestrator/:ws/sessions/:id/stream` -- SSE event stream
- `POST /api/orchestrator/:ws/sessions/:id/prompt` -- follow-up prompt (NEW)
- `GET  /api/orchestrator/:ws/sessions/:id/log` -- conversation log (NEW)
- `GET  /api/orchestrator/:ws/sessions/:id/review` -- review summary
- `POST /api/orchestrator/:ws/sessions/:id/accept` -- accept work
- `POST /api/orchestrator/:ws/sessions/:id/reject` -- reject with feedback
- `POST /api/orchestrator/:ws/sessions/:id/abort` -- abort session

## Property-Shaped Scenarios

| Scenario | Signal | File |
|----------|--------|------|
| Event ordering preserved regardless of rate | ordering guarantee | live-agent-output.feature |

## Implementation Sequence (One-at-a-Time)

1. WS-1: Assign, observe, send follow-up (ENABLED)
2. ESW-1: Agent events flow to stream
3. ESW-2: Session transitions to active
4. FUP-1: Send prompt to active agent
5. FUP-4: Prompt rejected for completed session
6. FUP-7: Empty prompt rejected
7. FUP-8: Prompt to nonexistent session
8. ESW-4: Stream error updates session
9. ESW-5: Iteration stops on completed
10. ESW-7: Nonexistent stream subscription
11. CR-1: Log in chronological order
12. CR-2: User prompts distinct in log
13. CR-6: Log for nonexistent session
14. (remaining scenarios by feature area)

## Mandate Compliance Evidence

**CM-A (Driving port usage)**: All test files import from `coding-session-test-kit.ts` which re-exports from `orchestrator-test-kit.ts`. Tests invoke through HTTP endpoints only. Zero internal component imports.

**CM-B (Business language purity)**: Gherkin uses domain terms: "Marcus", "coding agent", "follow-up prompt", "conversation log", "session", "review". Zero technical terms (no HTTP, JSON, API, database, SSE in Gherkin).

**CM-C (Walking skeleton + focused counts)**: 3 walking skeletons + 28 focused scenarios = 31 total. Error/edge ratio: 52%.
