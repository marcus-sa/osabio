# Story Map — openclaw-gateway

## Backbone (User Activities)

```
┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│  CONNECT    │  │  EXECUTE    │  │  STREAM     │  │  GOVERN     │  │  AUDIT      │
│             │  │             │  │             │  │             │  │             │
│ Device auth │  │ Submit work │  │ Real-time   │  │ Policy &    │  │ Trace &     │
│ + workspace │  │ + context   │  │ events      │  │ budget      │  │ spend       │
│ resolution  │  │ injection   │  │             │  │ enforcement │  │ queries     │
└─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘
```

## Walking Skeleton (Release 0 — End-to-End Thin Slice)

Minimum slice that proves the full pipeline works. Every activity is touched but with minimal scope.

| Activity | Walking Skeleton Story | Job |
|----------|----------------------|-----|
| CONNECT | WS upgrade + hardcoded identity (skip Ed25519 for skeleton) | J2 |
| EXECUTE | `agent` method → orchestrator assigns task with graph context | J1 |
| STREAM | `agent_token` events stream via WebSocket | J5 |
| GOVERN | Existing policy evaluation runs (no new governance UI) | J3 |
| AUDIT | Existing trace recording captures gateway session | J4 |

**Walking Skeleton Acceptance**: A client connects via WebSocket, sends an `agent` frame, receives streamed tokens, and the execution is recorded in the trace graph.

---

## Release 1: Authentication & Protocol Compliance

| # | Story | Activity | Job | Priority |
|---|-------|----------|-----|----------|
| 1.1 | Ed25519 device auth with challenge-response | CONNECT | J2 | Must |
| 1.2 | Known device → resolve Brain identity | CONNECT | J2 | Must |
| 1.3 | New device → DCR auto-registration | CONNECT | J2 | Must |
| 1.4 | Protocol frame parsing (req/res/event types) | CONNECT | J2 | Must |
| 1.5 | Connection state machine (connecting→authenticated→active→closed) | CONNECT | J2 | Must |
| 1.6 | `connect.error` with structured error codes | CONNECT | J2 | Must |

## Release 2: Core Execution Pipeline

| # | Story | Activity | Job | Priority |
|---|-------|----------|-----|----------|
| 2.1 | `agent` method with full orchestrator pipeline | EXECUTE | J1 | Must |
| 2.2 | Graph context injection into agent prompts | EXECUTE | J1 | Must |
| 2.3 | Active learning injection by agent type | EXECUTE | J1 | Must |
| 2.4 | Full event bridge: all StreamEvent → Gateway events | STREAM | J5 | Must |
| 2.5 | `exec.approve` / `exec.deny` / `exec.approval.resolve` via intent authorizer | STREAM | J5 | Must |
| 2.6 | `sessions.list` — list active/completed sessions | EXECUTE | J5 | Must |
| 2.7 | `sessions.history` — trace/transcript query | AUDIT | J4 | Must |
| 2.8 | `sessions.patch` — update model/thinking mid-session | EXECUTE | J5 | Should |
| 2.9 | `sessions.send` — cross-session messaging | EXECUTE | J6 | Should |
| 2.10 | `agent.wait` / `agent.status` — backward-compat aliases | EXECUTE | J5 | Should |
| 2.11 | `tools.catalog` — MCP tool registry query | EXECUTE | J1 | Must |
| 2.12 | `config.get` — read-only gateway config | CONNECT | J2 | Should |
| 2.13 | `method_not_supported` for unimplemented methods | CONNECT | J2 | Must |

## Release 3: Governance & Multi-Agent

| # | Story | Activity | Job | Priority |
|---|-------|----------|-----|----------|
| 3.1 | Policy evaluation on gateway intents | GOVERN | J3 | Must |
| 3.2 | Budget enforcement per device/agent | GOVERN | J7 | Must |
| 3.3 | RAR authorization_details in token claims | GOVERN | J3 | Must |
| 3.4 | Presence tracking (online/offline broadcast) | STREAM | J6 | Should |
| 3.5 | `model.list` — return configured providers | EXECUTE | J7 | Should |
| 3.6 | Per-agent spend reporting | AUDIT | J7 | Should |
| 3.7 | WS reconnection with session resumption | STREAM | J5 | Should |

## Release 4: Device Management & Polish

| # | Story | Activity | Job | Priority |
|---|-------|----------|-----|----------|
| 4.1 | Device management (list, revoke, rotate keys) | GOVERN | J2 | Could |
| 4.2 | `device.pair.*` — device pairing flow | CONNECT | J2 | Could |
| 4.3 | `device.token.rotate` — token rotation | CONNECT | J2 | Could |
| 4.4 | `chat.send` — chat agent via gateway | EXECUTE | J1 | Could |
| 4.5 | Gateway connection metrics (OTel spans) | AUDIT | J4 | Could |

---

## Dependency Graph

```
Walking Skeleton (R0)
  │
  ├─▶ R1: Auth & Protocol ──▶ R2: Execution Pipeline
  │                                    │
  │                                    ├─▶ R3: Governance & Multi-Agent
  │                                    │
  │                                    └─▶ R4: Device Management & Polish
  │
  └─▶ (all releases depend on R0)
```
