# Data Models — openclaw-gateway

## Gateway Protocol Types (protocol.ts)

### Frame Types

```typescript
// --- Discriminated union for all gateway frames ---

type GatewayFrame = RequestFrame | ResponseFrame | EventFrame

type RequestFrame = {
  readonly type: "req"
  readonly id: string        // UUID, client-generated
  readonly method: MethodName
  readonly params?: unknown
}

type ResponseFrame = {
  readonly type: "res"
  readonly id: string        // Echoes request id
  readonly ok: boolean
  readonly payload?: unknown
  readonly error?: GatewayError
}

type EventFrame = {
  readonly type: "event"
  readonly event: string     // Event name (e.g., "agent.stream", "connect.challenge")
  readonly payload?: unknown
  readonly seq?: number      // Monotonically increasing per connection
}

type GatewayError = {
  readonly code: ErrorCode
  readonly message: string
  readonly details?: unknown
}
```

### Method Names

```typescript
// Core methods — aligned with real Gateway Protocol v3 spec
type MethodName =
  // Connection & auth
  | "connect"              // Client → Gateway: handshake with device identity, protocol version, role, scopes
  | "connect.verify"       // Client → Gateway: Ed25519 nonce signature

  // Agent execution (Brain-specific, maps to OpenClaw's two-stage completion model)
  | "agent"                // Submit work → immediate "accepted", then streamed events → final "ok"/"error"

  // Session management (matches OpenClaw's sessions.* namespace)
  | "sessions.list"        // List active sessions for this connection's identity
  | "sessions.history"     // Fetch trace/transcript for a completed session
  | "sessions.send"        // Send message to another session (cross-session messaging)
  | "sessions.patch"       // Update session properties mid-flight (model, thinking level)

  // Exec approval (Brain-specific governance extension)
  | "exec.approve"
  | "exec.deny"
  | "exec.approval.resolve" // OpenClaw-native exec approval method

  // Device management
  | "device.token.rotate"
  | "device.token.revoke"
  | "device.pair.start"
  | "device.pair.complete"

  // Discovery & status
  | "tools.catalog"        // List available MCP tools (OpenClaw-native, maps to Brain tool registry)
  | "skills.bins"          // Node capability bins (OpenClaw-native)
  | "model.list"           // Brain extension: list configured models
  | "presence"             // Query connected devices

  // Configuration (OpenClaw-native — Brain implements read-only subset)
  | "config.get"           // Return current gateway config (read-only for Brain)
```

### Error Codes

```typescript
type ErrorCode =
  // Protocol errors
  | "invalid_frame"                    // Malformed JSON or missing required fields
  | "unknown_method"                   // Method not in registry
  | "not_authenticated"                // Method requires active state, connection not yet authenticated
  | "already_authenticated"            // connect sent while already in active state

  // Device auth errors (aligned with real protocol error codes)
  | "auth_failed"                      // Generic auth failure
  | "DEVICE_AUTH_NONCE_REQUIRED"       // Missing nonce in device auth
  | "DEVICE_AUTH_NONCE_MISMATCH"       // Nonce doesn't match challenge
  | "DEVICE_AUTH_SIGNATURE_INVALID"    // Ed25519 signature verification failed
  | "DEVICE_AUTH_SIGNATURE_EXPIRED"    // Nonce expired before verification
  | "DEVICE_AUTH_DEVICE_ID_MISMATCH"   // Device ID doesn't match registered device
  | "DEVICE_AUTH_PUBLIC_KEY_INVALID"   // Invalid Ed25519 public key format
  | "AUTH_TOKEN_MISMATCH"             // Gateway auth token doesn't match

  // Business errors
  | "no_membership"                    // Device identity has no workspace membership
  | "policy_violation"                 // Intent denied by policy graph
  | "budget_exceeded"                  // Spend limit reached
  | "session_not_found"               // runId does not exist or not accessible
  | "method_not_supported"            // Method exists in protocol but not implemented by Brain
  | "internal_error"                   // Unexpected server error
```

## Connection State (connection.ts)

