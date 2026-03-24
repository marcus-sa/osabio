# DESIGN Decisions — openclaw-gateway

## Key Decisions

- [D1] **Gateway as thin protocol adapter** — zero business logic; each method handler is 30-60 lines delegating to existing Brain systems (see: `architecture-design.md` § Gateway as Thin Protocol Adapter)
- [D2] **Modular monolith, new domain module** — `app/src/server/gateway/` follows existing domain pattern; no microservice, no separate process (see: ADR-074)
- [D3] **Real Gateway Protocol v3 connect handshake** — single-frame `connect` with device identity inline (not two-step connect → connect.verify). `connect.challenge` sent immediately on WS open, `hello-ok` response with protocol version + policy + device token. (see: ADR-075, `architecture-design.md` § Auth Architecture)
- [D4] **Pure event adapter, no new event types** — map existing `StreamEvent` variants to Gateway Protocol frames; drop Brain-internal events (see: ADR-076)
- [D5] **Zero new runtime dependencies** — Bun native WebSocket, crypto.subtle for Ed25519, JSON for protocol framing (see: `technology-stack.md`)
- [D6] **Ports-and-adapters with GatewayDeps** — all Brain system access via injected function ports; no direct module imports (see: `component-boundaries.md`)
- [D7] **Connection state machine as pure function** — `transition(state, event) → { nextState, effects[] }`; effect execution at WS boundary (see: `data-models.md`)
- [D8] **ES256 vs Ed25519 mismatch resolved** — Brain uses ES256 for DPoP; gateway accepts Ed25519 for device auth only; WebSocket channel is the auth boundary after connect (see: ADR-075)
- [D9] **Method names aligned with real protocol** — `sessions.*` namespace (list/history/send/patch), `tools.catalog`, `config.get`, `exec.approval.resolve`. `agent.status`/`agent.wait` kept as backward-compat aliases. (see: `data-models.md` § Method Names)
- [D10] **Graceful method_not_supported** — methods recognized by the protocol but not implemented by Brain return `method_not_supported` error (not `unknown_method`). This lets the CLI handle missing features gracefully. (see: `data-models.md` § Error Codes)
- [D11] **Protocol error codes from real spec** — device auth errors use `DEVICE_AUTH_*` codes matching the real protocol, not Brain-specific codes. (see: `data-models.md` § Error Codes)

## Architecture Summary

- **Pattern**: Modular monolith with ports-and-adapters (existing Brain pattern)
- **Paradigm**: Functional (types-first, pure core / effect shell, composition pipelines)
- **Key components**: protocol parser (pure) → connection state machine (pure) → method dispatch (pure) → method handlers (effect boundary) → event adapter (pure)
- **New domain**: `app/src/server/gateway/` (~12 files, ~600-900 lines total)

## Technology Stack

- **Transport**: Bun native WebSocket (zero dependencies)
- **Crypto**: Web Crypto API (Ed25519 verify, SHA-256 fingerprint)
- **Protocol**: Gateway Protocol v3 JSON text frames
- **Database**: Existing SurrealDB (4 field additions to `agent` table)
- **Runtime dependencies added**: 0

## Constraints Established

- Gateway domain has zero business logic — pure protocol adaptation
- Each method handler delegates to exactly one existing Brain system
- StreamEvent mapping is exhaustive (all variants handled or explicitly dropped)
- Connection state transitions are pure functions (testable without I/O)
- WS events sent directly to connection, not through SSE registry (SSE used only for presence broadcast)
- Device fingerprint = SHA-256(Ed25519 public key)
- Challenge nonces are single-use, time-bounded (ts field in challenge, not explicit TTL)
- `connect.challenge` MUST be sent immediately on WebSocket open (before any client frame)
- `hello-ok` response MUST include `protocol`, `policy.tickIntervalMs`, and `auth.deviceToken`

## FR-to-Architecture Mapping

| FR | Architecture Location | Component |
|----|----------------------|-----------|
| FR-1: Gateway Protocol v3 Transport | `data-models.md` § Frame Types | `protocol.ts` |
| FR-2: Device Authentication | ADR-075, `architecture-design.md` § Auth Architecture | `device-auth.ts`, `method-handlers/connect.ts` |
| FR-3: Device Identity Bridge | ADR-075 § Identity Resolution | `identity-bridge.ts` |
| FR-4: Workspace Resolution | `architecture-design.md` § Integration Points | `method-handlers/connect.ts` |
| FR-5: Agent Method | `component-boundaries.md` § method-handlers | `method-handlers/agent.ts` |
| FR-6: Event Streaming | ADR-076, `data-models.md` § Event Adapter Mapping | `event-adapter.ts` |
| FR-7: Exec Approval Flow | `component-boundaries.md` § method-handlers | `method-handlers/exec-approval.ts` |
| FR-8: Session Management | `data-models.md` § sessions.* | `method-handlers/sessions.ts` |
| FR-8a: Tool Catalog | `data-models.md` § tools.catalog | `method-handlers/tools-catalog.ts` |
| FR-8b: Gateway Configuration | `data-models.md` § config.get | `method-handlers/config.ts` |
| FR-9: Policy Enforcement | `architecture-design.md` § Integration Points | `GatewayDeps.evaluateIntent` port |
| FR-10: Budget Enforcement | `architecture-design.md` § Integration Points | `GatewayDeps.evaluateIntent` port |
| FR-11: Native Trace Recording | `architecture-design.md` § Integration Points | `GatewayDeps.recordTrace` port |
| FR-12: Model Listing | `data-models.md` § model.list | `method-handlers/models.ts` |
| FR-13: Presence Tracking | `architecture-design.md` § Integration Points | `method-handlers/presence.ts` |
| FR-14: Connection Resilience | `data-models.md` § Connection State | `connection.ts` state machine |

## Upstream Changes

- **AC-1.1**: Changed from two-step `connect` + `connect.verify` to single-frame `connect` with device identity inline, matching real Gateway Protocol v3 spec.
- **AC-1.5**: Updated to reflect `connect.challenge` sent immediately on WS open.
- **FR-2**: Updated to describe real protocol's connect handshake flow with `hello-ok` response.
- **FR-8**: Expanded from `agent.status/wait/history` to `sessions.*` namespace (list/history/send/patch) + backward-compat aliases.
- **FR-8a/8b**: New requirements for `tools.catalog` and `config.get`.
- **Method names**: `agent.history` → `sessions.history`, added `sessions.list`, `sessions.send`, `sessions.patch`, `tools.catalog`, `config.get`, `exec.approval.resolve`.
- **Error codes**: Added protocol-standard `DEVICE_AUTH_*` codes and `method_not_supported`.

## ADRs

- ADR-074: OpenClaw Gateway Protocol Server (Brain as server vs client)
- ADR-075: Gateway Ed25519 → Brain Identity Bridge (device auth design)
- ADR-076: Gateway Event Adapter Pattern (StreamEvent → Gateway Protocol mapping)
