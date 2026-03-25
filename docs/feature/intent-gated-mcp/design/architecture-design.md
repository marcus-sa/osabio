# Architecture Design: Intent-Gated MCP Tool Access

## System Overview

Intent-gated MCP is a dynamic per-agent MCP endpoint that gates external tool calls behind intent authorization and policy evaluation. Sandbox coding agents (Claude Code, Codex) interact with Brain through this endpoint, which computes an effective tool scope from the agent's session-linked intents and either forwards authorized calls to upstream MCP servers or guides the agent through intent-based escalation.

The endpoint is a new route module within Brain's existing modular monolith, composing existing infrastructure: proxy auth, tool resolver, intent lifecycle, policy gate, RAR verifier, MCP client factory, and trace writer.

---

## C4 System Context (L1)

```mermaid
C4Context
  title System Context -- Intent-Gated MCP Tool Access

  Person(operator, "Human Operator", "Approves/vetoes high-risk intents via governance feed")
  Person(admin, "Workspace Admin", "Configures policies and tool grants")

  System_Ext(sandbox, "Sandbox Agent", "Coding agent (Claude Code, Codex) running in isolated sandbox")
  System(brain, "Brain", "Knowledge graph operating system with governed MCP endpoint")
  System_Ext(github_mcp, "GitHub MCP Server", "Upstream MCP server for GitHub operations")
  System_Ext(stripe_mcp, "Stripe MCP Server", "Upstream MCP server for Stripe operations")
  System_Ext(other_mcp, "Other MCP Servers", "Any registered upstream MCP server")

  Rel(sandbox, brain, "Sends tools/list, tools/call, create_intent via MCP protocol")
  Rel(brain, github_mcp, "Forwards authorized tool calls to")
  Rel(brain, stripe_mcp, "Forwards authorized tool calls to")
  Rel(brain, other_mcp, "Forwards authorized tool calls to")
  Rel(operator, brain, "Approves/vetoes intents via governance feed")
  Rel(admin, brain, "Configures policies and tool grants via UI")
```

---

## C4 Container (L2)

```mermaid
C4Container
  title Container Diagram -- Brain with Intent-Gated MCP

  Person(sandbox, "Sandbox Agent")
  Person(operator, "Human Operator")

  Container_Boundary(brain, "Brain Server (Bun)") {
    Container(agent_mcp, "Agent MCP Endpoint", "TypeScript", "Dynamic MCP endpoint: tools/list, tools/call, create_intent")
    Container(proxy_auth, "Proxy Auth", "TypeScript", "Resolves X-Brain-Auth token to session + identity")
    Container(scope_engine, "Scope Engine", "TypeScript", "Computes effective tool scope from gates edges + intents")
    Container(intent_system, "Intent System", "TypeScript", "Intent lifecycle, policy gate, authorizer, status machine")
    Container(mcp_client, "MCP Client Factory", "TypeScript", "Connects to and calls upstream MCP servers")
    Container(trace_writer, "Trace Writer", "TypeScript", "Records every tool call with provenance links")
    Container(observer, "Observer Agent", "TypeScript", "Detects authorized intents for idle sessions, triggers resume")
    Container(feed, "Governance Feed", "TypeScript + React", "Surfaces pending intents for human review")
    Container(tool_registry, "Tool Registry", "TypeScript", "Manages mcp_tool and mcp_server records")
  }

  ContainerDb(surreal, "SurrealDB", "Stores sessions, intents, gates edges, tools, traces")

  System_Ext(upstream, "Upstream MCP Servers", "GitHub, Stripe, Jira, etc.")

  Rel(sandbox, agent_mcp, "Sends MCP requests via X-Brain-Auth")
  Rel(agent_mcp, proxy_auth, "Authenticates request via")
  Rel(agent_mcp, scope_engine, "Computes effective scope via")
  Rel(agent_mcp, intent_system, "Creates and evaluates intents via")
  Rel(agent_mcp, mcp_client, "Forwards authorized calls via")
  Rel(agent_mcp, trace_writer, "Records every tool call via")
  Rel(scope_engine, surreal, "Queries gates edges and intent authorization_details from")
  Rel(intent_system, surreal, "Reads/writes intents and gates edges in")
  Rel(mcp_client, upstream, "Forwards JSON-RPC tool calls to")
  Rel(trace_writer, surreal, "Persists trace records in")
  Rel(observer, surreal, "Scans for authorized intents linked to idle sessions in")
  Rel(observer, agent_mcp, "Triggers session resume via adapter")
  Rel(operator, feed, "Reviews and approves/vetoes intents via")
  Rel(feed, surreal, "Reads pending intents from")
```

---

## C4 Component (L3) -- Agent MCP Endpoint

The Agent MCP Endpoint is the primary new subsystem with 6+ internal concerns, warranting a component diagram.