```typescript
type ConnectionState = "connecting" | "authenticating" | "active" | "closed"

type GatewayConnection = {
  readonly connectionId: string          // UUID, server-generated
  readonly state: ConnectionState
  readonly createdAt: number             // Date.now()

  // Set during authentication
  readonly deviceFingerprint?: string
  readonly publicKey?: CryptoKey         // Ed25519 public key (Web Crypto)
  readonly challenge?: PendingChallenge

  // Set after authentication
  readonly identityId?: string           // RecordId<"identity">.id
  readonly workspaceId?: string          // RecordId<"workspace">.id
  readonly agentType?: string            // "openclaw"
  readonly authorityScopes?: AuthorizationDetail[]

  // Runtime state
  readonly seqCounter: number            // Next event seq number
  readonly activeSessions: Set<string>   // runIds for active sessions
}

type PendingChallenge = {
  readonly nonce: string                 // Base64-encoded random bytes
  readonly ts: number                    // Timestamp when challenge was issued (epoch ms)
}

// State transition: pure function
type ConnectionEvent =
  | { type: "ws_open" }                                              // WS opened → send challenge
  | { type: "challenge_sent"; nonce: string; ts: number }            // Challenge issued
  | { type: "connect_received"; params: ConnectParams }              // Client connect frame with device identity
  | { type: "verified"; identity: ResolvedIdentity }                 // Auth succeeded → active
  | { type: "error"; code: ErrorCode; message: string }
  | { type: "closed" }

type TransitionResult = {
  readonly nextState: ConnectionState
  readonly connection: GatewayConnection  // Updated connection
  readonly effects: ConnectionEffect[]    // Side effects to execute
}

type ConnectionEffect =
  | { type: "send_frame"; frame: GatewayFrame }
  | { type: "close_connection"; code: number; reason: string }
  | { type: "start_keepalive" }
  | { type: "stop_keepalive" }
  | { type: "emit_presence"; status: "online" | "offline" }
  | { type: "record_trace"; traceData: unknown }
```

## Device Auth (device-auth.ts)

```typescript
type DeviceAuthResult =
  | { readonly verified: true; readonly fingerprint: string }
  | { readonly verified: false; readonly error: string }

type ChallengeData = {
  readonly nonce: string         // 32 bytes, base64url-encoded
  readonly expiresAt: number     // Absolute timestamp (ms)
}
```

## Identity Bridge (identity-bridge.ts)

```typescript
type ResolvedIdentity = {
  readonly identityId: string
  readonly workspaceId: string
  readonly workspaceName: string
  readonly agentId: string
  readonly authorityScopes: AuthorizationDetail[]
  readonly isNewDevice: boolean
}

type RegisteredDevice = {
  readonly clientId: string       // OAuth client_id from DCR
  readonly identityId: string
  readonly agentId: string
  readonly workspaceId: string
}

// RAR authorization_details (RFC 9396)
type AuthorizationDetail = {
  readonly type: "brain_mcp" | "brain_intent"
  readonly actions: string[]
  readonly locations?: string[]
  readonly datatypes?: string[]
  readonly max_risk_level?: "low" | "medium" | "high"
  readonly budget_limit_usd?: number
}
```

## Method Handler Params & Responses

### connect

