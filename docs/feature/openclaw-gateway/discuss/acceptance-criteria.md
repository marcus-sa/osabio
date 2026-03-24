# Acceptance Criteria — openclaw-gateway

## Walking Skeleton (Release 0)

### Preconditions for Walking Skeleton
```gherkin
Given Brain is running with gateway enabled
And a test workspace "acme" exists in SurrealDB
And a hardcoded test identity "test-gateway-agent" exists
And "test-gateway-agent" has a member_of edge to workspace "acme"
And "test-gateway-agent" has authority scopes: [{ type: "brain_mcp", actions: ["*"] }]
```

### AC-0.1: WebSocket Gateway Endpoint
```gherkin
Given Brain is running
When a client sends an HTTP upgrade request to "/api/gateway"
Then Brain upgrades the connection to WebSocket
And assigns a connectionId to the connection
And the connection state is "connecting"
```

### AC-0.2: Agent Method — Thin Delegate
```gherkin
Given a WebSocket connection is established (skeleton: hardcoded identity)
And workspace "acme" has 2 decisions and 1 constraint
When the client sends: { type: "req", id: "<uuid>", method: "agent", params: { task: "implement auth" } }
Then Brain responds: { type: "res", id: "<uuid>", ok: true, payload: { runId: "<uuid>", sessionId: "<id>", contextSummary: { decisions: 2, constraints: 1, learnings: 0, observations: 0 } } }
And an agent session is created in workspace "acme"
```

### AC-0.3: Token Streaming
```gherkin
Given an active agent session via the gateway with runId "<runId>"
When the orchestrator produces an agent_token event with delta "Hello"
Then the client receives: { type: "event", event: "agent.stream", payload: { stream: "assistant", data: { delta: "Hello" } }, seq: 1 }
And subsequent events have monotonically increasing seq numbers
```

---

## Release 1: Authentication & Protocol

### AC-1.1: Gateway Protocol v3 Connect Handshake
```gherkin
Given a client with an Ed25519 key pair
When the client opens a WebSocket to "/api/gateway"
Then Brain immediately sends: { type: "event", event: "connect.challenge", payload: { nonce: "<base64>", ts: <epoch-ms> } }
When the client signs the nonce and sends: { type: "req", id: "<uuid>", method: "connect", params: {
  minProtocol: 3, maxProtocol: 3,
  client: { id: "<uuid>", version: "1.0", platform: "macos", mode: "remote" },
  role: "operator", scopes: ["operator.read", "operator.write"],
  auth: { token: "<gateway-token>" },
  device: { id: "<device-id>", publicKey: "<base64>", signature: "<base64>", signedAt: <epoch-ms>, nonce: "<nonce>" }
} }
Then Brain verifies the auth token and Ed25519 signature
And responds: { type: "res", ok: true, payload: { type: "hello-ok", protocol: 3, policy: { tickIntervalMs: 15000 }, auth: { deviceToken: "<token>", role: "operator", scopes: [...] } } }
```

### AC-1.2: Known Device Resolution
```gherkin
Given a device with fingerprint "dev-abc" is registered with identity "identity:marcus"
And "identity:marcus" has a member_of edge to workspace "acme"
When the device completes Ed25519 authentication
Then Brain resolves identity "identity:marcus"
And loads workspace "acme" with authority scopes
And responds: { type: "res", ok: true, payload: { workspace: "acme", identity: "marcus", scopes: [...] } }
And the connection state transitions to "authenticated"
```

### AC-1.3: New Device DCR
```gherkin
Given a device with fingerprint "dev-new" is NOT registered in Brain
When the device completes Ed25519 authentication
Then Brain creates an OAuth client via DCR with:
  | field                    | value                        |
  | client_name              | openclaw:device:dev-new      |
  | grant_types              | urn:ietf:params:oauth:grant-type:jwt-bearer |
  | dpop_bound_access_tokens | true                         |
And creates a Brain identity linked to the device
And creates a member_of edge to the configured default workspace
And responds with connect.ok including the new client_id
```

### AC-1.4: Protocol Frame Parsing
```gherkin
Given a WebSocket connection
When the client sends a valid request frame: { type: "req", id: "<uuid>", method: "agent", params: {...} }
Then Brain parses the frame and dispatches to the "agent" method handler
And responds with a valid response frame: { type: "res", id: "<uuid>", ok: true|false, ... }

When the client sends a malformed frame (missing type or id)
Then Brain responds: { type: "res", ok: false, error: { code: "invalid_frame", message: "..." } }
And the connection is NOT closed (protocol error, not connection error)
```

### AC-1.5: Connection State Machine
```gherkin
Given a new WebSocket connection
Then the connection state is "connecting"
And Brain sends a connect.challenge event immediately

When the client sends a "connect" frame with device identity and signed nonce
Then the connection state transitions to "authenticating"

When Brain verifies the signature and resolves identity/workspace
Then the connection state transitions to "active"
And Brain responds with hello-ok

When the connection is closed (by client or server)
Then the connection state transitions to "closed"
And all resources are cleaned up

When a client sends a method other than "connect" while in "connecting" state
Then Brain responds: { type: "res", ok: false, error: { code: "not_authenticated", message: "..." } }
And the connection remains open (protocol error, not fatal)

When a client sends "connect" while already in "active" state
Then Brain responds: { type: "res", ok: false, error: { code: "already_authenticated", message: "..." } }
And the connection remains open
```

---

## Release 2: Core Execution Pipeline

