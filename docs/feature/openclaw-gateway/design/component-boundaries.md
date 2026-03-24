# Component Boundaries — openclaw-gateway

## Domain Boundary

The gateway is a new domain at `app/src/server/gateway/`. It follows Brain's existing domain pattern: a route file registers HTTP/WS handlers, and internal modules handle business logic via injected dependencies.

## File Layout

```
app/src/server/gateway/
  index.ts                    # Public API: registerGatewayHandlers(server, deps)
  protocol.ts                 # Frame types + parse/serialize (PURE)
  connection.ts               # Connection state machine (PURE core + effect shell)
  device-auth.ts              # Ed25519 challenge-response (EFFECT boundary)
  identity-bridge.ts          # Device → Brain identity resolution (EFFECT boundary)
  event-adapter.ts            # StreamEvent → Gateway Protocol event (PURE)
  method-dispatch.ts          # Method routing table (PURE)
  types.ts                    # Shared gateway types

  method-handlers/
    connect.ts                # → device auth + workspace resolution + hello-ok
    agent.ts                  # → orchestrator.assign() (two-stage completion)
    sessions.ts               # → sessions.list, sessions.history, sessions.send, sessions.patch
    chat.ts                   # → runChatAgent() [Release 4]
    exec-approval.ts          # → exec.approve, exec.deny, exec.approval.resolve
    device.ts                 # → device.token.rotate/revoke, device.pair.* [Release 4]
    models.ts                 # → model.list (provider listing)
    tools-catalog.ts          # → tools.catalog (MCP tool registry query)
    config.ts                 # → config.get (read-only gateway config)
    presence.ts               # → presence query + broadcast
```

## Component Responsibilities

### protocol.ts (PURE)
- Define algebraic types: `GatewayFrame = RequestFrame | ResponseFrame | EventFrame`
- `parseFrame(raw: string): GatewayFrame | ParseError` — pure parser
- `serializeFrame(frame: GatewayFrame): string` — pure serializer
- Method registry: `MethodName` union type
- Protocol constants: version, error codes

**Depends on**: Nothing (leaf module)

### connection.ts (PURE core)
- `ConnectionState = "connecting" | "authenticating" | "active" | "closed"`
- `GatewayConnection`: per-connection context (state, identity, workspace, seq counter, auth context)
- `transition(state, event): { nextState, effects[] }` — pure state machine
- Effect execution happens at the boundary (gateway-route.ts)

**Depends on**: `protocol.ts` (frame types), `types.ts`

### device-auth.ts (EFFECT boundary)
- `verifyEd25519Signature(publicKey, nonce, signature): Promise<boolean>` — crypto.subtle
- `computeDeviceFingerprint(publicKey): Promise<string>` — SHA-256 hash
- `generateChallenge(): { nonce: string, expiresAt: number }` — crypto.randomBytes

**Depends on**: Web Crypto API (runtime)

### identity-bridge.ts (EFFECT boundary)
- `resolveDeviceIdentity(fingerprint, deps): Promise<ResolvedIdentity | undefined>` — DB query
- `registerNewDevice(publicKey, fingerprint, platform, family, deps): Promise<RegisteredDevice>` — DCR + DB writes
- Ports: `Surreal` for DB, auth deps for DCR

**Depends on**: `device-auth.ts` (fingerprint), Brain auth domain (DCR), SurrealDB

### event-adapter.ts (PURE)
- `mapStreamEventToGatewayEvent(event: StreamEvent, seq: number): GatewayEventFrame | undefined`
- Maps `AgentTokenEvent` → assistant stream, `AgentFileChangeEvent` → lifecycle stream, etc.
- Returns `undefined` for Brain-internal events that have no gateway mapping
- Exhaustiveness: every `StreamEvent` variant must be listed as mapped or dropped (see data-models.md)

**Depends on**: `protocol.ts` (frame types), `StreamEvent` type from shared contracts

### Event Subscription Pattern

The gateway subscribes to orchestrator `StreamEvent` streams via an async iterator port:

```typescript
// Port in GatewayDeps
subscribeToSessionEvents: (sessionId: string) => AsyncIterable<StreamEvent>
```

**Implementation**: The `agent` method handler calls `subscribeToSessionEvents(sessionId)` after `assignTask()` succeeds. This returns an `AsyncIterable<StreamEvent>` that the handler consumes in a `for await` loop, mapping each event via `mapStreamEventToGatewayEvent()` and sending the result on the WebSocket.

**Relationship to SSE registry**: The SSE registry and gateway subscription are independent consumers of the same event source. The orchestrator's `startEventIteration()` emits events to a broadcast channel. The SSE registry is one subscriber (for HTTP SSE clients). The gateway connection is another subscriber (for WebSocket clients). Both receive the same events; neither blocks the other.

**Backpressure**: If the WebSocket client is slow (send buffer fills), the gateway buffers up to 1000 events per connection. If the buffer overflows, the oldest events are dropped and a `seq` gap signals the client to request catch-up via `agent.status`.

**Lifetime**: The async iterator completes when the agent session reaches a terminal state (`completed`, `aborted`, `error`). The gateway sends a final `DoneEvent` frame and removes the session from `activeSessions`.

### method-dispatch.ts (PURE)
- `dispatchMethod(method: MethodName): MethodHandler`
- Routing table: `Record<MethodName, MethodHandler>`
- `MethodHandler = (conn: GatewayConnection, params: unknown, deps: GatewayDeps) => Promise<ResponsePayload>`

**Depends on**: `protocol.ts` (method names), method handler modules

### method-handlers/* (EFFECT boundary)
Each handler is a thin delegate (30-60 lines):
1. Validate params (pure — Zod or manual check)
2. Call existing Brain system (effect — via injected deps)
3. Map result to response payload (pure)

**Depends on**: Brain domain modules via `GatewayDeps` ports

## Dependency Inversion

The gateway defines its own port types. Brain systems are injected, never imported directly:

```typescript
// types.ts
type GatewayDeps = {
  // From ServerDependencies
  surreal: Surreal
  config: ServerConfig
  sseRegistry: SseRegistry

  // Ports to Brain systems (function signatures, not module imports)
  assignTask: AssignTaskFn
  evaluateIntent: EvaluateIntentFn
  loadContext: LoadContextFn
  lookupIdentity: LookupIdentityFn
  lookupWorkspace: LookupWorkspaceFn
  recordTrace: RecordTraceFn

  // Session management (sessions.* methods)
  listSessions: ListSessionsFn
  getSessionHistory: GetSessionHistoryFn
  patchSession: PatchSessionFn

  // Tool registry (tools.catalog — scoped to agent's granted tools)
  listGrantedTools: ListGrantedToolsFn

  // Event subscription (async iterator over orchestrator events)
  subscribeToSessionEvents: (sessionId: string) => AsyncIterable<StreamEvent>
}
```

This ensures the gateway can be tested with stubs and doesn't create circular dependencies.

## What the Gateway Does NOT Own

| Concern | Owned By | Gateway's Role |
|---------|----------|---------------|
| Agent execution | Orchestrator | Delegates via `assignTask()` |
| Policy evaluation | Intent domain | Delegates via `evaluateIntent()` |
| Context loading | Graph domain | Delegates via `loadContext()` |
| Identity management | Auth domain | Delegates via `resolveDeviceIdentity()` |
| Trace recording | Trace domain | Creates trace records via `recordTrace()` |
| LLM calls | Model providers | Never touches LLM directly |
| Session persistence | Orchestrator | Reads `agent_session` for status queries |

The gateway is a **protocol adapter**, not a business logic module.
