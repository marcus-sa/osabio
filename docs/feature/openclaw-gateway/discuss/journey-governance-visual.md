# Journey: Platform Governance & Device Management — Visual Map

**Jobs served**: J3 (Governed Execution), J4 (Native Traces), J6 (Multi-Agent Coordination), J7 (Model/Spend Control)

## Journey Overview

```
 REGISTER DEVICE            CONFIGURE SCOPES           MONITOR AGENTS              AUDIT TRACES
 ───────────────            ────────────────           ──────────────              ────────────
 ┌──────────────┐          ┌──────────────┐          ┌──────────────┐           ┌──────────────┐
 │ New device   │          │ Set authority│          │ View presence│           │ Query trace  │
 │ auto-        │────────▶ │ scopes, RAR  │────────▶ │ + live       │─────────▶ │ graph for    │
 │ registers    │          │ policies     │          │ streams      │           │ provenance   │
 └──────────────┘          └──────────────┘          └──────────────┘           └──────────────┘

 Emotional Arc:
 ┌─────────────────────────────────────────────────────────────────────────────────────────────┐
 │                                                                                             │
 │  Alertness ────▶ Control ────────▶ Confidence ──────────▶ Trust ──────▶ Assurance           │
 │  "New device     "Scopes are       "Policies             "I see all    "Provenance           │
 │   connected"      configured"       are enforced"         agents live"  chain is complete"    │
 │                                                                                             │
 └─────────────────────────────────────────────────────────────────────────────────────────────┘
```

## Step-by-Step Journey

### Step 1: Device Auto-Registration (DCR)
| Aspect | Detail |
|--------|--------|
| **Actor** | Platform Engineer (observes); Agent (initiates) |
| **Action** | New device connects; Brain creates OAuth client via DCR (RFC 7591) |
| **System** | `POST /api/oauth/register` internal; create identity + `member_of` edge |
| **Artifact** | `${clientId}`, `${deviceFingerprint}`, `${identityId}` |
| **Emotion** | Alertness — "New device joined, let me check its scope" |

### Step 2: Configure Authority Scopes
| Aspect | Detail |
|--------|--------|
| **Actor** | Platform Engineer |
| **Action** | Set RAR `authorization_details` for the device/agent tier |
| **System** | Policy graph updated; RAR claims embedded in future tokens |
| **Artifact** | `${authorizationDetails}`, `${policyId}` |
| **Emotion** | Control — "I define what this agent can do, at what risk level, with what budget" |

### Step 3: Monitor Active Agents
| Aspect | Detail |
|--------|--------|
| **Actor** | Platform Engineer |
| **Action** | View presence (online/offline), active sessions, live streams |
| **System** | SSE registry broadcasts connection state; `agent.status` queries |
| **Artifact** | `${presenceState}`, `${activeSessions[]}` |
| **Emotion** | Confidence — "I see all agents and their current state" |

### Step 4: Policy Enforcement in Action
| Aspect | Detail |
|--------|--------|
| **Actor** | Brain (automatic) |
| **Action** | Agent submits work → intent evaluated against policy graph → budget checked |
| **System** | `authorizer.evaluate()` checks policies, risk levels, budget limits |
| **Artifact** | `${intentEvaluation}`, `${spendRecord}` |
| **Emotion** | Trust — "Governance is enforced natively, not bolted on" |
| **Failure** | Policy violation → intent denied → agent receives structured error |

### Step 5: Trace Audit
| Aspect | Detail |
|--------|--------|
| **Actor** | Platform Engineer |
| **Action** | Query trace graph: intent → session → tool calls → decisions |
| **System** | Hierarchical trace stored natively; graph query traversal |
| **Artifact** | `${traceTree}` |
| **Emotion** | Assurance — "Complete provenance, every step auditable" |

## Multi-Agent Coordination Pattern

```
Agent A (architect) ───▶ writes decision to graph
                                    │
Agent B (coder)    ───▶ reads decision from graph context
                                    │
Observer           ───▶ detects contradiction between A's decision and B's code
                                    │
Feed               ───▶ surfaces observation to platform engineer
```

No agent messages another. The graph is the coordination bus. The gateway protocol is the transport — it doesn't change the coordination model.
