# ADR-075: Gateway Ed25519 → Brain Identity Bridge

**Status**: Proposed
**Date**: 2026-03-24
**Context**: ADR-074 (OpenClaw Gateway Protocol Server)

## Decision

The gateway accepts Ed25519 device authentication (OpenClaw's native auth) and bridges it to Brain's identity system. After WebSocket authentication, the connection carries the resolved Brain identity for its lifetime — no per-request DPoP proofs over WebSocket.

## Context

Brain's existing auth uses ES256 (EC P-256) for DPoP proof-of-possession. OpenClaw devices use Ed25519 key pairs. These are different curves and cannot be used interchangeably for signature verification.

### Options Evaluated

1. **Require OpenClaw clients to generate ES256 keys**: Rejected — breaks compatibility with existing OpenClaw device key infrastructure.
2. **Ed25519 for device auth, ES256 for DPoP**: Rejected as over-engineered — WebSocket connections don't need per-request DPoP proofs (the channel is already authenticated).
3. **Ed25519 device auth → Brain identity resolution (selected)**: Device proves identity via Ed25519 challenge-response. Brain resolves or creates a Brain identity. The authenticated WebSocket connection carries this identity.

## Design

### Challenge-Response Flow

1. Client sends `connect` with Ed25519 public key
2. Server generates 32-byte random nonce, sends `connect.challenge`
3. Client signs nonce with Ed25519 private key, sends `connect.verify`
4. Server verifies signature via `crypto.subtle.verify("Ed25519", ...)`
5. Server computes device fingerprint: `SHA-256(publicKey)`

### Identity Resolution

- **Known device** (fingerprint exists in `agent` table): Resolve linked identity via `identity_agent` edge. Load workspace via `member_of` edge.
- **New device**: Auto-register via internal DCR. Create `agent` record with device fields, `identity` record, `identity_agent` edge, and `member_of` edge.

### DPoP Key Pair: Not Generated for Gateway Devices

Gateway devices do **not** receive an ES256 DPoP key pair. The WebSocket connection itself is the auth boundary — there is no need for per-request proof-of-possession over an already-authenticated channel.

DCR auto-registration creates an OAuth `client_id` for the device (for audit trail and future token exchange), but does **not** generate or store an ES256 key pair. If a future release needs to issue DPoP-bound tokens for gateway devices (e.g., for REST API access outside the WebSocket), the device would generate its own ES256 key pair at that time and bind it via a standard token request.

### Session Lifetime Auth

After authentication, the WebSocket connection carries:
- `identityId` — Brain identity
- `workspaceId` — resolved workspace
- `authorityScopes` — RAR authorization_details

Every method call inherits these. No per-request auth headers or proofs needed — the WebSocket channel is the auth boundary.

## Consequences

### Positive
- OpenClaw clients use their existing Ed25519 keys — zero client changes
- Zero-config onboarding: new devices auto-register via DCR
- WebSocket auth is simpler than per-request DPoP (no nonce management after connect)
- Single identity system: device resolves to same Brain identity used by MCP/CLI

### Negative
- Challenge nonces must be single-use and time-bounded (30s expiry)
- Device fingerprint index on `agent` table adds one index
- DCR auto-registration creates agent/identity records that may need cleanup if device never returns

### Risks
- Nonce replay: mitigated by single-use nonces with in-memory tracking
- Device impersonation: mitigated by Ed25519 cryptographic verification
- Stale device records: future concern — add TTL cleanup in R4
