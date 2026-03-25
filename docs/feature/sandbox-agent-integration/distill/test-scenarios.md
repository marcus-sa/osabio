# Test Scenarios: Sandbox Agent Integration (R1)

## Scope

Release 1 only: Session spawn, multi-turn prompt, event bridge, session persistence, session restoration.
NOT in scope: Dynamic MCP endpoint (R2), permission handler with intent authorization (R2), cloud providers (R3), SurrealDB persistence driver / sandbox_event table (deferred).

## Driving Ports

| Port | Type | Used By |
|------|------|---------|
| `POST /api/orchestrator/:ws/sessions/assign` | HTTP | Session spawn |
| `GET /api/orchestrator/:ws/sessions/:id` | HTTP | Session status |
| `POST /api/orchestrator/:ws/sessions/:id/prompt` | HTTP | Multi-turn prompt |
| `POST /api/orchestrator/:ws/sessions/:id/accept` | HTTP | Accept work |
| `POST /api/orchestrator/:ws/sessions/:id/abort` | HTTP | Abort session |
| `GET /api/orchestrator/:ws/sessions/:id/stream` | SSE | Event stream |
| `SandboxAgentAdapter` interface | Adapter port | Unit tests (mock) |

## Scenario Inventory

### Walking Skeletons (Acceptance)

| # | Scenario | Stories | Driving Port |
|---|----------|---------|-------------|
| WS-1 | Developer spawns a session, sends a prompt, and receives events | US-01, US-03, US-04 | POST assign, POST prompt, SSE stream |
| WS-2 | Developer sends follow-up prompts to an active session | US-04 | POST prompt (x3) |
| WS-3 | Session record persists in SurrealDB and survives query after creation | US-01, US-02 | POST assign, direct SurrealDB query |

### Happy Path Scenarios

| # | Scenario | Level | Stories | Driving Port |
|---|----------|-------|---------|-------------|
| HP-1 | Session spawns within expected time and returns session ID | Acceptance | US-01 | POST assign |
| HP-2 | Session record in SurrealDB has correct sandbox fields | Acceptance | US-01, US-02 | POST assign + SurrealDB query |
| HP-3 | Follow-up prompt delivered to existing session | Acceptance | US-04 | POST prompt |
| HP-4 | Third prompt in multi-turn sequence retains context | Acceptance | US-04 | POST prompt (x3) |
| HP-5 | Session status shows active after spawn | Acceptance | US-01 | GET session status |
| HP-6 | Session marked completed after accept | Acceptance | US-01 | POST accept |

### Error Path Scenarios (40%+ target)

| # | Scenario | Level | Stories | Driving Port |
|---|----------|-------|---------|-------------|
| EP-1 | Spawn fails when SandboxAgent server is unavailable | Acceptance | US-01 | POST assign |
| EP-2 | No partial session record in SurrealDB after failed spawn | Acceptance | US-01 | POST assign + SurrealDB query |
| EP-3 | Prompt to concluded session returns 404 | Acceptance | US-04 | POST prompt |
| EP-4 | Prompt to non-existent session returns 404 | Acceptance | US-04 | POST prompt |
| EP-5 | Spawn with invalid workspace returns authorization error | Acceptance | US-01 | POST assign |
| EP-6 | Unknown event type from SandboxAgent does not crash bridge | Unit | US-03 | SandboxAgentAdapter.onEvent |
| EP-7 | Session restoration fails when sandbox provider unavailable | Acceptance | US-05 | Server restart + SurrealDB query |

### Edge Case / Boundary Scenarios

| # | Scenario | Level | Stories | Driving Port |
|---|----------|-------|---------|-------------|
| EC-1 | Concurrent prompt during active processing returns 202 Accepted | Acceptance | US-04 | POST prompt |
| EC-2 | Session restoration after server restart loads active sessions from SurrealDB | Acceptance | US-05 | Server restart + GET session status |

### Unit Test Scenarios (Mock Adapter)

#### Sandbox Adapter Interface

| # | Scenario | Stories |
|---|----------|---------|
| UA-1 | createSession returns a SessionHandle with valid ID | US-01 |
| UA-2 | prompt delivers messages and returns result | US-04 |
| UA-3 | destroySession completes without error | US-01 |
| UA-4 | resumeSession returns a SessionHandle for existing session | US-05 |
| UA-5 | createSession propagates connection errors | US-01 |
| UA-6 | prompt on destroyed session throws | US-04 |

#### Event Bridge Translation

| # | Scenario | Stories |
|---|----------|---------|
| UB-1 | tool_call event translates to agent_token StreamEvent | US-03 |
| UB-2 | file_edit event translates to agent_file_change StreamEvent | US-03 |
| UB-3 | text/message event translates to agent_token StreamEvent | US-03 |
| UB-4 | result event translates to agent_status StreamEvent | US-03 |
| UB-5 | Unknown event type is logged and skipped (no crash) | US-03 |
| UB-6 | Multiple events translated in sequence preserve order | US-03 |
| UB-7 | Event bridge notifies stall detector on each event | US-03 |

#### Session Store Queries

| # | Scenario | Stories |
|---|----------|---------|
| UC-1 | Create session record with sandbox fields (provider, session_type) | US-02 |
| UC-2 | Update session status transitions (running -> idle -> completed) | US-02 |
| UC-3 | Query active sandbox sessions by workspace | US-02 |
| UC-4 | Update external_session_id on restoration | US-05 |
| UC-5 | Session with session_type "sandbox_agent" is distinguishable from "claude_agent_sdk" | US-02 |

## Error Path Ratio

- Total scenarios: 31
- Error/edge scenarios: 13 (EP-1 through EP-7, EC-1, EC-2, UA-5, UA-6, UB-5)
- Ratio: 42% (exceeds 40% target)

## Implementation Sequence (One-at-a-Time)

1. **WS-1** (walking skeleton) -- enables first, proves E2E path
2. **WS-2** -- multi-turn follow-up
3. **WS-3** -- persistence verification
4. HP-1 through HP-6 (happy paths)
5. EP-1 through EP-7 (error paths)
6. EC-1, EC-2 (edge cases)
7. Unit tests (UA, UB, UC series) -- parallel with acceptance tests
