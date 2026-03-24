# Test Scenarios — openclaw-gateway

## Scenario Inventory

### Walking Skeleton (Release 0) — 5 scenarios

| # | Scenario | AC | Driving Port | Status |
|---|---------|-----|-------------|--------|
| WS-1 | WebSocket upgrade succeeds | AC-0.1 | `GET /api/gateway` (upgrade) | Active |
| WS-2 | Agent method returns runId with context summary | AC-0.2 | WS `agent` method | Active |
| WS-3 | Token events stream with seq numbers | AC-0.3 | WS event frames | Active |
| WS-4 | Session completes with done event | AC-0.3 | WS event frames | Active |
| WS-5 | Non-upgrade request to /api/gateway returns 426 | — | `GET /api/gateway` (HTTP) | Active |

### Release 1: Authentication & Protocol — 9 scenarios

Ordered by dependency: challenge first, then connect, then known/new device, then edge cases.

| # | Scenario | AC | Driving Port | Status |
|---|---------|-----|-------------|--------|
| R1-1 | connect.challenge sent immediately on WS open | AC-1.1 | WS open event | @skip |
| R1-2 | Gateway Protocol v3 connect handshake succeeds | AC-1.1 | WS `connect` (single-frame with device identity) | @skip |
| R1-3 | Known device resolves identity | AC-1.2 | WS `connect` | @skip |
| R1-4 | New device auto-registers via DCR | AC-1.3 | WS `connect` | @skip |
| R1-5 | Valid request frame dispatches to handler | AC-1.4 | WS `req` frame | @skip |
| R1-6 | Malformed frame returns invalid_frame error | AC-1.4 | WS malformed text | @skip |
| R1-7 | State machine: connecting → authenticating → active | AC-1.5 | WS state transitions | @skip |
| R1-8 | Method before auth returns not_authenticated | AC-1.5 | WS `agent` in connecting | @skip |
| R1-9 | Double connect returns already_authenticated | AC-1.5 | WS `connect` in active | @skip |

### Release 2: Core Execution — 12 scenarios

| # | Scenario | AC | Driving Port | Status |
|---|---------|-----|-------------|--------|
| R2-1 | Full pipeline with context + policy + budget | AC-2.1 | WS `agent` method | @skip |
| R2-2 | Exec approval forwards to client and back | AC-2.2 | WS `exec.approve` | @skip |
| R2-3 | Exec denial prevents execution | AC-2.2 | WS `exec.deny` | @skip |
| R2-4 | sessions.list returns active and completed sessions | AC-2.3 | WS `sessions.list` | @skip |
| R2-5 | agent.status returns session state (backward compat) | AC-2.3 | WS `agent.status` | @skip |
| R2-6 | agent.wait returns on completion | AC-2.3 | WS `agent.wait` | @skip |
| R2-7 | sessions.history returns trace tree | AC-2.4 | WS `sessions.history` | @skip |
| R2-8 | tools.catalog returns agent's granted tools | AC-2.5 | WS `tools.catalog` | @skip |
| R2-9 | Unsupported method returns method_not_supported | AC-2.6 | WS `config.apply` | @skip |
| R2-10 | sessions.patch updates model mid-session | AC-2.3 | WS `sessions.patch` | @skip |
| R2-11 | File change streams as lifecycle event | AC-0.3 | WS event frames | @skip |
| R2-12 | config.get returns gateway capabilities | AC-2.6 | WS `config.get` | @skip |

### Release 3: Governance & Multi-Agent — 6 scenarios

| # | Scenario | AC | Driving Port | Status |
|---|---------|-----|-------------|--------|
| R3-1 | Policy violation returns structured error | AC-3.1 | WS `agent` method | @skip |
| R3-2 | Budget exceeded returns spend details | AC-3.2 | WS `agent` method | @skip |
| R3-3 | Presence query returns connected devices | AC-3.3 | WS `presence` method | @skip |
| R3-4 | Disconnect broadcasts offline event | AC-3.3 | WS close | @skip |
| R3-5 | Model list returns providers without keys | AC-3.4 | WS `model.list` method | @skip |
| R3-6 | Reconnect resumes session via agent.status | AC-3.5 | WS reconnect + `agent.status` | @skip |

### OpenClaw CLI Smoke Tests — 4 scenarios

| # | Scenario | AC | Driving Port | Status |
|---|---------|-----|-------------|--------|
| CLI-1 | OpenClaw CLI connects to Brain gateway | AC-1.1 | `openclaw gateway call` subprocess | @skip |
| CLI-2 | CLI sessions.list returns valid JSON | AC-2.3 | `openclaw gateway call sessions.list` | @skip |
| CLI-3 | CLI tools.catalog returns agent's granted tools | AC-2.5 | `openclaw gateway call tools.catalog` | @skip |
| CLI-4 | CLI config.get returns gateway capabilities | AC-2.6 | `openclaw gateway call config.get` | @skip |

## Total: 36 scenarios

- **Active (Walking Skeleton)**: 5
- **@skip (R1-R3)**: 27
- **@skip (CLI smoke)**: 4

## Test-to-Story Traceability

| User Story | Scenarios |
|-----------|-----------|
| US-0.1 | WS-1, WS-5 |
| US-0.2 | WS-2 |
| US-0.3 | WS-3, WS-4 |
| US-1.1 | R1-1, R1-2 |
| US-1.2 | R1-3 |
| US-1.3 | R1-4 |
| US-1.4 | R1-5, R1-6 |
| US-1.5 | R1-7, R1-8, R1-9 |
| US-2.1 | R2-1 |
| US-2.2 | R2-2, R2-3 |
| US-2.3 | R2-4, R2-5, R2-6, R2-10 |
| US-2.4 | R2-7 |
| US-2.5 | R2-8, CLI-3 |
| US-2.6 | R2-9, R2-12, CLI-4 |
| US-3.1 | R3-1 |
| US-3.2 | R3-2 |
| US-3.3 | R3-3, R3-4 |
| US-3.4 | R3-5 |
| US-3.5 | R3-6 |
| CLI compat | CLI-1, CLI-2 |

All user stories have at least one acceptance test scenario.