### AC-2.1: Full Orchestrator Pipeline
```gherkin
Given an authenticated connection in workspace "acme"
And workspace "acme" has:
  | entity     | count |
  | decisions  | 3     |
  | constraints| 2     |
  | learnings  | 1 (for agent type "openclaw") |
And an active policy with max_risk_level "medium" and budget_limit $10.00
When the client sends: { type: "req", method: "agent", params: { task: "implement rate limiting" } }
Then Brain responds: { type: "res", ok: true, payload: {
  runId: "<uuid>",
  sessionId: "<id>",
  contextSummary: { decisions: 3, constraints: 2, learnings: 1, observations: 0 },
  authorization: { policy_result: "pass", budget_result: "pass" }
} }
And an agent session is created and begins execution
```

### AC-2.2: Exec Approval
```gherkin
Given an active agent session via the gateway
When the agent requests exec approval for command "npm install express"
Then the client receives: { type: "event", event: "exec.request", payload: { command: "npm install express", requestId: "<uuid>" } }

When the client sends: { type: "req", method: "exec.approve", params: { requestId: "<uuid>" } }
Then Brain evaluates the exec intent via the authorizer
And the agent proceeds with execution

When the client sends: { type: "req", method: "exec.deny", params: { requestId: "<uuid>" } }
Then the agent receives the denial and does NOT execute
```

### AC-2.3: Session Management (sessions.*)
```gherkin
Given two agent sessions in workspace "acme" — one active, one completed
When the client sends: { type: "req", method: "sessions.list", params: { status: "all" } }
Then Brain responds with both sessions including runId, status, task, startedAt

Given an active agent session with runId "<runId>"
When the client sends: { type: "req", method: "agent.status", params: { runId: "<runId>" } }
Then Brain responds: { type: "res", ok: true, payload: { runId: "<runId>", status: "active", startedAt: "...", toolCalls: 3 } }

Given an agent session with runId "<runId>" in state "completed"
When the client sends: { type: "req", method: "agent.wait", params: { runId: "<runId>" } }
Then Brain responds immediately: { type: "res", ok: true, payload: { runId: "<runId>", status: "completed", result: {...} } }
```

### AC-2.4: Session History (sessions.history)
```gherkin
Given a completed agent session with runId "<runId>"
And the session made 5 tool calls and created 1 decision
When the client sends: { type: "req", method: "sessions.history", params: { runId: "<runId>" } }
Then Brain responds with the hierarchical trace:
  | level | count | type            |
  | root  | 1     | intent          |
  | child | 1     | agent_session   |
  | leaf  | 5     | tool_call       |
  | leaf  | 1     | decision_create |
  | leaf  | 1+    | llm_completion  |
```

### AC-2.5: Tool Catalog (tools.catalog)
```gherkin
Given workspace "acme" has 5 MCP tools registered across 2 servers
And the authenticated agent has been granted access to 3 of those tools
When a connected client sends: { type: "req", method: "tools.catalog", params: {} }
Then Brain responds: { type: "res", ok: true, payload: { tools: [{ name: "...", description: "...", server: "...", inputSchema: {...} }, ...] } }
And the response includes only the 3 tools the agent has access to (not all 5)
```

### AC-2.6: Unsupported Methods Return method_not_supported
```gherkin
When a connected client sends: { type: "req", method: "config.apply", params: {...} }
Then Brain responds: { type: "res", ok: false, error: { code: "method_not_supported", message: "config.apply is not supported by Brain gateway" } }
And the connection remains open
```

---

## Release 3: Governance & Multi-Agent

### AC-3.1: Policy Enforcement
```gherkin
Given an authenticated connection for identity "junior-dev"
And workspace has a policy: max_risk_level "low" for tier "junior"
When the agent submits work classified as risk_level "high"
Then Brain denies the intent
And responds: { type: "res", ok: false, error: { code: "policy_violation", details: { policy: "policy:<id>", rule: "max_risk_level", allowed: "low", actual: "high" } } }
```

### AC-3.2: Budget Enforcement
```gherkin
Given identity "coder" has budget_limit $5.00 and current spend $4.90
When the agent submits work via the gateway
Then Brain checks budget: $0.10 remaining
And responds: { type: "res", ok: false, error: { code: "budget_exceeded", details: { limit: 5.00, spent: 4.90, remaining: 0.10 } } }
```

### AC-3.3: Presence Tracking
```gherkin
Given devices "dev-001" and "dev-002" are connected to workspace "acme"
When a client sends: { type: "req", method: "presence", params: {} }
Then Brain responds: { type: "res", ok: true, payload: { devices: [{ id: "dev-001", status: "online", agentType: "code_agent" }, { id: "dev-002", status: "online", agentType: "architect" }] } }

When "dev-001" disconnects
Then connected clients receive: { type: "event", event: "presence.update", payload: { device: "dev-001", status: "offline" } }
```

### AC-3.4: Model Listing
```gherkin
Given workspace "acme" has models: claude-sonnet-4-6 (openrouter), claude-haiku-4-5 (openrouter)
When a connected client sends: { type: "req", method: "model.list", params: {} }
Then Brain responds: { type: "res", ok: true, payload: { models: [{ id: "claude-sonnet-4-6", provider: "openrouter" }, { id: "claude-haiku-4-5", provider: "openrouter" }] } }
And the response does NOT include API keys
```

### AC-3.5: Connection Resilience
```gherkin
Given an active agent session with runId "<runId>"
When the WebSocket disconnects unexpectedly
Then the agent session continues running server-side

When the client reconnects and authenticates
And sends: { type: "req", method: "agent.status", params: { runId: "<runId>" } }
Then Brain returns current session state
And the client can resume receiving events
```
