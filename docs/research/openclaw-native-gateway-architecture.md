# Research: Native OpenClaw Gateway in Brain

**Date**: 2026-03-21
**Research Question**: Should Brain implement the OpenClaw Gateway Protocol natively rather than connecting to external gateways as a client?

**Conclusion**: Yes. Brain should become a Gateway Protocol-compatible server. This eliminates an entire process from the architecture, reuses 80% of existing Brain infrastructure, and makes the entire OpenClaw ecosystem (300k+ GitHub stars) a distribution channel for Brain.

---

## 1. Background: Paperclip's OpenClaw Adapter

Paperclip manages OpenClaw as an external execution environment via an adapter pattern:

- **Adapter type**: `openclaw_gateway` registered in adapter registry
- **Transport**: WebSocket client implementing Gateway Protocol v3
- **Auth**: Ed25519 device identity with challenge-response signing (v3 payload format: `v3|{deviceId}|{clientId}|{clientMode}|{role}|{scopes}|{signedAtMs}|{token}|{nonce}|{platform}|{deviceFamily}`)
- **Session strategies**: `fixed` (single session key), `issue` (per-issue), `run` (per-run)
- **Join flow**: Invite creation → agent join request → board approval → one-time API key claim → wakeup callback
- **Wake payload**: Comprehensive instruction packet with `PAPERCLIP_RUN_ID`, `PAPERCLIP_TASK_ID`, `PAPERCLIP_WAKE_REASON` env vars

Paperclip treats OpenClaw as a black box — it sends work in and gets results back. Brain can do better by becoming the gateway itself.

---

## 2. Architecture Decision: Brain as Gateway vs. Brain as Client

### Option A: Brain as Gateway Protocol Client (rejected)

Brain connects to one or more external OpenClaw gateways as an `operator` role WebSocket client, monitors sessions, extracts decisions from chat, and proxies LLM calls.

```
OpenClaw Agent → OpenClaw Gateway → LLM Provider
                      ↑
                Brain (WS client, operator.read + operator.write)
                      ├─ Extract from chat
                      ├─ Proxy LLM calls
                      └─ Evaluate exec approvals
```

