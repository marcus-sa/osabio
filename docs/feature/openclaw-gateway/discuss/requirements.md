# Requirements — openclaw-gateway

## Functional Requirements

### FR-1: Gateway Protocol v3 Transport
Brain MUST expose a WebSocket endpoint at `/api/gateway` that implements the Gateway Protocol v3 frame format:
- Request frames: `{ type: "req", id: UUID, method: string, params?: object }`
- Response frames: `{ type: "res", id: string, ok: boolean, payload?: object, error?: { code, message, details } }`
- Event frames: `{ type: "event", event: string, payload?: object, seq?: number }`

**Traces to**: J1, J2, J5

### FR-2: Device Authentication
Brain MUST implement the Gateway Protocol v3 connect handshake:
1. Gateway sends `connect.challenge` event immediately on WebSocket open (with nonce + timestamp)
2. Client sends `connect` request with protocol version, role, scopes, auth token, and device identity (Ed25519 public key + signed nonce)
3. Brain verifies auth token, then Ed25519 signature against nonce
4. Success → resolve or create Brain identity → respond with `hello-ok` payload (protocol version, policy, device token, role, scopes)
5. Device auth error codes MUST use protocol-standard codes (`DEVICE_AUTH_NONCE_REQUIRED`, `DEVICE_AUTH_SIGNATURE_INVALID`, etc.)

**Traces to**: J2

### FR-3: Device Identity Bridge
Brain MUST bridge OpenClaw device identities to Brain identities:
- Known device (by fingerprint) → resolve existing `identity` record
- New device → auto-register via DCR (RFC 7591) → create `identity` + `member_of` edge
- Ed25519 key reuse for DPoP binding (`cnf.jkt` claim)

**Traces to**: J2

### FR-4: Workspace Resolution
After authentication, Brain MUST resolve the workspace from the device's `member_of` edge and load authority scopes (RAR `authorization_details`).

**Traces to**: J1, J3

### FR-5: Agent Method — Orchestrator Integration
The `agent` method MUST delegate to Brain's orchestrator pipeline:
1. Load graph context (decisions, constraints, observations)
2. Inject active learnings for the agent type
3. Evaluate policies via intent authorizer
4. Check budget against spend limits
5. Assign task to session
6. Return `{ status: "accepted", runId, sessionId }`

**Traces to**: J1, J3

### FR-6: Event Streaming
Brain MUST stream orchestrator events to the connected client as Gateway Protocol events:
- `agent_token` → `{ stream: "assistant", data: { delta: token } }`
- `agent_file_change` → `{ stream: "lifecycle", data: { phase: "file_change", ... } }`
- `agent_status` → `{ stream: "lifecycle", data: { phase: status } }`
- Events MUST include monotonically increasing `seq` numbers per connection

**Traces to**: J5

### FR-7: Exec Approval Flow
Brain MUST support `exec.approve` and `exec.deny` methods that delegate to the intent authorizer. Exec requests from agents MUST be forwarded to the client as events.

**Traces to**: J5

### FR-8: Session Management (sessions.* namespace)
Brain MUST implement the OpenClaw `sessions.*` methods:
- `sessions.list` — list active/completed sessions for the authenticated identity
- `sessions.history` — return hierarchical trace/transcript for a session
- `sessions.send` — cross-session messaging (deliver message to another active session)
- `sessions.patch` — update session properties mid-flight (model, thinking level)

For backward compatibility, `agent.status` and `agent.wait` are kept as aliases:
- `agent.wait` — poll for session completion (blocks until terminal state)
- `agent.status` — query current session state (non-blocking)

**Traces to**: J4, J5

### FR-8a: Tool Catalog
Brain MUST implement `tools.catalog` to return available MCP tools for the workspace. This maps to Brain's existing tool registry.

**Traces to**: J1

### FR-8b: Gateway Configuration
Brain MUST implement `config.get` as a read-only endpoint returning gateway capabilities and feature flags. `config.apply` and `config.patch` MUST return `method_not_supported`.

**Traces to**: J2

### FR-9: Policy Enforcement
All agent work submitted through the gateway MUST be evaluated against the workspace's policy graph before execution. Policy violations MUST return structured errors with policy ID and violation detail.

**Traces to**: J3

### FR-10: Budget Enforcement
Agent work MUST be checked against per-device/agent budget limits. Budget exceeded MUST return structured error with current spend and limit.

**Traces to**: J7

### FR-11: Native Trace Recording
All gateway-originated sessions MUST be recorded as native hierarchical traces in the graph, including: intent, session, tool calls, LLM completions, decisions, and observations.

**Traces to**: J4

### FR-12: Model Listing
The `model.list` method MUST return configured model providers without exposing API keys.

**Traces to**: J7

### FR-13: Presence Tracking
Brain MUST broadcast connection state (online/offline) for gateway-connected devices via the SSE registry.

**Traces to**: J6

### FR-14: Connection Resilience
Brain MUST handle WebSocket disconnects gracefully:
- Agent sessions MUST continue server-side after client disconnect
- Reconnecting clients MUST be able to resume via `agent.status`

**Traces to**: J5

## Non-Functional Requirements

### NFR-1: Zero Additional Latency
The gateway MUST NOT add measurable latency compared to direct Brain API calls. The WebSocket frame parsing and method dispatch overhead MUST be < 1ms.

### NFR-2: Protocol Compliance
Gateway Protocol v3 frames MUST be parseable by standard OpenClaw clients (CLI, web UI, macOS app, iOS/Android) without client modifications.

### NFR-3: Schema Minimalism
Implementation MUST require zero new SurrealDB tables. Only field additions to existing tables (`agent` table: `device_fingerprint`, `device_public_key`, `device_platform`, `device_family`).

### NFR-4: Observability
Gateway connections MUST produce OTel spans with:
- `gateway.connection_id`, `gateway.device_fingerprint`, `gateway.method`
- Standard HTTP attributes for the upgrade request
- Per-method span attributes following existing Brain conventions

### NFR-5: Security
- API keys MUST never be exposed to gateway clients
- Device auth MUST use cryptographic verification (Ed25519), not shared secrets
- WebSocket connections MUST be TLS-encrypted in production
- Nonces MUST be single-use and time-bounded

### NFR-6: Backward Compatibility
The gateway endpoint MUST coexist with existing Brain HTTP/SSE APIs. No existing endpoints are modified or removed.
