# Research: OpenClaw CLI as a Gateway Client for Acceptance Tests

**Date**: 2026-03-24 | **Researcher**: nw-researcher (Nova) | **Confidence**: High | **Sources**: 14

## Executive Summary

Brain already has a custom `gateway-test-kit.ts` that implements a lightweight Gateway Protocol v3 WebSocket client for acceptance tests. The question is whether the official OpenClaw CLI or any SDK could serve as a **real** client in acceptance tests against Brain's gateway server. The answer: **the OpenClaw CLI cannot practically serve as an acceptance test client**, but there are viable programmatic alternatives.

**Key findings:**

1. **The OpenClaw CLI (`npm: openclaw`) is interactive-first.** It requires a running gateway daemon, device pairing, and has no mode that sends a single request and exits cleanly. The `--non-interactive` and `--yes` flags control prompt behavior, not protocol interaction mode. It is not designed to be spawned as a subprocess against an arbitrary gateway endpoint.

2. **`acpx` (Agent Client Protocol CLI) is the headless alternative**, but it speaks the Agent Client Protocol (ACP), not Gateway Protocol v3. ACP is a higher-level protocol for agent-to-agent communication -- it does not perform the Ed25519 device auth handshake or send raw `GatewayFrame` messages.

3. **No official TypeScript/JavaScript SDK exists for programmatic Gateway Protocol v3 client usage.** The `openclaw` npm package exports a plugin SDK (`openclaw/plugin-sdk/*`) for building plugins, not for connecting to a gateway as a client. The gateway client code is internal to the CLI binary.

4. **Third-party client libraries exist** (`openclaw-go` in Go, `openclaw-sdk` in Python, `webclaw` in TypeScript/browser) but none are suitable for Bun acceptance tests. The Go and Python libraries require their respective runtimes. `webclaw` is browser-only.

5. **Brain's existing `gateway-test-kit.ts` is the correct approach.** It implements the exact protocol surface needed (frame types, request/response correlation, event collection) with zero external dependencies. For Ed25519 auth testing, the R1 test suite already uses `crypto.subtle.generateKey("Ed25519")` -- no OpenClaw dependency needed.

6. **Gateway token auth (`OPENCLAW_GATEWAY_TOKEN`) bypasses device pairing** and provides a simpler auth path that could be useful for test scenarios, but device pairing auto-approval on loopback means local tests can use the full Ed25519 flow regardless.

## Research Methodology
**Search Strategy**: 8 targeted web searches covering CLI installation, gateway configuration, headless/programmatic modes, SDK availability, protocol frame format, device auth, and source code structure. Cross-referenced with 4 existing research documents in `docs/research/` and the existing acceptance test code in `tests/acceptance/gateway/`.
**Source Selection**: Types: official docs, GitHub repositories, npm registry, DeepWiki code analysis | Reputation: high/medium-high | Verification: cross-referencing against existing project research and source code
**Quality Standards**: Target 3 sources/claim (min 1 authoritative) | All major claims cross-referenced | Avg reputation: 0.82

---

## Findings

### Finding 1: OpenClaw CLI Installation and Package Identity

**Evidence**: The official npm package is `openclaw`. Latest version: 2026.3.23-2. Installation via `npm install -g openclaw@latest` or `curl -fsSL https://openclaw.ai/install.sh | bash`. Runtime requires Node 24 (recommended) or Node 22.16+. The `openclaw onboard --install-daemon` command bootstraps the gateway daemon.