```mermaid
C4Component
  title Component Diagram -- Agent MCP Endpoint

  Container_Boundary(agent_mcp, "Agent MCP Endpoint") {
    Component(route, "agent-mcp-route", "TypeScript", "HTTP route handler: parses MCP JSON-RPC, dispatches to handlers")
    Component(auth, "agent-mcp-auth", "TypeScript", "Extracts proxy token, resolves session + identity + workspace")
    Component(scope, "scope-engine", "TypeScript", "Queries gates edges, unions authorization_details, classifies tools")
    Component(tools_list, "tools-list-handler", "TypeScript", "Builds MCP ListToolsResult with authorized vs gated classification")
    Component(tools_call, "tools-call-handler", "TypeScript", "Validates scope + constraints, forwards to upstream, records trace")
    Component(create_intent, "create-intent-handler", "TypeScript", "Creates intent, submits to policy gate, creates gates edge")
    Component(error_builder, "error-response-builder", "TypeScript", "Builds structured 403 intent_required with action_spec_template")
  }

  Container(proxy_auth, "Proxy Auth Module")
  Container(rar_verifier, "RAR Verifier")
  Container(intent_sys, "Intent System")
  Container(policy_gate, "Policy Gate")
  Container(mcp_factory, "MCP Client Factory")
  Container(trace_mod, "Trace Writer")
  ContainerDb(surreal, "SurrealDB")

  Rel(route, auth, "Delegates authentication to")
  Rel(auth, proxy_auth, "Resolves proxy token via")
  Rel(route, tools_list, "Dispatches tools/list to")
  Rel(route, tools_call, "Dispatches tools/call to")
  Rel(route, create_intent, "Dispatches create_intent to")
  Rel(tools_list, scope, "Computes effective scope via")
  Rel(tools_call, scope, "Checks tool authorization via")
  Rel(tools_call, rar_verifier, "Validates constraints via")
  Rel(tools_call, mcp_factory, "Forwards to upstream via")
  Rel(tools_call, trace_mod, "Records tool call trace via")
  Rel(tools_call, error_builder, "Builds 403 response via")
  Rel(create_intent, intent_sys, "Creates and submits intent via")
  Rel(create_intent, policy_gate, "Evaluates intent via")
  Rel(scope, surreal, "Queries gates edges from")
```

---

## Data Flow: Request Pipeline

Every request to the dynamic MCP endpoint follows this pipeline:

```
Request -> proxy_auth -> session_resolution -> scope_computation -> handler_dispatch
                                                                        |
                                    +-----------------------------------+
                                    |                |                  |
                              tools/list        tools/call        create_intent
                                    |                |                  |
                              classify tools    scope check +       create intent +
                              authorized vs     constraint          policy gate +
                              gated             validation          gates edge
                                    |                |                  |
                              ListToolsResult   forward to          intent status
                                                upstream MCP        response
                                                    |
                                              trace record
```

---

## Key Design Decisions (Preserved)

These decisions are carried forward from the DISCUSS wave and research. They are NOT new ADRs -- they are documented here for completeness.

### D1: No DPoP for sandbox agents

Sandbox agents authenticate via `X-Brain-Auth` proxy token only. The existing `proxy-auth.ts` already supports session and intent fields on `proxy_token`. No new auth mechanism needed.

**Rationale**: Sandbox agents are opaque processes that receive env vars. They cannot generate DPoP proofs (which require a private key and proof JWT generation per request). The proxy token is simpler and sufficient -- it binds to a session and workspace.

### D2: Proxy token with intent + session binding

The `proxy_token` table already has `intent` and `session` fields (added in sandbox-agent-integration R2). The Agent MCP endpoint uses `session` to resolve gates edges and compute effective scope.

### D3: Agent-driven escalation via create_intent tool

Two escalation mechanisms:
- **Proactive**: tools/list enriches gated tool descriptions with instructions to create an intent first
- **Reactive**: tools/call returns structured 403 `{ code: -32403, data: { tool, action_spec_template } }`

The agent calls `create_intent` MCP tool, which creates the intent, submits it through the policy gate, and returns the result.

### D4: Yield-and-resume, not polling

When `create_intent` returns `pending_veto`, the agent yields (session goes idle). The Observer detects the authorized intent and triggers `adapter.resumeSession`. The agent does NOT poll.

### D5: Intent accumulation via gates edges

A session accumulates intents over its lifetime. The `gates` relation (`intent -> agent_session`, per existing schema) links intents to sessions. Scope computation unions all authorized intents' `authorization_details`.

**Schema note**: The existing `gates` table is defined as `IN intent OUT agent_session`. This means the relation direction is `intent -gates-> agent_session`. Scope queries traverse: `SELECT in.* FROM gates WHERE out = $session AND in.status = "authorized"`.

### D6: Effective scope = can_use grants INTERSECT intent authorization_details

A tool must be BOTH:
1. Granted to the identity via `can_use` edge (tool registry level)
2. Covered by an authorized intent's `authorization_details` (runtime level)

Ungated tools (policy says no intent required for the action class) skip the intent check and are callable if granted.

---

## Integration Points

### Reused Existing Components

