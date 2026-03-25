# Wave Decisions: Intent-Gated MCP Tool Access

Summary of design decisions for downstream waves (DISTILL, DELIVER, DEVOPS).

---

## For Acceptance Designer (DISTILL Wave)

### Endpoint

- Route: `POST /mcp/agent/:sessionName`
- Auth: `X-Brain-Auth` proxy token (no DPoP)
- Protocol: JSON-RPC 2.0 over HTTP (MCP protocol)

### Three MCP Methods

1. **tools/list**: Returns classified tool list (authorized + gated + brain-native)
2. **tools/call**: Executes authorized tool calls via upstream MCP server
3. **create_intent**: Brain-native tool for intent-based escalation

### Key Behaviors to Test

- Scope computation consistency: tools/list and tools/call use the same scope function
- Gates edge direction: `intent -gates-> agent_session` (NOT session -> intent)
- Effective scope: `can_use grants INTERSECT intent authorization_details`
- Gated tool description enrichment: includes create_intent instructions
- 403 `intent_required` with `action_spec_template` on unauthorized tools/call
- 403 `constraint_violation` with field-level details on constraint breach
- Trace record for every tools/call (success, error, timeout, rejected)
- create_intent auto-approve path: intent created -> policy evaluated -> authorized -> gates edge created
- create_intent veto path: intent created -> pending_veto -> gates edge created -> agent yields
- Observer resume: authorized intent + idle session -> adapter.resumeSession

### Walking Skeleton Scope

US-01 (tools/list) + US-02 (tools/call) + US-03 (create_intent, auto-approve only). Human veto and observer resume are Release 1.

---

## For Software Crafter (DELIVER Wave)

### Development Paradigm

Functional (per CLAUDE.md). Apply:
- Types-first: define algebraic data types before implementations
- Composition pipelines: data flows through pure transformation chains
- Pure core / effect shell: scope computation and tool classification are pure; DB queries and upstream calls at boundaries
- Function signatures as ports: `QuerySessionIntents`, `QueryGrantedTools`, `LookupProxyToken` are injected
- Immutable state: all types use `readonly`

### Module Structure

Seven new modules under `app/src/server/mcp/`:

| Module | Type | Dependencies |
|--------|------|-------------|
| `agent-mcp-route.ts` | Effect boundary | All handlers, auth |
| `agent-mcp-auth.ts` | Effect boundary | proxy-auth, SurrealDB |
| `scope-engine.ts` | Pure core + effect shell | rar-verifier (pure), tool-resolver, SurrealDB |
| `tools-list-handler.ts` | Pure | scope-engine types, error-builder |
| `tools-call-handler.ts` | Effect boundary | scope-engine, rar-verifier, mcp-client, trace-writer |
| `create-intent-handler.ts` | Effect boundary | intent-queries, authorizer, policy-gate |
| `error-response-builder.ts` | Pure | None |

### Key Reuse Points

- `resolveProxyAuth` from `proxy/proxy-auth.ts` for token -> session resolution
- `verifyOperationScope` from `oauth/rar-verifier.ts` for constraint enforcement (US-06)
- `evaluateIntent` from `intent/authorizer.ts` for policy + LLM evaluation
- `captureToolTrace` from `proxy/tool-trace-writer.ts` for trace recording
- `McpClientFactory.connect` + `callTool` from `tool-registry/mcp-client.ts` for upstream forwarding
- `resolveToolsForIdentity` from `proxy/tool-resolver.ts` for can_use grant resolution
- `adapter.resumeSession` from `orchestrator/sandbox-adapter.ts` for observer resume

### Gates Edge Direction

Existing schema: `DEFINE TABLE gates TYPE RELATION IN intent OUT agent_session`. Use `RELATE $intent->gates->$sess`. Query: `SELECT in.* FROM gates WHERE out = $session`.

### SurrealDB Protected Variables

Use `$sess` not `$session` for bound parameters (SurrealDB v3.0 reserves `$session`).

---

## For Platform Architect (DEVOPS Wave)

### Route Registration

New route `POST /mcp/agent/:sessionName` registered in `start-server.ts`. No new process, no new service.

### Schema Migration

None required. All tables exist.

### Observability

- OTel span via `withTracing` on the route handler
- Span attributes: `mcp.method`, `mcp.tool_name`, `mcp.outcome`, `mcp.intent_id`, `session.id`, `workspace.id`
- Trace records in SurrealDB for every tool call (audit trail)

### External Integration Contract Tests

Contract tests recommended for upstream MCP servers accessed via `McpClientFactory`. These are external integrations with the highest risk of breaking changes:
- Consumer-driven contracts via **Pact-JS** (MIT) in CI acceptance stage
- Priority: any upstream server where tool calls have financial or destructive side effects (e.g., Stripe, GitHub write operations)

### Architectural Enforcement

Recommended: `dependency-cruiser` (MIT) for import boundary validation in CI.

---

## Release Plan Summary

| Release | Stories | Key Components | Dependencies |
|---------|---------|---------------|-------------|
| Walking Skeleton | US-01, US-02, US-03 | agent-mcp-route, auth, scope-engine, handlers | sandbox-agent-integration R2, mcp_tool registry |
| R1: Yield-and-Resume | US-04, US-05 | Observer scan pattern, governance feed card | Walking Skeleton |
| R2: Constraints + Composites | US-06, US-07 | RAR verifier integration, composite action_spec | Walking Skeleton |
| R3: Hardening | US-08 | Scope cache, intent dedup, timeout handling | All above |