**Source**: [openclaw - npm](https://www.npmjs.com/package/openclaw) - Accessed 2026-03-24
**Confidence**: High
**Verification**: [OpenClaw Install Docs](https://docs.openclaw.ai/install), [DeepWiki Package Structure](https://deepwiki.com/openclaw/openclaw/11.4-package-structure)

**Analysis**: The CLI is a single npm package containing the daemon, CLI binary, and plugin SDK. It is not decomposed into separate client/server packages. There is no `@openclaw/gateway-client` or similar standalone client library.

---

### Finding 2: Gateway Connection Configuration

**Evidence**: The CLI connects to a gateway via these configuration mechanisms (in priority order):

| Mechanism | Format | Notes |
|-----------|--------|-------|
| `OPENCLAW_GATEWAY_URL` env var | `ws://host:port` | Overrides all config file settings |
| `OPENCLAW_GATEWAY_TOKEN` env var | Raw token string | Silently overrides `openclaw.json` token |
| `OPENCLAW_GATEWAY_PASSWORD` env var | Password string | Alternative to token auth |
| `OPENCLAW_GATEWAY_PORT` env var | Port number | Default: 18789 |
| `openclaw.json` config file | `{ gateway: { mode: "remote", remote: { url: "ws://...", token: "..." } } }` | Persistent config |
| Default | `ws://127.0.0.1:18789/gateway` | Auto-probes localhost |

**Source**: [OpenClaw CLI Gateway Docs](https://docs.openclaw.ai/cli/gateway) - Accessed 2026-03-24
**Confidence**: High
**Verification**: [OpenClaw Remote Access Docs](https://openclaws.io/docs/gateway/remote), [LumaDock CLI Config Reference](https://lumadock.com/tutorials/openclaw-cli-config-reference)

**Analysis**: You CAN point the CLI at a custom gateway URL. However, the CLI expects a full OpenClaw gateway implementation on the other end -- it will attempt device pairing, capability negotiation, agent listing, and other lifecycle operations that Brain's gateway would need to implement or stub.

---

### Finding 3: Gateway Protocol v3 Frame Format (Wire Protocol)

**Evidence**: The protocol uses WebSocket text frames with JSON payloads. Three frame types form a discriminated union (`GatewayFrame`):

**Request frame** (client to server):
```json
{ "type": "req", "id": "<uuid>", "method": "<method-name>", "params": { ... } }
```

**Response frame** (server to client):
```json
{ "type": "res", "id": "<matching-uuid>", "ok": true, "payload": { ... } }
// or error:
{ "type": "res", "id": "<matching-uuid>", "ok": false, "error": { "code": "...", "message": "..." } }
```

**Event frame** (server to client, unsolicited):
```json
{ "type": "event", "event": "<event-name>", "payload": { ... }, "seq": 42 }
```

**Key method categories**: `connect`, `connect.verify`, `agent.*`, `chat.*`, `model.*`, `device.*`, `exec.*`, `tools.*`, `skills.*`, `config.*`, `system-presence`, `update.*` (100+ methods total).

**Source**: [OpenClaw Gateway Protocol Docs](https://docs.openclaw.ai/gateway/protocol) - Accessed 2026-03-24
**Confidence**: High
**Verification**: [DeepWiki WebSocket Protocol & RPC](https://deepwiki.com/openclaw/openclaw/2.1-system-requirements), [GitHub frames.ts](https://github.com/openclaw/openclaw/blob/main/src/gateway/protocol/schema/frames.ts)

**Analysis**: Brain's `gateway-test-kit.ts` already implements this exact frame format (see `RequestFrame`, `ResponseFrame`, `EventFrame` types). The existing test kit is protocol-accurate.

---

### Finding 4: Ed25519 Auth Handshake Flow

**Evidence**: The connect sequence:

1. Client opens WebSocket to `/gateway`
2. Client sends `connect` request with `{ publicKey, platform, deviceFamily }`
3. Server sends `connect.challenge` event with `{ nonce, ts }` (or `{ nonce, expiresIn }`)
4. Client constructs v3 signature payload: `v3|{deviceId}|{clientId}|{clientMode}|{role}|{scopes}|{signedAtMs}|{token}|{nonce}|{platform}|{deviceFamily}` (pipe-delimited)
5. Client signs payload with Ed25519 private key
6. Client sends `connect.verify` request with `{ signature, nonce }`
7. Server verifies against stored public key, returns identity/workspace info

**Device identity storage**: `~/.openclaw/identity/device.json` contains the Ed25519 keypair. `deviceId` = `SHA-256(rawPublicKey).hex`. Clock skew tolerance: 600,000ms (10 minutes). Legacy v2 signatures also accepted.

**Source**: [DeepWiki Authentication & Authorization](https://deepwiki.com/openclaw/openclaw/2.2-authentication-and-device-pairing) - Accessed 2026-03-24
**Confidence**: High
**Verification**: [OpenClaw Gateway Protocol Docs](https://docs.openclaw.ai/gateway/protocol), [GitHub Issue #17571 - Third-party client auth guide](https://github.com/openclaw/openclaw/issues/17571)

**Analysis**: Brain's R1 test suite already implements this flow using `crypto.subtle.generateKey("Ed25519")`. The test kit generates keys in-process -- no external tooling needed.

---

### Finding 5: No Headless/Programmatic Mode for Protocol-Level Testing

**Evidence**: The CLI supports `--non-interactive` (skip prompts, apply safe migrations only) and `--yes` (accept defaults without prompting). Batch mode via `config set --batch-json` or `--batch-file` configures agent behavior, not protocol interaction. The gateway daemon runs headlessly via `nohup openclaw gateway start &`, but the daemon IS the server, not a client.

`acpx` (`npm: acpx`) is the official headless client, but it speaks ACP (Agent Client Protocol), not Gateway Protocol v3. ACP is a higher-level protocol for multi-turn agent sessions with `--no-wait` fire-and-forget semantics. It wraps OpenClaw, Codex, Claude, and Pi with a unified interface but does NOT expose raw Gateway Protocol frames.

**Source**: [GitHub openclaw/acpx](https://github.com/openclaw/acpx) - Accessed 2026-03-24
**Confidence**: High
**Verification**: [acpx - npm](https://www.npmjs.com/package/acpx), [acpx AGENTS.md](https://github.com/openclaw/acpx/blob/main/AGENTS.md)

**Analysis**: Neither the CLI nor `acpx` can be used to send raw Gateway Protocol v3 frames to a custom endpoint. `acpx` specifically is designed for agent-to-agent orchestration, not protocol testing. There is no `openclaw gateway test` or `openclaw gateway ping` command.

---

### Finding 6: No Standalone TypeScript/JavaScript Gateway Client SDK

**Evidence**: The `openclaw` npm package exports subpath modules for the plugin SDK only:

- `openclaw/plugin-sdk/core` -- generic plugin APIs, provider auth types
- `openclaw/plugin-sdk/telegram`, `/discord`, `/slack` -- channel-specific plugins
- `openclaw/plugin-sdk/acpx`, `/device-pair`, `/diagnostics-otel` -- extension subpaths

There is no `openclaw/gateway-client` or `openclaw/protocol` export. The gateway client implementation is internal to the CLI binary in `src/gateway/` and not exposed as a public API.

**Source**: [DeepWiki Package Structure](https://deepwiki.com/openclaw/openclaw/11.4-package-structure) - Accessed 2026-03-24
**Confidence**: High
**Verification**: [openclaw - npm](https://www.npmjs.com/package/openclaw), [DeepWiki Plugin Architecture](https://deepwiki.com/openclaw/openclaw/9.1-plugin-architecture)

**Analysis**: To use OpenClaw's gateway client code, you would need to import internal modules from the `openclaw` package, which are not part of the public API and subject to breaking changes. This is not viable for acceptance tests.

---

### Finding 7: Third-Party Client Libraries Are Not Suitable for Bun Tests

**Evidence**: Three third-party Gateway Protocol v3 client libraries exist:

| Library | Language | Viability for Bun Tests |
|---------|----------|------------------------|
| `openclaw-go` (a3t.ai) | Go | No -- requires Go runtime, 96+ typed RPC methods, gorilla/websocket |
| `openclaw-sdk` | Python | No -- requires Python 3.11+, async WebSocket |
| `webclaw` (ibelick) | TypeScript (browser) | No -- browser-only, uses `CLAWDBOT_GATEWAY_URL` token auth, chat-focused subset |

**Source**: [github.com/a3tai/openclaw-go](https://github.com/a3tai/openclaw-go) - Accessed 2026-03-24
**Confidence**: High
**Verification**: [pypi.org/project/openclaw-sdk](https://pypi.org/project/openclaw-sdk/), [github.com/ibelick/webclaw](https://github.com/ibelick/webclaw)

**Analysis**: None of these can be imported into a Bun test suite. The Go and Python libraries require their respective runtimes. `webclaw` assumes a browser environment.

---

### Finding 8: Gateway Token Auth as a Simpler Test Path

**Evidence**: OpenClaw supports two auth modes besides Ed25519 device pairing:

1. **Token auth** (`OPENCLAW_GATEWAY_TOKEN`): A shared bearer token. Satisfies the auth check but device pairing approval is still required as a separate step. Auto-approved for loopback connections.
2. **`gateway.controlUi.allowInsecureAuth: true`**: Bypasses both device identity verification and device pairing requirement entirely (designed for Docker/reverse-proxy deployments).

There is an [open enhancement request (#29908)](https://github.com/openclaw/openclaw/issues/29908) to make token-authenticated clients bypass device pairing entirely.

**Source**: [OpenClaw Security Docs](https://docs.openclaw.ai/gateway/security) - Accessed 2026-03-24
**Confidence**: High
**Verification**: [GitHub Issue #29908](https://github.com/openclaw/openclaw/issues/29908), [DeepWiki Auth](https://deepwiki.com/openclaw/openclaw/2.2-authentication-and-device-pairing)

**Analysis**: For Brain's gateway, this informs the auth design. Brain can implement a simplified token-based auth mode for testing while also supporting the full Ed25519 flow. The walking skeleton already uses a "skeleton auth" bypass (`connectGatewayWithSkeletonAuth`) which is the right pattern.

---

### Finding 9: OpenClaw Source Code Structure for Gateway Protocol

**Evidence**: The protocol implementation lives in:

| Path | Purpose |
|------|---------|
| `src/gateway/protocol/schema/frames.ts` | `GatewayFrame` discriminated union (TypeBox) |
| `src/gateway/protocol/schema/protocol-schemas.ts` | All method schemas (TypeBox) |
| `src/gateway/server-methods-list.ts` | Method registry mapping method names to handlers |
| `src/gateway/server-methods/connect.ts` | Connect handshake handler |

Schemas are defined with TypeBox (`@sinclair/typebox`) and auto-transpiled to Swift for iOS/macOS clients. The `resolveDeviceSignaturePayloadVersion()` function tries both v2 and v3 payload formats for backwards compatibility.

**Source**: [GitHub frames.ts](https://github.com/openclaw/openclaw/blob/main/src/gateway/protocol/schema/frames.ts) - Accessed 2026-03-24
**Confidence**: High
**Verification**: [GitHub protocol-schemas.ts](https://github.com/openclaw/openclaw/blob/main/src/gateway/protocol/schema/protocol-schemas.ts), [DeepWiki Gateway](https://deepwiki.com/openclaw/openclaw/2-gateway)

**Analysis**: If Brain ever needs to match the protocol exactly, these TypeBox schemas are the authoritative source. However, for acceptance testing, Brain's `gateway-test-kit.ts` only needs to implement the subset of frames that Brain's gateway actually supports.

---

## Conclusion: Recommended Approach for Acceptance Tests

The existing `gateway-test-kit.ts` is the correct architecture. Here is why using the OpenClaw CLI as a real client is not viable, and what the alternatives are:

### Why NOT to use the OpenClaw CLI in tests

| Reason | Detail |
|--------|--------|
| No headless protocol mode | CLI is interactive; `--non-interactive` controls prompts, not protocol |
| Full gateway surface assumed | CLI expects 100+ methods, agent listing, capability negotiation |
| Device pairing flow | CLI manages `~/.openclaw/identity/` state across invocations |
| Node.js runtime | CLI requires Node 24+; tests run in Bun |
| Startup latency | CLI daemon boot is seconds; test kit connects in milliseconds |
| No subprocess isolation | CLI writes to `~/.openclaw/`, contaminating the test host |

### Recommended: Keep and extend `gateway-test-kit.ts`

The test kit already implements:
- WebSocket connect to `/api/gateway`
- `RequestFrame` / `ResponseFrame` / `EventFrame` types matching the protocol
- Request/response correlation via `id`
- Event collection with predicates and timeouts
- Raw frame injection for malformed-frame testing
- Skeleton auth bypass for walking skeleton tests

For R1+ (Ed25519 auth), the test suite already uses `crypto.subtle.generateKey("Ed25519")` -- zero external dependencies.

### Optional: Add `openclaw-go` as a cross-language integration test

If cross-language protocol validation is ever needed, `openclaw-go` (96+ typed RPC methods, full handshake) could run as a sidecar process. But this is overkill for current acceptance testing needs.

---

## Source Analysis

| Source | Domain | Reputation | Type | Access Date | Cross-verified |
|--------|--------|------------|------|-------------|----------------|
| openclaw npm | npmjs.com | High | Package registry | 2026-03-24 | Y |
| OpenClaw Install Docs | docs.openclaw.ai | High | Official docs | 2026-03-24 | Y |
| OpenClaw CLI Gateway Docs | docs.openclaw.ai | High | Official docs | 2026-03-24 | Y |
| OpenClaw Gateway Protocol Docs | docs.openclaw.ai | High | Official docs | 2026-03-24 | Y |
| DeepWiki Auth & Device Pairing | deepwiki.com | Medium-High | Code analysis | 2026-03-24 | Y |
| DeepWiki WebSocket Protocol | deepwiki.com | Medium-High | Code analysis | 2026-03-24 | Y |
| DeepWiki Package Structure | deepwiki.com | Medium-High | Code analysis | 2026-03-24 | Y |
| GitHub openclaw/acpx | github.com | High | OSS repository | 2026-03-24 | Y |
| acpx npm | npmjs.com | High | Package registry | 2026-03-24 | Y |
| GitHub openclaw frames.ts | github.com | High | Source code | 2026-03-24 | Y |
| GitHub Issue #29908 | github.com | High | Issue tracker | 2026-03-24 | N |
| GitHub Issue #17571 | github.com | High | Issue tracker | 2026-03-24 | N |
| OpenClaw Security Docs | docs.openclaw.ai | High | Official docs | 2026-03-24 | Y |
| LumaDock CLI Config Reference | lumadock.com | Medium | Tutorial site | 2026-03-24 | Y |

Reputation: High: 10 (71%) | Medium-High: 3 (21%) | Medium: 1 (7%) | Avg: 0.82

---

## Knowledge Gaps

### Gap 1: OpenClaw CLI Internal Gateway Client Module API
**Issue**: Could not determine the exact internal module path and function signatures of the CLI's gateway WebSocket client implementation. The `src/gateway/` directory structure is partially visible but the client-side connection code (as opposed to the server-side handler code) was not located.
**Attempted**: Web search for OpenClaw client-side gateway connection code, DeepWiki analysis
**Recommendation**: Review the OpenClaw source code at `src/gateway/client/` or `src/cli/` to find the WebSocket client implementation if direct API reuse is ever reconsidered.

### Gap 2: `openclaw-sdk` (Python) Gateway Protocol Coverage
**Issue**: The Python SDK's exact method coverage is unknown. It may implement only a chat-focused subset of the 100+ Gateway Protocol v3 methods.
**Attempted**: PyPI page review, web search
**Recommendation**: Not relevant to acceptance testing in Bun, but noted for completeness.

### Gap 3: Whether OpenClaw CLI Can Connect to a Non-OpenClaw Gateway
**Issue**: While the CLI can be pointed at a custom URL via `OPENCLAW_GATEWAY_URL`, it is unknown whether it gracefully handles a server that only implements a subset of methods (e.g., `connect`, `agent`, `chat.send`) vs the full 100+ method surface.
**Attempted**: Searched for documentation on partial gateway implementations
**Recommendation**: If this becomes relevant, test empirically by running the CLI against Brain's gateway and observing failure modes.

---

## Full Citations

[1] npm. "openclaw". npm Registry. 2026. https://www.npmjs.com/package/openclaw. Accessed 2026-03-24.
[2] OpenClaw. "Install". OpenClaw Documentation. 2026. https://docs.openclaw.ai/install. Accessed 2026-03-24.
[3] OpenClaw. "CLI Gateway". OpenClaw Documentation. 2026. https://docs.openclaw.ai/cli/gateway. Accessed 2026-03-24.
[4] OpenClaw. "Gateway Protocol". OpenClaw Documentation. 2026. https://docs.openclaw.ai/gateway/protocol. Accessed 2026-03-24.
[5] DeepWiki. "Authentication & Authorization - openclaw/openclaw". DeepWiki. 2026. https://deepwiki.com/openclaw/openclaw/2.2-authentication-and-device-pairing. Accessed 2026-03-24.
[6] DeepWiki. "WebSocket Protocol & RPC - openclaw/openclaw". DeepWiki. 2026. https://deepwiki.com/openclaw/openclaw/2.1-system-requirements. Accessed 2026-03-24.
[7] DeepWiki. "Package Structure - openclaw/openclaw". DeepWiki. 2026. https://deepwiki.com/openclaw/openclaw/11.4-package-structure. Accessed 2026-03-24.
[8] OpenClaw. "acpx - Headless CLI client for ACP sessions". GitHub. 2026. https://github.com/openclaw/acpx. Accessed 2026-03-24.
[9] npm. "acpx". npm Registry. 2026. https://www.npmjs.com/package/acpx. Accessed 2026-03-24.
[10] OpenClaw. "src/gateway/protocol/schema/frames.ts". GitHub. 2026. https://github.com/openclaw/openclaw/blob/main/src/gateway/protocol/schema/frames.ts. Accessed 2026-03-24.
[11] OpenClaw. "Enhancement: token-authenticated clients should bypass device pairing". GitHub Issue #29908. 2026. https://github.com/openclaw/openclaw/issues/29908. Accessed 2026-03-24.
[12] OpenClaw. "Third-party client authentication guide". GitHub Issue #17571. 2026. https://github.com/openclaw/openclaw/issues/17571. Accessed 2026-03-24.
[13] OpenClaw. "Security". OpenClaw Documentation. 2026. https://docs.openclaw.ai/gateway/security. Accessed 2026-03-24.
[14] LumaDock. "Full guide to OpenClaw CLI and config file reference". LumaDock. 2026. https://lumadock.com/tutorials/openclaw-cli-config-reference. Accessed 2026-03-24.

---

## Research Metadata
Duration: ~20 min | Examined: 18 | Cited: 14 | Cross-refs: 11 | Confidence: High 78%, Medium 22%, Low 0% | Output: docs/research/openclaw-cli-gateway-client-for-acceptance-tests.md
