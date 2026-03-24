# Opportunity Scores — openclaw-gateway

Scored using ODI (Outcome-Driven Innovation) methodology:
**Opportunity = Importance + max(Importance - Satisfaction, 0)**

Scale: 1-10 for Importance and Satisfaction.

| # | Job | Importance | Current Satisfaction | Opportunity Score | Priority |
|---|-----|-----------|---------------------|-------------------|----------|
| J1 | Context-Aware Coding Session | 9 | 2 | 9 + 7 = **16** | 1 |
| J3 | Governed Agent Execution | 9 | 3 | 9 + 6 = **15** | 2 |
| J6 | Multi-Agent Workspace Coordination | 8 | 2 | 8 + 6 = **14** | 3 |
| J4 | Native Trace Recording | 8 | 3 | 8 + 5 = **13** | 4 |
| J2 | Zero-Config Agent Onboarding | 7 | 3 | 7 + 4 = **11** | 5 |
| J7 | Model Routing and Spend Control | 7 | 4 | 7 + 3 = **10** | 6 |
| J5 | Real-Time Agent Streaming | 6 | 4 | 6 + 2 = **8** | 7 |

## Interpretation

**Over-served** (opportunity < 8): None — all jobs are underserved.

**Table stakes** (opportunity 8-10): J5 (streaming) and J7 (spend control) are expected capabilities but not primary differentiators.

**High opportunity** (opportunity 11-13): J2 (onboarding) and J4 (traces) represent strong improvement opportunities.

**Extreme opportunity** (opportunity 14+): J1 (context injection), J3 (governance), and J6 (coordination) are the primary value drivers. These should be the walking skeleton's focus.

## Walking Skeleton Scope (informed by scores)

The walking skeleton should deliver J1 (context-aware session) end-to-end:
1. WebSocket connect with device auth → Brain identity
2. `agent` method → orchestrator assigns task with graph context
3. Token streaming back via gateway protocol events
4. Trace recorded natively in graph

This validates the full pipeline: auth → context injection → execution → streaming → trace recording.

J3 (governance) and J6 (coordination) are naturally exercised since Brain's orchestrator already enforces policies and writes to the shared graph.
