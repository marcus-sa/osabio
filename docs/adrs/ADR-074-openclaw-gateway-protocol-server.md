# ADR-074: OpenClaw Gateway Protocol Server

**Status**: Proposed
**Date**: 2026-03-24
**Context**: GitHub issue #179

## Decision

Brain implements the server side of the OpenClaw Gateway Protocol v3. OpenClaw clients (CLI, web UI, macOS app, iOS/Android) connect directly to Brain via WebSocket at `/api/gateway`.

## Context

Brain needs to integrate with the OpenClaw ecosystem (300k+ GitHub stars). Two options were evaluated:

### Option A: Brain as Gateway Client (rejected)

Brain connects to external OpenClaw gateways as a WebSocket client, intercepting LLM calls and extracting context from chat.

**Problems**:
- Three moving parts (client + gateway + provider)
- Two auth systems to bridge (Ed25519 + DPoP)
- Context injection via proxy interception (extra hop, extra latency)
- Trace recording is reconstructed from proxy logs
- Brain must track OpenClaw's protocol evolution as a dependent client

### Option B: Brain as Gateway Server (selected)

Brain implements the Gateway Protocol server. OpenClaw clients connect directly to Brain.

**Advantages**:
- Two moving parts (client + Brain)
- One auth system (Brain's, with device auth bridge)
- Context injection is native (Brain builds the prompt)
- Trace recording is native (Brain runs the agent)
- Policy enforcement is native (Brain evaluates before execution)
- Zero additional latency
- Brain defines the contract as server

## Consequences

### Positive
- Entire OpenClaw ecosystem becomes Brain's distribution channel
- 80% of business logic already exists (orchestrator, auth, traces, policies)
- New code is thin protocol adapter (~300-500 lines of gateway-specific code)
- No new runtime dependencies (Bun native WebSocket)
- No new SurrealDB tables (4 field additions to `agent` table)

### Negative
- Brain must maintain Gateway Protocol v3 compatibility as protocol evolves
- WebSocket connection management adds server resource tracking
- Ed25519 → DPoP identity bridge is a new auth flow to maintain
- Walking skeleton requires hardcoded identity (real auth follows in R1)

### Risks
- OpenClaw protocol may change in v4 — mitigated by Gateway being a thin adapter layer (swap protocol.ts)
- WebSocket stability under load — mitigated by Bun's native WS performance; add heartbeat/ping-pong
- Ed25519 support in Web Crypto API — verified available in Bun runtime

## Alternatives Considered

1. **HTTP long-polling instead of WebSocket**: Rejected — Gateway Protocol v3 is WebSocket-native; HTTP polling would require a compatibility shim and add latency.
2. **Separate gateway process**: Rejected — adds deployment complexity and inter-process communication. Brain is a monolith; gateway is a domain module.
3. **Protocol translation proxy**: Rejected — same problems as Option A plus an additional process.
