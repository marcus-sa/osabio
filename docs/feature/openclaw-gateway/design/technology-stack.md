# Technology Stack — openclaw-gateway

## Selected Technologies

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| **Transport** | Bun native WebSocket | Zero dependencies. `Bun.serve()` already supports `websocket` handler config. No `ws`, `socket.io`, or polyfills needed. |
| **Protocol** | Gateway Protocol v3 (JSON text frames) | Standard OpenClaw protocol. JSON parse/serialize via built-in `JSON.parse`/`JSON.stringify`. |
| **Crypto (device auth)** | Web Crypto API (`crypto.subtle`) | Ed25519 verify via `crypto.subtle.verify("Ed25519", ...)`. Available in Bun runtime. Zero dependencies. |
| **Crypto (fingerprint)** | Web Crypto API | SHA-256 of Ed25519 public key for device fingerprint. `crypto.subtle.digest("SHA-256", ...)`. |
| **Identity** | Existing Brain identity system | `identity` + `agent` tables, `identity_agent` edge, `member_of` edge. No new auth library. |
| **Session** | Existing orchestrator | `assignTask()`, `startEventIteration()`, session lifecycle state machine. |
| **Policy** | Existing intent evaluator | `evaluateIntent()` with policy graph traversal. |
| **Trace** | Existing trace recording | `trace` table with hierarchical parent linking. |
| **Streaming** | Existing SSE registry (for presence) | `emitWorkspaceEvent()` for presence broadcast. WS events sent directly, not through SSE. |
| **Database** | SurrealDB (existing) | Device lookup, identity resolution, session CRUD, trace recording. |
| **LLM** | Existing provider config | OpenRouter / Ollama via configured models. Gateway agents use same model routing. |

## What We Are NOT Adding

| Technology | Why Not |
|-----------|---------|
| `ws` / `socket.io` | Bun has native WebSocket. External libraries add bundle size and compatibility layers for features we don't need. |
| Redis / pub-sub | Brain uses in-process event registry. Gateway connections are per-server. Horizontal scaling is a future concern, not a walking skeleton concern. |
| JWT library for Ed25519 | Ed25519 verification is a single `crypto.subtle.verify()` call. No JWT needed for device auth — it's raw challenge-response. |
| Protocol Buffers / MessagePack | Gateway Protocol v3 uses JSON text frames. Binary encoding would break client compatibility. |
| Connection pooling library | Bun handles TCP connection management internally. |

## Minimum Runtime Requirements

- **Bun >= 1.3** (project prerequisite per README)
- **Web Crypto API Ed25519**: Bun supports Ed25519 in `crypto.subtle` since v1.0. The gateway startup must verify Ed25519 availability via a self-test (`crypto.subtle.generateKey("Ed25519", ...)`) and fail fast if unavailable.
- **Native WebSocket**: Available in all Bun versions via `Bun.serve({ websocket })`.

## Dependency Count

**New runtime dependencies: 0**

The gateway domain uses only:
- Bun built-ins (WebSocket, crypto.subtle, JSON)
- Existing Brain modules (orchestrator, intent, auth, graph, trace, streaming)