| Component | File | Reuse Type |
|-----------|------|-----------|
| Proxy auth | `proxy/proxy-auth.ts` | Direct -- resolveProxyAuth gives session + identity |
| RAR verifier | `oauth/rar-verifier.ts` | Direct -- verifyOperationScope for constraint enforcement |
| Intent lifecycle | `intent/status-machine.ts`, `intent-queries.ts` | Direct -- createIntent, updateIntentStatus |
| Intent authorizer | `intent/authorizer.ts` | Direct -- evaluateIntent for policy + LLM eval |
| Policy gate | `policy/policy-gate.ts` | Direct -- evaluatePolicyGate for rule matching |
| MCP client factory | `tool-registry/mcp-client.ts` | Direct -- connect + callTool for upstream forwarding |
| Tool resolver | `proxy/tool-resolver.ts` | Direct -- resolveToolsForIdentity for can_use grants |
| Trace writer | `proxy/tool-trace-writer.ts` | Extended -- captureToolTrace with intent linkage |
| Sandbox adapter | `orchestrator/sandbox-adapter.ts` | Direct -- adapter.resumeSession for observer resume |
| Governance feed | `feed/` | Extended -- new feed card type for MCP intent approval |

### New Components

| Component | Location | Purpose |
|-----------|----------|---------|
| Agent MCP route | `mcp/agent-mcp-route.ts` | HTTP handler for `/mcp/agent/:sessionName` |
| Agent MCP auth | `mcp/agent-mcp-auth.ts` | Proxy token to session resolution |
| Scope engine | `mcp/scope-engine.ts` | Effective scope computation from gates edges |
| Tools list handler | `mcp/tools-list-handler.ts` | MCP ListToolsResult builder |
| Tools call handler | `mcp/tools-call-handler.ts` | Scope check, constraint validation, upstream forwarding |
| Create intent handler | `mcp/create-intent-handler.ts` | Intent creation and policy evaluation |
| Error response builder | `mcp/error-response-builder.ts` | Structured 403 with action_spec_template |

---

## Quality Attribute Strategies

### Auditability (Priority 1)

Every `tools/call` -- success, failure, rejected, or constraint-violated -- produces a trace record in SurrealDB linked to the session and authorizing intent. The trace includes tool name, arguments, result, duration, and outcome. This uses the existing `captureToolTrace` pattern from `proxy/tool-trace-writer.ts`.

### Security (Priority 2)

- **Auth**: Proxy token resolves to workspace + identity + session. Invalid/expired/revoked tokens return 401.
- **Scope**: Effective scope is the intersection of can_use grants and authorized intent authorization_details.
- **Constraints**: RAR verifier enforces numeric bounds and string identity constraints before upstream forwarding.
- **Isolation**: Each sandbox agent has its own session; scope is per-session, not per-identity.

### Maintainability (Priority 3)

- Pure core / effect shell: scope computation, constraint verification, tool classification are pure functions. IO (DB queries, upstream calls, trace writes) happens at boundaries.
- Composition over inheritance: handlers compose existing modules via function calls.
- No new auth mechanism: reuses proxy-auth for sandbox agents, same pattern as existing proxy pipeline.

### Testability (Priority 4)

- All IO is injectable: SurrealDB queries via driven ports, upstream MCP via McpClientFactory, adapter via SandboxAgentAdapter.
- Pure functions (scope computation, constraint verification, tool classification) are unit-testable.
- Acceptance tests follow existing acceptance-test-kit pattern with isolated DB namespace.

### Time-to-Market (Priority 5)

- Walking skeleton (US-01 through US-03) reuses ~90% existing infrastructure.
- Release 1 (yield-and-resume) adds observer scan pattern using existing observer infrastructure.
- Release 2 (constraints + composites) reuses RAR verifier directly.
- Release 3 (hardening) is incremental improvements.

---

## Deployment Architecture

No deployment changes. The Agent MCP endpoint is a new route registered in `start-server.ts`, running in the same Bun process as all other Brain routes. SurrealDB schema changes are applied via `bun migrate`.

---

## External Integrations

The Agent MCP endpoint forwards tool calls to upstream MCP servers (GitHub, Stripe, Jira, etc.). These are external integrations accessed through the existing `McpClientFactory`.

**Contract tests recommended for upstream MCP servers** -- consumer-driven contracts (e.g., Pact-JS) to detect breaking changes in upstream MCP server responses before production. Priority targets: any upstream server where tool calls have financial or destructive side effects.

---

## Architectural Enforcement

Recommended tooling for enforcing the architecture:

- **Import linting**: Use `dependency-cruiser` (MIT, well-maintained) to enforce:
  - `mcp/scope-engine.ts` must NOT import from `http/` or `runtime/` (pure module)
  - `mcp/agent-mcp-route.ts` is the only file that imports from `mcp/tools-*-handler.ts`
  - No circular dependencies within `mcp/` modules
- **Test coverage gate**: Acceptance tests for every handler; unit tests for every pure function.