**Problems:**
- Three moving parts (client + gateway + provider) instead of two
- Two auth systems to bridge (Ed25519 device auth + Brain DPoP)
- Context injection requires LLM proxy interception — extra hop, extra latency
- Trace recording is reconstruction from proxy logs, not native
- Protocol coupling — Brain must track OpenClaw's protocol evolution as a client
- Requires an OpenAI-compatible proxy endpoint (Brain's proxy currently speaks Anthropic format)

### Option B: Brain as Gateway Protocol Server (recommended)

Brain implements the server side of the Gateway Protocol. OpenClaw clients (CLI, web UI, macOS app, iOS/Android, Mission Control) connect directly to Brain.

```
OpenClaw CLI / Web UI / Mobile / Mission Control
  │
  └─ WebSocket (Gateway Protocol v3)
       │
       ▼
  Brain Gateway Endpoint (/api/gateway)
  ├─ Device auth → Brain identity
  ├─ connect     → workspace resolution
  ├─ agent       → orchestrator.assign + run
  ├─ agent.wait  → session status poll
  ├─ chat.send   → chat agent
  ├─ exec.*      → intent authorizer
  └─ LLM Provider (direct, no proxy hop)
```

**Advantages:**
- Two moving parts (client + Brain)
- One auth system (Brain's, with device auth bridge)
- Context injection is native — Brain builds the prompt
- Trace recording is native — Brain runs the agent
- Policy enforcement is native — Brain evaluates before execution
- Brain defines the contract as server, not tracking it as client
- Zero additional latency
- Entire OpenClaw ecosystem becomes Brain clients

---

## 3. Gateway Protocol v3 — Method Mapping to Brain

The Gateway Protocol is WebSocket-based with JSON text frames. Three frame types:

| Frame | Format |
|-------|--------|
| Request | `{ type: "req", id: UUID, method: string, params?: object }` |
| Response | `{ type: "res", id: string, ok: boolean, payload?: object, error?: { code, message, details } }` |
| Event | `{ type: "event", event: string, payload?: object, seq?: number }` |

### Method → Brain System Mapping

| Gateway Method | Brain System | Exists | Work |
|---------------|--------------|--------|------|
| `connect` | Auth + workspace resolution | Yes | Wire device auth → identity |
| `agent` (submit work) | Orchestrator `assignTask()` | Yes | Gateway event bridge |
| `agent.wait` | Session status polling | Yes | Map session status → protocol response |
| `agent.status` | Session lifecycle query | Yes | Query `agent_session` table |
| `agent.history` | Trace graph query | Yes | Query hierarchical traces |
| `chat.send` | Chat agent `runChatAgent()` | Yes | WebSocket event adapter |
| `exec.approve` / `exec.deny` | Intent `authorizer.evaluate()` | Yes | Map exec requests → intents |
| `device.pair.*` | DPoP + DCR | Partial | Device registration flow |
| `device.token.rotate` | Token rotation | Partial | DPoP token refresh |
| `presence` | SSE registry (online/offline) | Yes | Broadcast connection state |
| `model.list` | Provider config | Yes | Return configured models |

Brain already has ~80% of the business logic. The missing piece is WebSocket transport and protocol framing.

---

## 4. Implementation: New Domain `app/src/server/gateway/`

```
gateway/
  protocol.ts              # Frame types, method registry, protocol constants
  gateway-route.ts         # WebSocket upgrade handler (Bun native)
  connection.ts            # Per-connection state machine + auth context
  device-auth.ts           # Ed25519 challenge-response verification
  event-emitter.ts         # Brain events → Gateway Protocol events
  method-handlers/
    connect.ts             # → workspace resolution + identity creation
    agent.ts               # → orchestrator.assign()
    agent-wait.ts          # → session status poll
    chat.ts                # → runChatAgent()
    exec-approval.ts       # → authorizer.evaluate()
    device.ts              # → DCR + device management
    models.ts              # → provider model listing
    status.ts              # → session queries
```

### WebSocket Upgrade (Bun native)

Bun has built-in WebSocket support — no new dependencies:

```typescript
// gateway-route.ts
export function handleGatewayUpgrade(
  req: Request,
  server: Server,
  deps: ServerDependencies
): Response | undefined {
  const url = new URL(req.url);
  if (url.pathname !== "/api/gateway") return;

  const upgraded = server.upgrade(req, {
    data: { deps, connectionId: crypto.randomUUID() },
  });

  return upgraded ? undefined : new Response("Upgrade failed", { status: 400 });
}

// In start-server.ts:
Bun.serve({
  fetch: handleRequest,
  websocket: {
    open: onGatewayOpen,
    message: onGatewayMessage,
    close: onGatewayClose,
  },
});
```

### Method Handler Pattern

Each handler is a thin delegate to existing Brain systems:

```typescript
// method-handlers/agent.ts
async function handleAgent(
  conn: GatewayConnection,
  params: AgentParams,
  deps: ServerDependencies
): Promise<AgentResponse> {
  const { workspace, identity } = conn.auth;

  // Map to orchestrator assignment
  const session = await assignTask({
    workspaceId: workspace.id,
    taskId: params.sessionKey,
    agentConfig: conn.agentDefaults,
    deps,
  });

  // Bridge orchestrator events → gateway protocol events
  session.onEvent((event) => {
    if (event.type === "agent_token") {
      conn.sendEvent("agent", {
        stream: "assistant",
        data: { delta: event.token },
      });
    }
  });

  return { status: "accepted", runId: session.id };
}
```

Each method handler is 30-60 lines. The protocol layer is thin.

### Gateway Protocol Event Format

Events streamed to OpenClaw clients follow the established format:

```
[openclaw-gateway:event] run=<runId> stream=<stream> data=<json>
```

Stream types:
- **assistant**: LLM output (delta or text)
- **error**: Execution errors
- **lifecycle**: Phase changes (error, failed, cancelled)

Brain's orchestrator Event Bridge (`orchestrator/event-bridge.ts`) already transforms Claude Agent SDK messages to `StreamEvent` variants. The gateway event emitter maps these to protocol events:

| Brain StreamEvent | Gateway Event |
|-------------------|---------------|
| `agent_token` | `{ stream: "assistant", data: { delta: token } }` |
| `agent_file_change` | `{ stream: "lifecycle", data: { phase: "file_change", ... } }` |
| `agent_status` | `{ stream: "lifecycle", data: { phase: status } }` |

---

## 5. Auth Integration: OAuth 2.1, DPoP, and DCR

### The Auth Problem

Two directions of auth collapse into one when Brain is the gateway:

| Direction | Old (Brain as client) | New (Brain as gateway) |
|-----------|----------------------|----------------------|
| Client → Gateway | Ed25519 device auth (OpenClaw) | Ed25519 device auth → Brain identity |
| Client → Brain | DPoP-bound tokens (separate) | Same connection, same identity |

### Device Auth → DPoP Identity Bridge

When an OpenClaw client connects:

1. Client sends `connect` frame with device public key
2. Brain sends `connect.challenge` event with nonce
3. Client signs nonce with Ed25519 private key
4. Brain verifies signature

Then:

```
Known device?
  → Resolve existing Brain identity from device fingerprint
  → Load workspace membership, authority scopes

New device?
  → DCR flow (RFC 7591):
    POST /api/oauth/register (internal)
    {
      "client_name": "openclaw:device:<fingerprint>",
      "grant_types": ["urn:ietf:params:oauth:grant-type:jwt-bearer"],
      "scope": "mcp:read mcp:write",
      "software_id": "openclaw-gateway:<device-id>",
      "dpop_bound_access_tokens": true
    }
  → Create Brain identity linked to device
  → Create workspace membership (member_of edge)
  → Issue DPoP-bound token internally
  → Return hello-ok with workspace context
```

After connect, the WebSocket connection carries the DPoP-equivalent auth for the session lifetime. Every method call inherits the connection's identity — no per-request DPoP proofs needed over WebSocket.

### Key Reuse: Ed25519 → DPoP

OpenClaw already has per-device Ed25519 keys. Brain can accept the same key for DPoP binding:

- Device auth: Ed25519 sign challenge nonce → prove device identity
- DPoP binding: Same Ed25519 key → JWK thumbprint in `cnf.jkt` claim
- One key pair, two protocols

### DCR: Automatic Agent Registration

When Brain discovers agents via a gateway connection, it can auto-register each as an OAuth client:

```json
{
  "client_name": "openclaw:agent:architect",
  "grant_types": ["urn:ietf:params:oauth:grant-type:jwt-bearer"],
  "scope": "mcp:read mcp:write",
  "software_id": "openclaw-gateway:<gateway-id>",
  "software_version": "3.0",
  "dpop_bound_access_tokens": true
}
```

Each agent gets a `client_id` + DPoP key pair. No manual `brain init` per agent.

### RAR: Fine-Grained Authorization

RAR (RFC 9396) carries permissions in `authorization_details`:

```json
{
  "authorization_details": [
    {
      "type": "brain_mcp",
      "actions": ["get_context", "create_observation", "resolve_decision"],
      "locations": ["workspace:<ws-id>"],
      "datatypes": ["decision", "observation", "task"]
    },
    {
      "type": "brain_intent",
      "actions": ["create", "evaluate"],
      "max_risk_level": "low",
      "budget_limit_usd": 5.00
    }
  ]
}
```

Maps directly to Brain's existing authority scope model. The gateway registration UI configures what each device/agent tier can do, RAR carries it into the token.

### Token Claims

DPoP-bound tokens for gateway connections carry:

| Claim | Purpose |
|-------|---------|
| `urn:brain:workspace` | Workspace scope (existing) |
| `urn:brain:gateway` | Gateway device fingerprint |
| `urn:brain:agent` | Agent name within gateway |
| `cnf.jkt` | DPoP key binding (Ed25519 thumbprint) |

---

## 6. LLM Proxy: Native, Not Intercepted

When Brain is the gateway, there is no LLM proxy hop. Brain directly calls the provider:

```
OpenClaw Agent submits work via gateway protocol
  │
  ▼
Brain orchestrator runs the agent
  │
  ├─ 1. Load graph context (BM25 + recency ranking)
  ├─ 2. Inject active learnings for agent type
  ├─ 3. Evaluate policies (intent → policy graph)
  ├─ 4. Check budget (token salary enforcement)
  ├─ 5. Build prompt with enriched context
  ├─ 6. Call LLM provider directly (Brain holds API keys)
  ├─ 7. Stream response tokens → gateway protocol events
  ├─ 8. Record trace in graph (native, not reconstructed)
  ├─ 9. Update spend tracking
  └─ 10. Feed extraction pipeline (decisions, observations)
```

### What Brain Sees

| Signal | Without gateway | With native gateway |
|--------|----------------|-------------------|
| What agents are thinking | Nothing | Full prompt + completion |
| Token spend per agent | Nothing | Exact counts, per-model |
| Policy violations | Nothing | Caught before execution |
| Context coherence | Nothing | Brain injects graph state |
| Cross-agent contradictions | Nothing | Observer scans extracted decisions |
| Execution traces | Nothing | Graph-native call trees |
| Budget enforcement | Nothing | Hard limits per agent salary |

### Brain Auth Mode ("brain" mode)

Brain holds the upstream API keys. Agents authenticate to Brain via device auth / DPoP, Brain authenticates to providers with its own credentials:

- Agents never see provider API keys (Judge pattern)
- Brain controls which models agents can use (policy-enforced)
- Brain can revoke access instantly by revoking the DPoP token
- Spend is tracked and enforced centrally
- One API key relationship to manage, not N per agent

### Multi-Provider Routing

Brain's provider-agnostic backend supports routing:

```
OpenClaw Agent requests "openai/gpt-5.2"
  → Brain policy says "use claude-sonnet for this workspace"
  → Brain transparently routes to Anthropic
  → Agent gets response in OpenAI-compatible format
```

---

## 7. SurrealDB Schema: Mapping to Existing Tables

The core gateway flow requires **zero new tables** — it maps directly to Brain's existing `identity`, `agent`, and `agent_session` tables. Only one enum extension is needed.

### `identity` (type: `'agent'`) — OpenClaw Device

An OpenClaw device connecting to Brain creates an `identity` record. The existing schema handles this without modification:

```
identity
  ├─ name: "openclaw:cli:marcus-macbook"    ← device label
  ├─ type: "agent"                           ← existing enum value
  ├─ role: "operator"                        ← gateway role
  ├─ workspace: record<workspace>            ← resolved during connect
  ├─ managed_by: "openclaw_gateway"          ← free-form string, distinguishes source
  ├─ identity_status: "active" | "revoked"   ← device revocation
  └─ revoked_at: option<datetime>            ← token revocation timestamp
```

The `managed_by` field is already a free-form string. Setting it to `"openclaw_gateway"` is sufficient to identify OpenClaw-originated identities. The `member_of` relation edge to workspace is created during DCR auto-registration — the DPoP middleware already checks this edge.

### `agent` (agent_type: `'openclaw'`) — OpenClaw Agent + Device Identity

Each OpenClaw agent within a gateway maps to an `agent` record. The `agent` table is the right place for device metadata — it describes *how* and *where* the agent runs, which is exactly what device fingerprint, platform, and key material describe. The `identity` stays clean as the actor.

**Schema changes required:**

```sql
-- Migration: add openclaw agent type + device fields
ALTER FIELD agent_type ON agent TYPE string
  ASSERT $value IN ['code_agent', 'architect', 'management', 'design_partner', 'observer', 'chat_agent', 'mcp', 'openclaw'];

DEFINE FIELD device_fingerprint ON agent TYPE option<string>;
DEFINE FIELD device_public_key ON agent TYPE option<string>;
DEFINE FIELD device_platform ON agent TYPE option<string>;
DEFINE FIELD device_family ON agent TYPE option<string>;
DEFINE INDEX agent_device_fingerprint ON agent FIELDS device_fingerprint;
```

Record mapping:

```
agent
  ├─ agent_type: "openclaw"                  ← new enum value
  ├─ model: "openai/gpt-5.2"                ← from gateway config
  ├─ description: "Architect agent via OpenClaw gateway"
  ├─ managed_by: record<identity>            ← the owning identity
  ├─ device_fingerprint: "<sha256-of-pubkey>" ← stable across reconnects
  ├─ device_public_key: "<ed25519-pem>"       ← for challenge verification
  ├─ device_platform: "macos"                 ← from connect frame
  ├─ device_family: "cli"                     ← cli / web / mobile / headless
  └─ created_at: datetime
```

**Reconnect lookup** — find returning device by fingerprint:

```sql
SELECT * FROM agent WHERE device_fingerprint = $fp LIMIT 1;
```

Then resolve identity via the relation:

```sql
SELECT in AS identity FROM identity_agent WHERE out = $agent;
```

Known device → reuse agent + identity. Unknown → DCR flow creates both.

### `identity_agent` (relation) — Unchanged

Links the device identity to the agent record, exactly as MCP and chat agents work today:

```
identity:device-xxx ──identity_agent──→ agent:openclaw-architect
```

### `agent_session` — Unchanged Schema

Every OpenClaw `agent` method call creates a session. The existing fields map 1:1:

| Gateway Protocol Concept | `agent_session` Field | Notes |
|--------------------------|----------------------|-------|
| `idempotencyKey` (runId) | `external_session_id` | Already exists for this purpose |
| `sessionKey` | `task_id` (resolved) | `"task:xxx"` or `"paperclip:issue:xxx"` → lookup task |
| Run status | `orchestrator_status` | Same state machine: spawning → active → completed |
| Streaming | `stream_id` | Routes events to the right WebSocket connection |
| Agent output | `summary` | Collected from assistant stream chunks |
| Trigger | `triggered_by` | Links to observation/task that caused the wake |
| Agent name | `agent` | String, e.g. `"openclaw:architect"` |
| Source | `source` | `"openclaw_gateway"` |

Example record:

```
agent_session
  ├─ agent: "openclaw:architect"
  ├─ workspace: workspace:xxx
  ├─ task_id: task:xxx                       ← resolved from sessionKey
  ├─ source: "openclaw_gateway"
  ├─ external_session_id: "<gateway-run-id>" ← maps to idempotencyKey
  ├─ orchestrator_status: "active"           ← existing state machine
  ├─ stream_id: "<uuid>"                     ← for event routing
  └─ ...decisions_made, files_changed, etc.  ← populated as agent works
```

### Session Key → Task Resolution

OpenClaw sends session keys in various formats. Brain resolves these to task records:

| Session Key Pattern | Resolution |
|--------------------|------------|
| `"task:<id>"` | Direct task lookup |
| `"paperclip:issue:<id>"` | Strip prefix → task lookup |
| `"paperclip:run:<id>"` | Ephemeral session, no task binding |
| Freeform text | BM25 search against tasks (existing `intent-context.ts` pattern) |

### `trace` — Unchanged

Agent execution creates hierarchical traces via the existing `invoked` relation:

```
agent_session:xxx ──invoked──→ trace:root
                                 ├─ trace:tool-call-1
                                 ├─ trace:llm-call-1
                                 └─ trace:tool-call-2
```

The `trace.actor` field points to `identity:device-xxx`.

### Schema Change Summary

| Change | Type | Required |
|--------|------|----------|
| Add `'openclaw'` to `agent.agent_type` ASSERT | Migration | Yes |
| Add `device_fingerprint` on `agent` | Migration | Yes |
| Add `device_public_key` on `agent` | Migration | Yes |
| Add `device_platform` on `agent` | Migration | Yes |
| Add `device_family` on `agent` | Migration | Yes |
| Add `agent_device_fingerprint` index | Migration | Yes |
| All other tables (`identity`, `agent_session`, `trace`, relations) | Unchanged | — |
| New tables | None | — |

---

## 8. End-to-End Flow

### First Connection (New Device)

```
1. User runs: openclaw connect ws://brain.local:3000/api/gateway

2. WebSocket upgrade succeeds

3. Client sends connect frame:
   { type: "req", id: "...", method: "connect", params: {
     device: { id: "<fingerprint>", publicKey: "<ed25519-pub>", platform: "macos", family: "cli" },
     role: "operator", scopes: ["operator.read", "operator.write"],
     minProtocol: 3, maxProtocol: 3
   }}

4. Brain sends challenge:
   { type: "event", event: "connect.challenge", payload: { nonce: "<random>" } }

5. Client signs nonce, sends response

6. Brain verifies signature
   → New device: DCR auto-registration
   → Creates identity + workspace membership
   → Issues internal DPoP-bound token

7. Brain sends hello-ok:
   { type: "res", id: "...", ok: true, payload: {
     protocol: 3, tickIntervalMs: 15000,
     workspace: { id: "...", name: "..." },
     capabilities: ["agent", "chat", "exec", "models"]
   }}
```

### Agent Execution

```
1. Client sends agent request:
   { type: "req", id: "...", method: "agent", params: {
     idempotencyKey: "<run-id>",
     sessionKey: "task:implement-rate-limiting",
     message: "Implement rate limiting for the API"
   }}

2. Brain orchestrator:
   → Resolves task from sessionKey
   → Loads graph context (decisions, constraints, observations)
   → Injects active learnings
   → Evaluates policies
   → Checks budget
   → Spawns agent execution

3. Brain sends accepted:
   { type: "res", id: "...", ok: true, payload: { status: "accepted" } }

4. Brain streams events:
   { type: "event", event: "agent", payload: { stream: "assistant", data: { delta: "I'll start by..." } } }
   { type: "event", event: "agent", payload: { stream: "assistant", data: { delta: "adding the rate..." } } }
   ...

5. Client polls or waits for completion:
   { type: "req", id: "...", method: "agent.wait", params: { runId: "<run-id>" } }

6. Brain responds with result:
   { type: "res", id: "...", ok: true, payload: {
     runId: "...", status: "completed",
     meta: { tokensUsed: 4521, tracesRecorded: 3, decisionsExtracted: 1 }
   }}
```

### Exec Approval (Intent Bridge)

```
1. Agent needs to run a destructive command
   → Brain creates intent:
     { action: "shell:rm -rf /tmp/build", requester: "openclaw:architect", riskLevel: "medium" }

2. Brain evaluates against policy graph
   → Policy requires human approval for medium+ risk

3. Brain sends exec approval event to connected operator clients:
   { type: "event", event: "exec.approval.request", payload: {
     approvalId: "...", command: "rm -rf /tmp/build", riskLevel: "medium",
     policyRef: "policy:no-destructive-without-approval"
   }}

4. Operator approves via CLI/UI:
   { type: "req", method: "exec.approve", params: { approvalId: "..." } }

5. Brain records approval in intent graph
   → Intent status: pending_auth → authorized
   → Agent execution continues
```

---

## 9. Build Order

| Phase | What | Depends On | Effort |
|-------|------|-----------|--------|
| 1 | WebSocket handler + protocol framing | Bun.serve() | S |
| 2 | Device auth (Ed25519 challenge-response) | crypto | M |
| 3 | `connect` → workspace resolution + identity | Auth layer | M |
| 4 | `agent` → orchestrator bridge | Orchestrator | M |
| 5 | Event emitter (orchestrator → protocol events) | SSE registry pattern | S |
| 6 | `agent.wait` → session polling | Session lifecycle | S |
| 7 | `chat.send` → chat agent bridge | Chat handler | S |
| 8 | `exec.approve` → intent authorizer | Intent system | M |
| 9 | DCR auto-registration | Better Auth + DPoP | L |
| 10 | Device management (pair, revoke, rotate) | DCR | M |
| 11 | `model.list` → provider config | Config | S |
| 12 | Presence broadcasting | SSE registry | S |
| 13 | SurrealDB migration (gateway + device tables) | Schema | S |
| 14 | Gateway management UI | Frontend | L |
| 15 | Compatibility testing (OpenClaw CLI + web UI) | All above | L |

**MVP (phases 1-6)**: An OpenClaw CLI connects to Brain, submits work, gets streamed responses. Proves the concept.

**Production (phases 1-13)**: Full protocol support with auth, exec approvals, and persistence.

**Polish (phases 14-15)**: UI and ecosystem compatibility.

---

## 10. What This Unlocks

**For OpenClaw users**: Point your CLI at Brain instead of a standalone gateway. Shared memory, policy governance, and spend tracking for free. Everything else works the same.

```bash
# Before
openclaw gateway --port 18789

# After — Brain IS the gateway
openclaw connect ws://brain.local:3000/api/gateway
```

**For Brain**: The entire OpenClaw ecosystem becomes the distribution channel. 300k+ GitHub stars worth of users can connect without changing their tools. Mission Control (2.4k stars) works out of the box.

**For the architecture**: One process, one auth system, one graph. No bridging, no proxying, no protocol translation. Brain's existing orchestrator, chat agent, intent system, observer, and extraction pipeline all serve OpenClaw clients natively.

---

## Sources

- [OpenClaw Gateway Protocol docs](https://docs.openclaw.ai/gateway/protocol)
- [OpenClaw Multiple Gateways docs](https://docs.openclaw.ai/gateway/multiple-gateways)
- [OpenClaw Mission Control (GitHub, 2.4k stars)](https://github.com/abhi1693/openclaw-mission-control)
- Paperclip OpenClaw adapter: `packages/adapters/openclaw-gateway/src/server/execute.ts`
- Brain orchestrator: `app/src/server/orchestrator/`
- Brain intent authorizer: `app/src/server/intent/authorizer.ts`
- Brain DPoP middleware: `app/src/server/auth/dpop-middleware.ts`
- Brain proxy: `app/src/server/proxy/anthropic-proxy-route.ts`
- Brain SSE registry: `app/src/server/streaming/sse-registry.ts`
