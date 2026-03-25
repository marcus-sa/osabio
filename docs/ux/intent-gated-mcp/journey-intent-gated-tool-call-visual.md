# Journey: Intent-Gated MCP Tool Call

## Actors

| Actor | Type | Interface |
|-------|------|-----------|
| Coding Agent (in sandbox) | Machine | MCP protocol (tools/list, tools/call, create_intent) |
| Human Operator | Human | Brain Feed/UI (approve/veto intents) |
| Observer Agent | Machine | Graph scan + adapter.resumeSession |
| Workspace Admin | Human | Brain Policy Management UI |

## Flow: Happy Path (Auto-Approve)

```
Coding Agent                  Brain Dynamic MCP Endpoint           Brain Intent System
     |                                    |                               |
     |-- tools/list ------------------>   |                               |
     |                                    |-- resolve session intents     |
     |                                    |-- union authorization_details |
     |                                    |-- return filtered tool list   |
     |<-- [authorized tools + gated tools with descriptions] ----------- |
     |                                    |                               |
     |-- tools/call("github:create_pr")-->|                               |
     |                                    |-- check effective scope       |
     |                                    |   tool IS in scope            |
     |                                    |-- forward to upstream MCP --->| (GitHub)
     |                                    |<-- result                     |
     |                                    |-- record trace                |
     |<-- tool result -------------------|                               |
```

## Flow: Intent Escalation (Gated Tool, Auto-Approve Policy)

```
Coding Agent                  Brain MCP Endpoint        Intent System          Policy Gate
     |                              |                        |                      |
     |-- tools/call("stripe:       |                        |                      |
     |     create_refund") -------->|                        |                      |
     |                              |-- check scope          |                      |
     |                              |   tool NOT in scope    |                      |
     |<-- 403 intent_required       |                        |                      |
     |    { tool, action_template } |                        |                      |
     |                              |                        |                      |
     |-- create_intent ------------>|                        |                      |
     |   { goal, reasoning,        |-- create + submit ---->|                      |
     |     action_spec }           |                        |-- evaluate --------->|
     |                              |                        |<-- allow, no veto   |
     |                              |                        |   auto-approve       |
     |                              |<-- authorized          |                      |
     |<-- { intent_id, status:     |                        |                      |
     |      "authorized" }          |                        |                      |
     |                              |                        |                      |
     |-- tools/call("stripe:       |                        |                      |
     |     create_refund") -------->|                        |                      |
     |                              |-- check scope (now     |                      |
     |                              |   includes new intent) |                      |
     |                              |   tool IS in scope     |                      |
     |                              |-- forward to Stripe -->|                      |
     |<-- refund result ------------|                        |                      |
```

## Flow: Intent Escalation with Human Veto (Yield-and-Resume)

```
Coding Agent        Brain MCP          Intent System     Human Operator    Observer
     |                  |                    |                 |               |
     |-- tools/call --->|                    |                 |               |
     |<-- 403           |                    |                 |               |
     |                  |                    |                 |               |
     |-- create_intent->|-- create+submit -->|                 |               |
     |                  |                    |-- evaluate       |               |
     |                  |                    |   policy: veto   |               |
     |                  |                    |   required       |               |
     |                  |<-- pending_veto    |                 |               |
     |<-- { status:     |                    |                 |               |
     |   "pending_veto"}|                    |                 |               |
     |                  |                    |                 |               |
     | [AGENT YIELDS -- session goes idle]   |                 |               |
     |                  |                    |                 |               |
     |                  |                    |-- surfaces in -->|               |
     |                  |                    |   governance     |               |
     |                  |                    |   feed           |               |
     |                  |                    |                 |               |
     |                  |                    |<-- approve ------|               |
     |                  |                    |   authorized     |               |
     |                  |                    |                 |               |
     |                  |                    |                 |    [graph scan]
     |                  |                    |                 |               |
     |                  |                    |                 |  detects auth |
     |                  |                    |                 |  intent for   |
     |                  |                    |                 |  idle session |
     |                  |                    |                 |               |
     | [OBSERVER TRIGGERS RESUME] <------------------------------------|
     |                  |                    |                 |               |
     |-- (session       |                    |                 |               |
     |    resumes)      |                    |                 |               |
     |                  |                    |                 |               |
     |-- tools/call --->|-- scope check      |                 |               |
     |                  |   (now in scope)   |                 |               |
     |                  |-- forward -------->|                 |               |
     |<-- result -------|                    |                 |               |
```

## Flow: Rejected Intent

```
Coding Agent        Brain MCP          Intent System     Policy Gate
     |                  |                    |                 |
     |-- tools/call --->|                    |                 |
     |<-- 403           |                    |                 |
     |                  |                    |                 |
     |-- create_intent->|-- create+submit -->|                 |
     |                  |                    |-- evaluate ----->|
     |                  |                    |<-- deny          |
     |                  |                    |   (policy block) |
     |                  |<-- vetoed          |                 |
     |<-- { status:     |                    |                 |
     |   "vetoed",      |                    |                 |
     |   reason: "..." }|                    |                 |
     |                  |                    |                 |
     | [Agent adapts -- tries alternative approach or reports to user]
```

## Shared Artifacts

| Artifact | Source | Consumers |
|----------|--------|-----------|
| `proxy_token` | Session spawn (R2) | MCP endpoint auth, tools/list, tools/call |
| `agent_session` record | Session store | MCP endpoint (session lookup), observer (idle detection) |
| `intent` record | Intent system | Policy gate, MCP scope check, observer resume |
| `gates` edge (session->intent) | Intent creation | tools/list scope union, tools/call scope check |
| `authorization_details` | Intent + policy evaluation | tools/list filtering, tools/call validation |
| `action_spec_template` | 403 response | Agent's create_intent call |
| `mcp_tool` registry | Tool registry | tools/list, 403 error templates |

## Error Paths

| Error | Trigger | Agent Sees | Recovery |
|-------|---------|-----------|----------|
| Tool not in scope | tools/call for ungated tool | 403 `intent_required` + template | Create intent |
| Intent vetoed | Policy denies or human vetoes | `vetoed` status + reason | Try alternative or report |
| Intent timeout | Veto window expires without human action | `authorized` (auto-approve on expiry) | Automatic |
| Session not found | Invalid proxy token | 401 | Re-spawn session |
| Upstream MCP failure | Tool server down | 502 with error detail | Retry or skip |
| Constraint exceeded | Intent amount < actual | 403 constraint violation | Create new intent with correct params |
| Concurrent scope change | Policy updated mid-session | Next tools/call may fail | Create new intent |

## Integration Checkpoints

1. **Proxy token -> session -> intents**: Token resolves to session; session's `gates` edges resolve to intents; intents' `authorization_details` form effective scope
2. **tools/list consistency**: Listed tools must match what tools/call will accept (no lies in the listing)
3. **Intent -> policy -> scope**: Intent authorization must update the effective scope visible to subsequent tools/list and tools/call
4. **Observer -> session resume**: Observer must detect authorized intents for idle sessions and trigger adapter.resumeSession reliably
5. **Trace completeness**: Every tools/call (success or failure) must produce a trace record linked to session and intent
