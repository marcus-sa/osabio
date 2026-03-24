# Journey: Agent Connect & Execute — Visual Map

**Jobs served**: J1 (Context-Aware Coding), J2 (Zero-Config Onboarding), J5 (Real-Time Streaming)

## Journey Overview

```
 CONNECT                    AUTHENTICATE               EXECUTE                     STREAM                      COMPLETE
 ───────                    ────────────               ───────                     ──────                      ────────
 ┌──────────────┐          ┌──────────────┐          ┌──────────────┐           ┌──────────────┐           ┌──────────────┐
 │ OpenClaw CLI │          │ Ed25519      │          │ Submit work  │           │ Token stream │           │ Trace        │
 │ connects to  │────────▶ │ challenge-   │────────▶ │ via `agent`  │─────────▶ │ via WS       │─────────▶ │ recorded in  │
 │ Brain WS     │          │ response     │          │ method       │           │ events       │           │ graph        │
 └──────────────┘          └──────────────┘          └──────────────┘           └──────────────┘           └──────────────┘

 Emotional Arc:
 ┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
 │                                                                                                                     │
 │  Curiosity ──▶ Slight tension ──▶ Relief ──▶ Confidence ──────────────▶ Trust ──────────▶ Satisfaction             │
 │  "Will this    "Challenge         "I'm in,     "Context is              "I can see        "Full trace,              │
 │   just work?"   handshake..."      auto-         injected!"              tokens flowing"    auditable"               │
 │                                    registered"                                                                       │
 └─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

## Step-by-Step Journey

### Step 1: WebSocket Connect
| Aspect | Detail |
|--------|--------|
| **Actor** | Coding Agent Developer (via OpenClaw CLI) |
| **Action** | CLI opens WebSocket to `wss://brain.example/api/gateway` |
| **System** | Bun WebSocket upgrade handler creates connection state machine |
| **Artifact** | `${connectionId}` — UUID assigned to connection |
| **Emotion** | Curiosity — "Will Brain accept my device?" |
| **Failure** | Connection refused → clear error: "Gateway not enabled" or "Upgrade failed" |

### Step 2: Device Authentication
| Aspect | Detail |
|--------|--------|
| **Actor** | CLI (automatic) |
| **Action** | Sends `connect` frame with Ed25519 public key |
| **System** | Brain sends `connect.challenge` with nonce; CLI signs; Brain verifies |
| **Artifact** | `${deviceFingerprint}`, `${identityId}` |
| **Emotion** | Slight tension → Relief — handshake is fast, identity resolves |
| **Branch** | Known device → resolve identity | New device → DCR auto-registration |

### Step 3: Workspace Resolution
| Aspect | Detail |
|--------|--------|
| **Actor** | Brain (automatic) |
| **Action** | Resolve workspace from device membership; load authority scopes |
| **System** | Query `member_of` edge; load RAR authorization_details |
| **Artifact** | `${workspaceId}`, `${authorityScopes}` |
| **Emotion** | Confidence — "I'm in, workspace context is ready" |
| **Failure** | No workspace membership → return `connect.error` with enrollment instructions |

### Step 4: Submit Work
| Aspect | Detail |
|--------|--------|
| **Actor** | Coding Agent Developer |
| **Action** | Sends `agent` frame with task description / session key |
| **System** | Brain orchestrator: load graph context → inject learnings → evaluate policies → assign task |
| **Artifact** | `${runId}`, `${sessionId}` |
| **Emotion** | Confidence — "Brain loaded 4 decisions, 2 constraints, 1 learning into my agent's context" |
| **Failure** | Policy violation → `agent.error` with reason; Budget exceeded → `agent.error` with spend info |

### Step 5: Real-Time Streaming
| Aspect | Detail |
|--------|--------|
| **Actor** | Brain (automatic) → CLI renders |
| **Action** | Brain streams `StreamEvent` variants mapped to Gateway Protocol events |
| **System** | Event bridge: `agent_token` → assistant stream, `agent_file_change` → lifecycle stream |
| **Artifact** | `${streamEvents[]}` |
| **Emotion** | Trust — "I can see exactly what the agent is doing" |
| **Interaction** | `exec.approve` / `exec.deny` — developer approves/denies exec requests in real time |

### Step 6: Completion & Trace
| Aspect | Detail |
|--------|--------|
| **Actor** | Brain (automatic) |
| **Action** | Agent completes; Brain records hierarchical trace, updates spend, runs extraction pipeline |
| **System** | Trace graph: intent → session → tool calls → decisions/observations |
| **Artifact** | `${traceId}`, `${spendRecord}` |
| **Emotion** | Satisfaction — "Full provenance chain, auditable, queryable" |

## Error Paths

| Error | Step | Recovery |
|-------|------|----------|
| WS upgrade fails | 1 | HTTP 400 with reason; client retries with backoff |
| Ed25519 verification fails | 2 | `connect.error` code `auth_failed`; client re-generates challenge |
| No workspace membership | 3 | `connect.error` with enrollment URL; admin must invite device |
| Policy blocks execution | 4 | `agent.error` with policy ID and violation detail; developer adjusts scope or escalates |
| Budget exceeded | 4 | `agent.error` with current spend vs limit; platform engineer raises budget |
| WS disconnect mid-stream | 5 | Session continues server-side; client reconnects and resumes via `agent.status` |
| LLM provider error | 5 | `error` stream event with provider error; retry logic in orchestrator |
