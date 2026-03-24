# Shared Artifacts Registry — openclaw-gateway

Every `${variable}` in journeys has a single documented source.

| Artifact | Type | Source | First Produced | Consumed By |
|----------|------|--------|----------------|-------------|
| `${connectionId}` | UUID | Brain gateway on WS upgrade | Step 1: WS Connect | All subsequent steps (correlation ID) |
| `${deviceFingerprint}` | string | SHA-256 of Ed25519 public key | Step 2: Device Auth | Identity lookup, trace recording, spend tracking |
| `${identityId}` | RecordId<identity> | Brain identity table | Step 2: Device Auth (known) or DCR (new) | All Brain operations (actor context) |
| `${clientId}` | string | DCR registration response | Step 2: DCR (new device only) | OAuth token claims, device management |
| `${workspaceId}` | RecordId<workspace> | `member_of` edge query | Step 3: Workspace Resolution | All workspace-scoped operations |
| `${authorityScopes}` | object | RAR `authorization_details` | Step 3: Workspace Resolution | Policy evaluation, intent authorization |
| `${runId}` | UUID | Orchestrator session creation | Step 4: Submit Work | Event streaming, trace recording, status queries |
| `${sessionId}` | RecordId<agent_session> | Agent session table | Step 4: Submit Work | Trace graph, spend tracking |
| `${streamEvents[]}` | StreamEvent[] | Event bridge | Step 5: Streaming | Client rendering |
| `${traceId}` | RecordId<trace> | Trace graph recording | Step 6: Completion | Audit, forensic debugging |
| `${spendRecord}` | object | Spend tracking system | Step 6: Completion | Budget enforcement, reporting |
| `${policyId}` | RecordId<policy> | Policy graph | Governance Step 2 | Policy enforcement, violation reporting |
| `${authorizationDetails}` | object (RFC 9396) | RAR configuration | Governance Step 2 | Token claims, intent evaluation |
| `${presenceState}` | object | SSE registry | Governance Step 3 | Multi-agent monitoring |
| `${intentEvaluation}` | object | Authorizer | Governance Step 4 | Allow/deny decision |
| `${traceTree}` | object | Trace graph query | Governance Step 5 | Audit, compliance |

## Artifact Lifecycle

```
Ed25519 key pair (client-side)
  │
  ├─▶ deviceFingerprint ──▶ identityId ──▶ workspaceId
  │                                            │
  │                                            ├─▶ authorityScopes
  │                                            │
  └─▶ clientId (DCR only)                     ├─▶ runId ──▶ sessionId
                                               │              │
                                               │              ├─▶ streamEvents[]
                                               │              ├─▶ traceId
                                               │              └─▶ spendRecord
                                               │
                                               └─▶ policyId ──▶ intentEvaluation
```
