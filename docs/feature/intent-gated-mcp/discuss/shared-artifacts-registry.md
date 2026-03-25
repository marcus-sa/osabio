# Shared Artifacts Registry: Intent-Gated MCP

## Artifact Registry

### proxy_token
- **Source of truth**: `proxy_token` table in SurrealDB (fields: `token_hash`, `intent`, `session`, `identity`, `workspace`)
- **Owner**: sandbox-agent-integration R2 (step 04-03 in roadmap.json)
- **Consumers**:
  - Dynamic MCP endpoint auth (resolves identity + session from X-Brain-Auth header)
  - tools/list (session lookup for scope computation)
  - tools/call (session lookup + authorization)
- **Integration risk**: HIGH -- proxy token is the sole authentication mechanism for sandbox agents. If token does not resolve to session, all MCP calls fail.
- **Validation**: Token round-trip test: issue token -> resolve -> session ID matches

### agent_session
- **Source of truth**: `agent_session` table in SurrealDB
- **Owner**: orchestrator/session-store.ts
- **Consumers**:
  - MCP endpoint (session lookup from proxy token)
  - Observer (idle session detection for resume)
  - Governance feed (session context for intent display)
- **Integration risk**: MEDIUM -- session status must be consistent between orchestrator and MCP endpoint
- **Validation**: Session status transitions follow state machine; idle detection query returns correct sessions

### gates edge (agent_session -> intent)
- **Source of truth**: `gates` relation table in SurrealDB
- **Owner**: intent-gated-mcp (created when intent is linked to session)
- **Consumers**:
  - Scope computation (union of authorized intents' authorization_details)
  - Observer resume detection (authorized intent linked to idle session)
  - Trace provenance (which intent authorized which tool call)
- **Integration risk**: HIGH -- gates edge is the critical link between session scope and intent authorization. Missing edge = tool call rejected despite authorized intent.
- **Validation**: After create_intent, gates edge exists; scope computation finds the intent

### effective_scope (computed)
- **Source of truth**: Computed at request time from `gates` edges + `intent.authorization_details`
- **Owner**: intent-gated-mcp (scope computation module)
- **Consumers**:
  - tools/list (determines authorized vs gated tools)
  - tools/call (determines whether call is forwarded or rejected)
- **Integration risk**: HIGH -- must be consistent between tools/list and tools/call. If tools/list says "authorized" but tools/call rejects, agent enters infinite retry loop.
- **Validation**: Same scope computation function used by both tools/list and tools/call

### authorization_details (on intent)
- **Source of truth**: `intent.authorization_details` field (array of BrainAction)
- **Owner**: intent system (existing)
- **Consumers**:
  - Policy gate (evaluates constraints during intent authorization)
  - Scope computation (unioned across all session intents)
  - tools/call constraint validation (numeric bounds, string identity)
  - Trace recording (what was authorized vs what was requested)
- **Integration risk**: MEDIUM -- BrainAction schema must be consistent between intent creation, policy evaluation, and tool call validation
- **Validation**: Round-trip: create intent with authorization_details -> policy evaluates same details -> tools/call validates against same details

### action_spec_template
- **Source of truth**: Derived from `mcp_tool` registry entry (tool name, provider, parameter schema)
- **Owner**: intent-gated-mcp (403 response builder)
- **Consumers**:
  - 403 intent_required response (template included in error)
  - Agent's create_intent call (agent uses template to construct action_spec)
- **Integration risk**: MEDIUM -- template must produce action_spec that policy gate can evaluate. If template schema diverges from what policy expects, intent evaluation fails.
- **Validation**: Template-generated action_spec passes policy gate schema validation

### intent record
- **Source of truth**: `intent` table in SurrealDB
- **Owner**: intent system (existing infrastructure)
- **Consumers**:
  - Policy gate evaluation
  - Veto manager (pending_veto lifecycle)
  - Governance feed (display for human review)
  - Observer (state change detection)
  - Scope computation (authorization_details)
- **Integration risk**: LOW -- well-established existing infrastructure with tested state machine
- **Validation**: Existing intent lifecycle tests cover all transitions

## Integration Checkpoints

| Checkpoint | Components | Validation |
|-----------|-----------|-----------|
| Token-to-scope pipeline | proxy_token -> agent_session -> gates -> intent -> authorization_details | End-to-end: proxy token resolves to correct effective scope |
| tools/list-to-tools/call consistency | scope computation shared between both endpoints | Same function, same result for same session state |
| Intent-to-scope propagation | create_intent -> gates edge -> scope recomputation | After intent authorized, next tools/list and tools/call reflect new scope |
| Observer-to-resume pipeline | intent state change -> observer scan -> adapter.resumeSession | Observer detects authorized intent for idle session within scan interval |
| Trace completeness | tools/call -> trace record -> session + intent linkage | Every tool call (success, failure, rejected) produces linked trace |