Aligned with real Gateway Protocol v3 spec (https://docs.openclaw.ai/gateway/protocol).

```typescript
// Client → Gateway: first frame MUST be connect
type ConnectParams = {
  readonly minProtocol: 3        // Protocol version negotiation
  readonly maxProtocol: 3
  readonly client: {
    readonly id: string          // Client instance ID
    readonly version: string     // Client software version
    readonly platform: string    // "macos" | "linux" | "windows" | "ios" | "android"
    readonly mode: string        // "interactive" | "headless" | "remote"
  }
  readonly role: "operator" | "node"
  readonly scopes: string[]      // e.g. ["operator.read", "operator.write", "operator.approvals"]
  readonly caps?: string[]       // Node capabilities: ["camera", "canvas", "screen", "location", "voice"]
  readonly commands?: string[]   // Node commands
  readonly permissions?: Record<string, boolean>
  readonly auth: { readonly token: string }  // Gateway auth token
  readonly locale?: string
  readonly userAgent?: string
  readonly device: {
    readonly id: string          // Stable device ID
    readonly publicKey: string   // Ed25519 public key, base64
    readonly signature: string   // Signed nonce, base64
    readonly signedAt: number    // Timestamp of signing
    readonly nonce: string       // Nonce from connect.challenge
  }
}

// Gateway → Client: challenge event (sent before connect response)
// { type: "event", event: "connect.challenge", payload: { nonce: "<base64>", ts: <epoch-ms> } }

// Gateway → Client: hello-ok response (after signature verification)
type HelloOkPayload = {
  readonly type: "hello-ok"
  readonly protocol: 3
  readonly policy: {
    readonly tickIntervalMs: number  // e.g. 15000
  }
  readonly auth: {
    readonly deviceToken: string     // Issued device token for future connections
    readonly role: "operator" | "node"
    readonly scopes: string[]
  }
  // Brain extensions (additional fields OpenClaw clients ignore gracefully):
  readonly workspace?: string
  readonly workspaceName?: string
  readonly identity?: string
  readonly brainScopes?: AuthorizationDetail[]
  readonly isNewDevice?: boolean
}
```

### agent

```typescript
type AgentParams = {
  readonly task: string           // Task description or session key
  readonly taskId?: string        // Existing task record ID
  readonly agentConfig?: {
    readonly model?: string       // Override default model
    readonly maxTokens?: number
  }
}

type AgentAcceptedPayload = {
  readonly runId: string
  readonly sessionId: string
  readonly contextSummary: {
    readonly decisions: number
    readonly constraints: number
    readonly learnings: number
    readonly observations: number
  }
}
```

### sessions.* (OpenClaw-native session management)

These methods align with the real OpenClaw `sessions.*` namespace.
Brain maps its `agent_session` records to this interface.

```typescript
// sessions.list — list active sessions for this identity
type SessionsListParams = {
  readonly status?: "active" | "completed" | "all"  // default: "active"
  readonly limit?: number                           // default: 20
}

type SessionsListPayload = {
  readonly sessions: SessionSummary[]
}

type SessionSummary = {
  readonly runId: string
  readonly sessionId: string
  readonly status: "spawning" | "active" | "idle" | "completed" | "aborted" | "error"
  readonly task: string
  readonly startedAt: string
  readonly lastEventAt?: string
  readonly endedAt?: string
  readonly toolCalls?: number
}

// sessions.history — trace/transcript for a session (replaces agent.history)
type SessionsHistoryParams = {
  readonly runId: string
}

type SessionsHistoryPayload = {
  readonly runId: string
  readonly trace: TraceNode[]
}

type TraceNode = {
  readonly id: string
  readonly type: string         // "tool_call" | "llm_call" | "intent_submission" | ...
  readonly toolName?: string
  readonly durationMs?: number
  readonly model?: string
  readonly inputTokens?: number
  readonly outputTokens?: number
  readonly costUsd?: number
  readonly children: TraceNode[]
  readonly createdAt: string
}

// sessions.send — cross-session messaging
type SessionsSendParams = {
  readonly targetRunId: string
  readonly message: string
  readonly replyBack?: boolean  // If true, expect a response
}

type SessionsSendPayload = {
  readonly delivered: boolean
  readonly reply?: string       // Only if replyBack was true and target responded
}

// sessions.patch — update session properties mid-flight
type SessionsPatchParams = {
  readonly runId: string
  readonly model?: string       // Switch model mid-session
  readonly thinkingLevel?: "none" | "low" | "medium" | "high"
  readonly verbose?: boolean
}

type SessionsPatchPayload = {
  readonly runId: string
  readonly applied: string[]    // List of fields that were successfully patched
}
```

### Agent status (kept for backward compat, delegates to sessions.*)

```typescript
// agent.status → alias for sessions.list + filter by runId
type AgentStatusParams = {
  readonly runId: string
}

type AgentStatusPayload = SessionSummary

// agent.wait → poll until session reaches terminal state
type AgentWaitParams = {
  readonly runId: string
  readonly timeoutMs?: number   // Server-side timeout, default 300_000
}

type AgentWaitPayload = {
  readonly runId: string
  readonly status: "completed" | "aborted" | "error"
  readonly result?: unknown
}
```

### exec.approve / exec.deny

```typescript
type ExecApprovalParams = {
  readonly requestId: string
}

type ExecApprovalPayload = {
  readonly requestId: string
  readonly decision: "approved" | "denied"
}
```

### model.list

```typescript
type ModelListPayload = {
  readonly models: ModelInfo[]
}

type ModelInfo = {
  readonly id: string           // e.g., "claude-sonnet-4-6"
  readonly provider: string     // e.g., "openrouter"
  readonly capabilities?: string[]
}
```

### presence

```typescript
type PresencePayload = {
  readonly devices: DevicePresence[]
}

type DevicePresence = {
  readonly deviceFingerprint: string
  readonly status: "online" | "offline"
  readonly agentType: string
  readonly connectedAt?: string
  readonly lastActiveAt?: string
}
```

### tools.catalog (OpenClaw-native)

Returns tools the authenticated agent has been granted access to, not the entire workspace registry. Tool access is resolved from the agent's authority scopes and policy graph.

```typescript
type ToolsCatalogParams = {
  readonly filter?: string      // Optional text filter
}

type ToolsCatalogPayload = {
  readonly tools: ToolCatalogEntry[]
}

type ToolCatalogEntry = {
  readonly name: string
  readonly description: string
  readonly server: string       // MCP server name
  readonly inputSchema?: unknown
  readonly outputSchema?: unknown
}
```

### config.get (OpenClaw-native, read-only)

Brain implements this as read-only. Returns gateway configuration visible to the client.

```typescript
type ConfigGetPayload = {
  readonly gateway: {
    readonly version: string     // Brain version
    readonly protocol: 3
    readonly features: string[]  // ["sessions", "tools", "presence", "exec-approval"]
    readonly tickIntervalMs: number
  }
}
```

## Event Adapter Mapping (event-adapter.ts)

**Source of truth**: `app/src/shared/contracts.ts` — `StreamEvent` union type.

The mapping must be **exhaustive**: every `StreamEvent` variant is either mapped to a gateway event or explicitly listed as dropped. A unit test must verify exhaustiveness by checking that all discriminants in the `StreamEvent` union appear in the mapping table — if a new variant is added to Brain and not listed here, the test fails.

```typescript
// Input: StreamEvent from shared/contracts.ts
// Output: Gateway Protocol EventFrame | undefined (dropped)

type GatewayStreamEvent = {
  readonly stream: "assistant" | "lifecycle" | "error"
  readonly data: unknown
}

// --- MAPPED (forwarded to gateway client) ---
// AgentTokenEvent        → { stream: "assistant", data: { delta: token } }
// AgentFileChangeEvent   → { stream: "lifecycle", data: { phase: "file_change", path, changeType } }
// AgentStatusEvent       → { stream: "lifecycle", data: { phase: status, error? } }
// AgentStallWarningEvent → { stream: "lifecycle", data: { phase: "stall_warning", stallDurationSeconds } }
// AgentPromptEvent       → { stream: "lifecycle", data: { phase: "prompt" } }
// ErrorEvent             → { stream: "error", data: { error: message } }
// DoneEvent              → { stream: "lifecycle", data: { phase: "done" } }

// --- DROPPED (Brain-internal, no gateway equivalent) ---
// TokenEvent             → undefined (chat agent token, not orchestrator)
// ReasoningEvent         → undefined (extended thinking, Brain UI only)
// AssistantMessageEvent  → undefined (complete message, Brain UI only)
// ExtractionEvent        → undefined (entity extraction, Brain pipeline only)
// OnboardingSeedEvent    → undefined (onboarding UI, Brain client only)
// OnboardingStateEvent   → undefined (onboarding state, Brain client only)
// ObservationEvent       → undefined (graph observation, Brain feed only)

// Drop-through is intentional: unmapped variants return undefined from the
// mapper. The gateway WS sender skips undefined results. This is safe because
// dropped events are Brain UI/pipeline concerns, not agent execution concerns.
```

## Schema Changes (SurrealDB)

No new tables. Field additions to `agent` table only:

```sql
-- Existing agent table gains 4 optional fields:
DEFINE FIELD OVERWRITE device_fingerprint ON agent TYPE option<string>;
DEFINE FIELD OVERWRITE device_public_key ON agent TYPE option<string>;
DEFINE FIELD OVERWRITE device_platform ON agent TYPE option<string>;
DEFINE FIELD OVERWRITE device_family ON agent TYPE option<string>;
DEFINE INDEX OVERWRITE agent_device_fingerprint ON agent FIELDS device_fingerprint;

-- agent_type enum extended:
ALTER FIELD agent_type ON agent TYPE string
  ASSERT $value IN ['code_agent', 'architect', 'management', 'design_partner',
                     'observer', 'chat_agent', 'mcp', 'openclaw'];
```
