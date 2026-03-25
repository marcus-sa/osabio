# Evolution: Intent-Gated MCP Tool Access

**Date**: 2026-03-25
**Feature ID**: intent-gated-mcp
**Duration**: ~2 hours (12:16 - 13:47 UTC)
**Scope**: Walking Skeleton + R1 (yield-and-resume)

## Summary

Implemented a dynamic per-agent MCP endpoint (`POST /mcp/agent/:sessionName`) that gates external tool calls behind intent authorization and policy evaluation. Sandbox coding agents (Claude Code, Codex) interact with Brain through this endpoint, which computes an effective tool scope from the agent's session-linked intents and either forwards authorized calls to upstream MCP servers or guides the agent through intent-based escalation.

## Business Context

Agents need governed access to external tools (GitHub, Stripe, etc.) without blanket permissions. The intent-gated MCP endpoint enforces the principle that every tool call must be traceable to an authorized intent, enabling:

- **Auditability**: Every tool call produces a trace record linked to the authorizing intent
- **Policy enforcement**: Workspace policies determine whether intents are auto-approved, require human veto review, or are denied
- **Agent self-escalation**: Agents discover they need permission, request it via `create_intent`, and retry after approval
- **Human-in-the-loop**: High-risk operations pause for human approval via the governance feed

## Architecture

Seven new modules under `app/src/server/mcp/`:

| Module | Type | Purpose |
|--------|------|---------|
| `agent-mcp-route.ts` | Effect boundary | HTTP route handler, JSON-RPC dispatch |
| `agent-mcp-auth.ts` | Effect boundary | Proxy token to session resolution |
| `scope-engine.ts` | Pure core + query port | Effective scope computation from gates edges |
| `tools-list-handler.ts` | Pure | MCP ListToolsResult builder with tool classification |
| `tools-call-handler.ts` | Effect boundary | Scope check, upstream forwarding, trace recording |
| `create-intent-handler.ts` | Effect boundary | Intent creation, policy evaluation, gates edge creation |
| `error-response-builder.ts` | Pure | Structured 403 with action_spec_template |

**Key design pattern**: Pure core / effect shell. Scope computation, tool classification, and error building are pure functions. DB queries, upstream MCP calls, and trace writes happen at boundaries with injectable dependencies.

**Zero new dependencies**: Reuses existing proxy auth, tool resolver, intent lifecycle, policy gate, MCP client factory, and trace writer.

## Steps Completed

| Step | Name | Phase |
|------|------|-------|
| 01-01 | Error response builder and scope engine pure functions | Auth, Scope Engine, Route Shell |
| 01-02 | Agent MCP auth -- proxy token to session resolution | Auth, Scope Engine, Route Shell |
| 01-03 | Agent MCP route shell with tools/list handler | Auth, Scope Engine, Route Shell |
| 02-01 | Tools/call handler -- authorized call forwarding and trace | Tools/call and Trace Recording |
| 02-02 | 403 intent_required for gated tools | Tools/call and Trace Recording |
| 02-03 | Scope engine query port -- load authorized intents from gates edges | Tools/call and Trace Recording |
| 03-01 | Create intent handler -- auto-approve path | Create Intent and Escalation Flow |
| 03-02 | Policy-denied intent path | Create Intent and Escalation Flow |
| 03-03 | Full escalation cycle -- WS-2 walking skeleton | Create Intent and Escalation Flow |
| 04-01 | Pending veto path -- create_intent returns pending_veto | Pending Veto and Yield-and-Resume |
| 04-02 | Human approve/veto endpoints and WS-3 walking skeleton | Pending Veto and Yield-and-Resume |

All 11 steps passed through PREPARE -> RED_ACCEPTANCE -> GREEN -> COMMIT phases via TDD.

## Key Design Decisions

1. **No DPoP for sandbox agents** (D1): Sandbox agents authenticate via `X-Brain-Auth` proxy token only. They cannot generate DPoP proofs. The proxy token binds to session and workspace.

2. **Agent-driven escalation via create_intent tool** (D3): Two mechanisms -- proactive (tools/list enriches gated descriptions with instructions) and reactive (tools/call returns structured 403 with action_spec_template).

3. **Yield-and-resume, not polling** (D4): When `create_intent` returns `pending_veto`, the agent yields. The Observer detects the authorized intent on idle sessions and triggers `adapter.resumeSession`.

4. **Intent accumulation via gates edges** (D5): Sessions accumulate intents over their lifetime. `gates` relation (intent -> agent_session) links intents to sessions. Scope computation unions all authorized intents' authorization_details.

5. **Effective scope = can_use INTERSECT intent authorization_details** (D6): A tool must be both granted via `can_use` edge AND covered by an authorized intent.

6. **Single acceptance test file** (DISTILL): `tests/acceptance/agent-mcp-governance.test.ts` with scenarios enabled one-at-a-time via TDD. Mock upstream MCP via `mcpClientFactoryOverride` (no MSW).

## Test Coverage

24 test scenarios designed (3 walking skeletons + 10 happy path + 11 error/edge). 18 implemented in Walking Skeleton + R1 scope:

- **WS-1**: Agent discovers tools and calls an authorized tool (full E2E)
- **WS-2**: Agent escalates for gated tool via create_intent (full escalation cycle)
- **WS-3**: Agent yields on pending_veto, human approves, agent resumes
- **HP-1 through HP-9**: Classification, forwarding, traces, intent flows, human approve/veto
- **EP-1 through EP-5**: Auth errors, 403 intent_required, policy denial
- **EC-1, EC-2**: Unknown session 404, trace recording for every call

## Deferred to Follow-up Roadmaps

- **R2**: Constraint enforcement (EP-6/EP-7/EP-8), composite intents (HP-10)
- **R3**: Intent dedup (EC-3), timeout handling, scope caching

## Lessons Learned

1. **SurrealDB protected variable `$session`**: Must use `$sess` for bound parameters in gates edge queries -- `$session` is reserved in SurrealDB v3.0.

2. **Gates edge direction matters**: `intent -gates-> agent_session` (IN intent OUT agent_session). Queries traverse `SELECT in.* FROM gates WHERE out = $session`, not the reverse.

3. **Functional paradigm pays off**: Pure core functions (scope computation, tool classification, error building) were trivially unit-testable. Effect boundaries (auth, upstream forwarding, trace recording) tested via acceptance tests against real SurrealDB.

## Migrated Artifacts

- Architecture design: `docs/architecture/intent-gated-mcp/`
- Test scenarios: `docs/scenarios/intent-gated-mcp/`
