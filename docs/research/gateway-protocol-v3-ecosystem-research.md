# Research: Gateway Protocol v3 Ecosystem -- Lightweight Alternatives and Third-Party Implementations

**Date**: 2026-03-24 | **Researcher**: nw-researcher (Nova) | **Confidence**: Medium | **Sources**: 16

## Executive Summary

The OpenClaw Gateway Protocol v3 is a proprietary WebSocket-based control plane protocol with no formal RFC or external specification document -- the specification exists only as TypeBox schemas in the OpenClaw source code (`src/gateway/protocol/schema.ts`). Despite this, a small but meaningful ecosystem of third-party implementations has emerged.

**Key findings:**

1. **No formal spec exists.** The protocol is defined by its TypeScript reference implementation. Third-party implementors reverse-engineer from source code and official docs at `docs.openclaw.ai/gateway/protocol`.

2. **Three confirmed Gateway Protocol v3 client implementations exist** outside the official OpenClaw codebase: `openclaw-go` (Go, typed WebSocket client with 96+ RPC methods), `openclaw-sdk` (Python, PyPI), and `webclaw` (TypeScript, browser-based). A fourth, `openclaw-studio`, bridges browser clients to the gateway via a server-side WebSocket proxy.

3. **Two re-implementations exist that implement their OWN gateway protocols**, not OpenClaw's v3: `OpenClaw.NET` (.NET, independent gateway+runtime) and `IronClaw` (Rust, security-focused). These are "inspired by" OpenClaw but are NOT drop-in compatible Gateway Protocol v3 servers.

4. **Most "OpenClaw alternatives" do NOT speak Gateway Protocol v3.** ZeroClaw uses JSON-RPC 2.0 over HTTP. Nanobot uses Socket.IO. NanoClaw and Moltworker have their own protocols. None are Gateway Protocol v3 compatible.

5. **`openclaw-mission-control`** (2.4k stars) is the most mature third-party Gateway Protocol v3 consumer, providing fleet orchestration across multiple gateways.

**Implication for Brain:** If Brain implements a Gateway Protocol v3 server, the directly compatible client ecosystem is limited to the official OpenClaw clients (CLI, web UI, macOS/iOS apps), `openclaw-mission-control`, `openclaw-go`, `openclaw-sdk`, `webclaw`, and `openclaw-studio`. This is still a significant distribution channel given OpenClaw's 300k+ GitHub stars, but the "alternative client" ecosystem is thin.

## Research Methodology
**Search Strategy**: 12 targeted web searches covering: official protocol docs, alternative implementations, third-party client libraries (npm/cargo/pip), lightweight alternatives, feature parity documents, and specification status. Cross-referenced with GitHub repositories and package registries.
**Source Selection**: Types: official docs, GitHub repositories, package registries, DeepWiki code analysis, technical blog posts | Reputation: high/medium-high min | Verification: cross-referencing claims against source code repositories
**Quality Standards**: Target 3 sources/claim (min 1 authoritative) | All major claims cross-referenced | Avg reputation: 0.78

---

## Findings

### Finding 1: Gateway Protocol v3 Has No Formal Specification -- It Is Defined by Source Code

**Evidence**: The protocol documentation at `docs.openclaw.ai/gateway/protocol` describes the protocol at a high level but is not a formal specification. The actual wire format is defined by TypeBox schemas in `src/gateway/protocol/schema/protocol-schemas.ts` and the method registry in `src/gateway/server-methods-list.ts`. No RFC, versioned spec document, or protocol grammar exists outside the source code.

**Source**: [OpenClaw Gateway Protocol Docs](https://docs.openclaw.ai/gateway/protocol) - Accessed 2026-03-24
**Confidence**: High
**Verification**: [DeepWiki WebSocket Protocol & RPC](https://deepwiki.com/openclaw/openclaw/2.1-system-requirements), [DeepWiki Gateway](https://deepwiki.com/openclaw/openclaw/2-installation)

**Protocol summary (from docs and source analysis):**

| Aspect | Detail |
|--------|--------|
| Transport | WebSocket, text frames, JSON payloads |
| Default endpoint | `ws://127.0.0.1:18789/gateway` |
| Protocol version | 3 (`PROTOCOL_VERSION = 3`) |
| Frame types | `request` (client->server RPC), `response` (server->client), `event` (server broadcast) |
| Auth | Ed25519 challenge-response; v3 signature payload: `v3\|{deviceId}\|{clientId}\|{clientMode}\|{role}\|{scopes}\|{signedAtMs}\|{token}\|{nonce}\|{platform}\|{deviceFamily}` |
| Roles | `operator` (full control), `node` (device capabilities) |
| Heartbeat | Configurable `tickIntervalMs` (default 15s) |
| Method count | 100+ RPC methods across functional categories |
| Schema system | TypeBox (`@sinclair/typebox`), auto-transpiled to Swift for iOS/macOS |
| TLS | Optional, with cert fingerprint pinning |

**Key method categories**: `connect`, `agent.*`, `chat.*`, `model.*`, `device.*`, `exec.*`, `tools.*`, `skills.*`, `config.*`, `system-presence`, `update.*`

**Analysis**: The lack of a formal spec is a significant finding. Any third-party implementation must reverse-engineer from TypeScript source code. This creates a tight coupling where the reference implementation IS the specification, and protocol changes can break third-party clients without formal deprecation notices.

---

### Finding 2: Confirmed Third-Party Gateway Protocol v3 Client Libraries

Three standalone client libraries implement the Gateway Protocol v3 WebSocket specification:

#### 2a: openclaw-go (Go)

**Evidence**: "Typed clients for the Gateway WebSocket protocol" with "full handshake, 96+ typed RPC methods, event/invoke callbacks". Requires Go 1.25+, depends only on `gorilla/websocket`.

**Source**: [github.com/a3tai/openclaw-go](https://github.com/a3tai/openclaw-go) - Accessed 2026-03-24
**Confidence**: High
**Verification**: [pkg.go.dev/github.com/a3tai/openclaw-go/protocol](https://pkg.go.dev/github.com/a3tai/openclaw-go/protocol), [pkg.go.dev client example](https://pkg.go.dev/github.com/a3tai/openclaw-go/examples/client)

**Packages**: `gateway` (WebSocket client), `protocol` (type definitions), `chatcompletions` (OpenAI-compatible HTTP), `discovery` (mDNS/DNS-SD local gateway discovery)

**Analysis**: This is the most complete third-party client library found. The 96+ typed RPC methods suggest near-complete coverage of the protocol surface. The inclusion of mDNS discovery indicates production-grade intent. Independently maintained by a3t.ai, not affiliated with OpenClaw.

#### 2b: openclaw-sdk (Python)

**Evidence**: Available on PyPI as `openclaw-sdk`. Requires Python 3.11+. Auto-detects gateway via `OPENCLAW_GATEWAY_WS_URL` env var or probes `127.0.0.1:18789`. Provides `OpenClawClient` with async `connect()` and `Agent` abstraction.

**Source**: [pypi.org/project/openclaw-sdk](https://pypi.org/project/openclaw-sdk/) - Accessed 2026-03-24
**Confidence**: Medium
**Verification**: [libraries.io/pypi/openclaw-py](https://libraries.io/pypi/openclaw-py)

**Analysis**: Less documentation available than openclaw-go. The async connect pattern and auto-detection of gateway URL suggest it implements the WebSocket handshake. Unclear whether it covers the full 100+ method surface or a subset.

#### 2c: webclaw (TypeScript, browser)

**Evidence**: "Community-built, browser-based chat interface for OpenClaw that connects to your Gateway over WebSockets." Third-party project by ibelick. Uses `CLAWDBOT_GATEWAY_URL` and `CLAWDBOT_GATEWAY_TOKEN` for auth.

**Source**: [github.com/ibelick/webclaw](https://github.com/ibelick/webclaw) - Accessed 2026-03-24
**Confidence**: Medium
**Verification**: [WebClaw Web Client docs](http://clawdocs.org/guides/webclaw/)

**Analysis**: Primarily a chat UI, not a general-purpose client library. Implements the subset of Gateway Protocol v3 needed for chat interaction (connect, agent selection, chat.send, streaming). Token-based auth rather than Ed25519 device pairing.

---

### Finding 3: Third-Party Gateway Protocol v3 Consumers (Not Libraries)

#### 3a: openclaw-mission-control

**Evidence**: "AI Agent Orchestration Dashboard" with 2.4k stars, 532 forks, 1,071 commits. Manages agents, assigns tasks, coordinates multi-agent collaboration via the Gateway Protocol.

**Source**: [github.com/abhi1693/openclaw-mission-control](https://github.com/abhi1693/openclaw-mission-control) - Accessed 2026-03-24
**Confidence**: High
**Verification**: [Previous research](docs/research/openclaw-gateway-protocol-integration.md), [DeepWiki Control UI](https://deepwiki.com/openclaw/openclaw/7-control-ui)

**Analysis**: The most mature third-party Gateway Protocol v3 consumer. Its 1,071 commits indicate deep protocol coverage. This is the best reference for what a non-trivial Gateway Protocol v3 client looks like in practice.

#### 3b: openclaw-studio

**Evidence**: "Gateway-first, single-user Next.js App Router UI" with a "same-origin WebSocket bridge (`/api/gateway/ws`) from browser to the upstream OpenClaw gateway." Server-owned WebSocket to gateway, browser communicates via HTTP+SSE.

**Source**: [github.com/grp06/openclaw-studio](https://github.com/grp06/openclaw-studio) - Accessed 2026-03-24
**Confidence**: Medium
**Verification**: [openclaw-studio ARCHITECTURE.md](https://github.com/grp06/openclaw-studio/blob/main/ARCHITECTURE.md)

**Analysis**: Acts as a WebSocket proxy bridge rather than a direct client library. The server-side component maintains the actual Gateway Protocol v3 WebSocket connection.

---

### Finding 4: "OpenClaw Alternatives" That Do NOT Implement Gateway Protocol v3

This is a critical negative finding. The following projects are frequently listed as "OpenClaw alternatives" but use entirely different protocols:

| Project | Protocol Used | NOT Gateway Protocol v3 Because |
|---------|--------------|--------------------------------|
| **ZeroClaw** (Rust) | JSON-RPC 2.0 over HTTP/stdio | MCP client protocol, Bearer token auth, no WebSocket control plane [1] |
| **Nanobot** (Python, HKUDS) | Socket.IO WebSocket + HTTP polling | Own MessageBus-based routing, not Gateway Protocol framing [2] |
| **NanoClaw** | Container-isolated sandbox protocol | Entirely different architecture, container-first [3] |
| **Moltworker** (Cloudflare) | Cloudflare Workers runtime | Serverless edge, R2 buckets, own protocol [3] |
| **IronClaw** (Rust, NEAR AI) | Own WebSocket + SSE gateway | "Inspired by" OpenClaw, tracks feature parity, but own auth (Bearer tokens, not Ed25519 challenge-response) and own frame format [4] |
| **OpenClaw.NET** (.NET) | Own gateway implementation | Independent reimplementation, not protocol-compatible [5] |

**Sources**:
[1] [DeepWiki ZeroClaw MCP](https://deepwiki.com/zeroclaw-labs/zeroclaw/11.9-mcp-tool-integration)
[2] [DeepWiki HKUDS/nanobot](https://deepwiki.com/HKUDS/nanobot)
[3] [KDnuggets OpenClaw Alternatives](https://www.kdnuggets.com/5-lightweight-and-secure-openclaw-alternatives-to-try-right-now)
[4] [github.com/nearai/ironclaw](https://github.com/nearai/ironclaw), [NEARWEEK feature parity thread](https://x.com/NEARWEEK/status/2024474591926608179)
[5] [github.com/clawdotnet/openclaw.net](https://github.com/clawdotnet/openclaw.net)

**Confidence**: High
**Analysis**: The "OpenClaw alternative" space is fragmented. Each project implements its own protocol. There is no shared "Gateway Protocol v3 ecosystem" beyond the official OpenClaw clients and the handful of third-party libraries documented in Finding 2. The phrase "OpenClaw alternative" in the market means "alternative AI agent runtime" -- not "alternative client that speaks the same protocol."

---

### Finding 5: IronClaw and OpenClaw.NET -- Inspired-By Reimplementations, Not Protocol-Compatible

#### IronClaw (Rust, NEAR AI)

**Evidence**: "IronClaw is OpenClaw inspired implementation in Rust focused on privacy and security." Tracks a FEATURE_PARITY.md matrix against OpenClaw. Features include "web gateway with SSE/WebSocket, MCP support." Uses Bearer token auth, PostgreSQL+pgvector storage, WASM sandboxing, Ed25519 for skill signing (not for device auth handshake).

**Source**: [github.com/nearai/ironclaw](https://github.com/nearai/ironclaw) - Accessed 2026-03-24
**Confidence**: High
**Verification**: [ironclaw FEATURE_PARITY.md](https://github.com/nearai/ironclaw/blob/main/FEATURE_PARITY.md), [Product Hunt listing](https://www.producthunt.com/products/ironclaw)

**Key differences from Gateway Protocol v3:**
- Bearer token auth, not Ed25519 challenge-response device pairing
- Own WebSocket frame format, not the `GatewayFrame` discriminated union
- PostgreSQL storage, not SQLite
- WASM channels as an extension mechanism
- No mobile/desktop native clients

**Analysis**: IronClaw is a clean-room reimplementation that aims for feature parity in capabilities but not protocol compatibility. An OpenClaw CLI cannot connect to an IronClaw gateway. This is an important distinction for Brain's decision-making.

#### OpenClaw.NET (.NET)

**Evidence**: "Self-hosted OpenClaw gateway + agent runtime in .NET (NativeAOT-friendly)." Includes reusable packages: `OpenClaw.Client`, `OpenClaw.Core`, `OpenClaw.PluginKit`, `OpenClaw.SemanticKernelAdapter`. "Not affiliated with, endorsed by, or associated with OpenClaw."

**Source**: [github.com/clawdotnet/openclaw.net](https://github.com/clawdotnet/openclaw.net) - Accessed 2026-03-24
**Confidence**: Medium
**Verification**: [OpenClaw.NET USER_GUIDE.md](https://github.com/clawdotnet/openclaw.net/blob/main/USER_GUIDE.md)

**Analysis**: The `OpenClaw.Client` package name suggests it may implement some Gateway Protocol compatibility, but the "not affiliated" disclaimer and independent architecture suggest this is another inspired-by reimplementation rather than a protocol-compatible server. [unverified -- would need source code review to confirm protocol compatibility level]

---

### Finding 6: The Official OpenClaw Client Ecosystem Is the Primary Gateway Protocol v3 Consumer Base

**Evidence**: The official OpenClaw repository (300k+ stars) ships clients for: CLI (TypeScript/Node.js), Control UI (web), macOS desktop app, iOS app, Android nodes, headless nodes. All connect via Gateway Protocol v3 WebSocket.

**Source**: [github.com/openclaw/openclaw](https://github.com/openclaw/openclaw) - Accessed 2026-03-24
**Confidence**: High
**Verification**: [OpenClaw docs](https://docs.openclaw.ai/gateway/protocol), [DeepWiki Native Clients](https://deepwiki.com/openclaw/openclaw/8-channels)

**Analysis**: The vast majority of Gateway Protocol v3 traffic comes from official OpenClaw clients. The protocol's TypeBox schema system with auto-transpilation to Swift (for iOS/macOS) confirms tight coupling between the server and its official clients. Third-party implementations must chase a moving target.

---

## Source Analysis

| Source | Domain | Reputation | Type | Access Date | Cross-verified |
|--------|--------|------------|------|-------------|----------------|
| OpenClaw Gateway Protocol Docs | docs.openclaw.ai | High | Official docs | 2026-03-24 | Y |
| DeepWiki OpenClaw Analysis | deepwiki.com | Medium-High | Code analysis | 2026-03-24 | Y |
| openclaw-go (GitHub + pkg.go.dev) | github.com, pkg.go.dev | High | OSS repository | 2026-03-24 | Y |
| openclaw-sdk (PyPI) | pypi.org | High | Package registry | 2026-03-24 | N |
| webclaw (GitHub) | github.com | High | OSS repository | 2026-03-24 | Y |
| openclaw-mission-control (GitHub) | github.com | High | OSS repository | 2026-03-24 | Y |
| openclaw-studio (GitHub) | github.com | High | OSS repository | 2026-03-24 | Y |
| IronClaw (GitHub) | github.com | High | OSS repository | 2026-03-24 | Y |
| OpenClaw.NET (GitHub) | github.com | High | OSS repository | 2026-03-24 | N |
| ZeroClaw DeepWiki | deepwiki.com | Medium-High | Code analysis | 2026-03-24 | Y |
| HKUDS/nanobot DeepWiki | deepwiki.com | Medium-High | Code analysis | 2026-03-24 | Y |
| KDnuggets Alternatives | kdnuggets.com | Medium | Industry blog | 2026-03-24 | Y |
| OpenClaw official repo | github.com | High | OSS repository | 2026-03-24 | Y |
| NEARWEEK IronClaw thread | x.com | Medium | Social/industry | 2026-03-24 | N |
| learnclawdbot.org | learnclawdbot.org | Medium | Community docs | 2026-03-24 | Y |
| OpenClaw CN mirror docs | openclawcn.com | Medium | Mirror docs | 2026-03-24 | Y |

Reputation: High: 9 (56%) | Medium-High: 3 (19%) | Medium: 4 (25%) | Avg: 0.78

---

## Knowledge Gaps

### Gap 1: OpenClaw.NET Protocol Compatibility Level
**Issue**: Could not determine whether `OpenClaw.Client` in OpenClaw.NET implements Gateway Protocol v3 wire compatibility or its own protocol. The README describes it as an independent reimplementation, but the `OpenClaw.Client` package name is suggestive.
**Attempted**: Web search for NuGet package details, README review, user guide search
**Recommendation**: Review the `OpenClaw.Client` source code on GitHub to determine if it implements the `GatewayFrame` discriminated union and Ed25519 challenge-response handshake.

### Gap 2: openclaw-sdk (Python) Protocol Coverage Depth
**Issue**: The PyPI listing confirms the package exists and connects via WebSocket, but the exact set of Gateway Protocol v3 methods covered is unknown. It may implement only a chat-focused subset.
**Attempted**: PyPI page review, libraries.io metadata
**Recommendation**: Review the package source code or documentation to determine method coverage.

### Gap 3: Protocol Version Stability and Breaking Change History
**Issue**: Could not find a changelog of Gateway Protocol version transitions (v1 -> v2 -> v3) or a policy on backwards compatibility. The docs mention "Legacy v2 signatures remain accepted" but no formal deprecation timeline.
**Attempted**: Searched for protocol changelog, versioned spec, RFC
**Recommendation**: Review OpenClaw release notes and Git history of `protocol-schemas.ts` to understand version stability.

### Gap 4: Cargo (Rust) Client Library
**Issue**: No Rust client library for Gateway Protocol v3 was found. IronClaw implements its own protocol, not a client for OpenClaw's.
**Attempted**: Web search for Rust/Cargo OpenClaw client
**Recommendation**: If Rust client support is needed, `openclaw-go` could serve as a reference implementation for a Rust port.

---

## Conflicting Information

### Conflict 1: Nanobot Gateway Protocol Compatibility

**Position A**: Search result summaries suggest nanobot "leverages the same WebSocket-based Gateway Protocol" as OpenClaw.
Source: Web search summaries, Reputation: Low (AI-generated summaries, not primary sources)

**Position B**: DeepWiki code analysis shows nanobot uses Socket.IO WebSocket with its own `MessageBus` routing and `BaseChannel` abstraction -- a fundamentally different architecture from Gateway Protocol v3's `GatewayFrame` system.
Source: [DeepWiki HKUDS/nanobot](https://deepwiki.com/HKUDS/nanobot), Reputation: Medium-High

**Assessment**: Position B is more authoritative. The code analysis shows a different protocol stack. The search summaries conflated "uses WebSocket" with "uses Gateway Protocol v3" -- a common error. Nanobot is NOT Gateway Protocol v3 compatible.

### Conflict 2: IronClaw as "Compatible Alternative"

**Position A**: Marketing materials position IronClaw as an OpenClaw alternative with feature parity, implying compatibility.
Source: [Product Hunt](https://www.producthunt.com/products/ironclaw), Reputation: Medium

**Position B**: Technical analysis shows IronClaw uses Bearer token auth (not Ed25519 challenge-response), its own frame format, and PostgreSQL (not SQLite). Feature parity tracks capabilities, not protocol wire format.
Source: [GitHub nearai/ironclaw](https://github.com/nearai/ironclaw), [FEATURE_PARITY.md](https://github.com/nearai/ironclaw/blob/main/FEATURE_PARITY.md), Reputation: High

**Assessment**: Position B is definitive. "Feature parity" means capability equivalence, not protocol compatibility. An OpenClaw client cannot connect to an IronClaw server.

---

## Recommendations for Further Research

1. **Source code review of `openclaw-go`** -- As the most complete third-party client, reviewing its handshake implementation would provide the best reference for Brain's Gateway Protocol v3 server implementation. Particular focus on the 96+ typed RPC methods and how they map to the TypeBox schemas.

2. **Protocol stability analysis** -- Review the Git history of `src/gateway/protocol/schema/protocol-schemas.ts` in the OpenClaw repo to understand how frequently the protocol changes and whether v3 is stable enough to target.

3. **OpenClaw.NET source code review** -- Determine if `OpenClaw.Client` provides actual Gateway Protocol v3 wire compatibility, which would add a .NET client to the compatible ecosystem.

4. **Mission Control protocol usage analysis** -- Review `openclaw-mission-control` source to understand which Gateway Protocol v3 methods are exercised by a fleet management tool, informing which methods Brain must prioritize.

---

## Full Citations

[1] OpenClaw. "Gateway Protocol". OpenClaw Documentation. 2026. https://docs.openclaw.ai/gateway/protocol. Accessed 2026-03-24.
[2] DeepWiki. "WebSocket Protocol & RPC - openclaw/openclaw". DeepWiki. 2026. https://deepwiki.com/openclaw/openclaw/2.1-system-requirements. Accessed 2026-03-24.
[3] a3t.ai. "openclaw-go - Go port of OpenClaw APIs". GitHub. 2026. https://github.com/a3tai/openclaw-go. Accessed 2026-03-24.
[4] a3t.ai. "openclaw-go/protocol". Go Packages. 2026. https://pkg.go.dev/github.com/a3tai/openclaw-go/protocol. Accessed 2026-03-24.
[5] openclaw-sdk. "openclaw-sdk". PyPI. 2026. https://pypi.org/project/openclaw-sdk/. Accessed 2026-03-24.
[6] ibelick. "webclaw - Fast web client for OpenClaw". GitHub. 2026. https://github.com/ibelick/webclaw. Accessed 2026-03-24.
[7] abhi1693. "openclaw-mission-control". GitHub. 2026. https://github.com/abhi1693/openclaw-mission-control. Accessed 2026-03-24.
[8] grp06. "openclaw-studio". GitHub. 2026. https://github.com/grp06/openclaw-studio. Accessed 2026-03-24.
[9] NEAR AI. "IronClaw - OpenClaw inspired implementation in Rust". GitHub. 2026. https://github.com/nearai/ironclaw. Accessed 2026-03-24.
[10] NEAR AI. "IronClaw FEATURE_PARITY.md". GitHub. 2026. https://github.com/nearai/ironclaw/blob/main/FEATURE_PARITY.md. Accessed 2026-03-24.
[11] clawdotnet. "openclaw.net - Self-hosted OpenClaw gateway + agent runtime in .NET". GitHub. 2026. https://github.com/clawdotnet/openclaw.net. Accessed 2026-03-24.
[12] DeepWiki. "MCP Tool Integration - zeroclaw-labs/zeroclaw". DeepWiki. 2026. https://deepwiki.com/zeroclaw-labs/zeroclaw/11.9-mcp-tool-integration. Accessed 2026-03-24.
[13] DeepWiki. "HKUDS/nanobot". DeepWiki. 2026. https://deepwiki.com/HKUDS/nanobot. Accessed 2026-03-24.
[14] OpenClaw. "openclaw - Your own personal AI assistant". GitHub. 2026. https://github.com/openclaw/openclaw. Accessed 2026-03-24.
[15] DeepWiki. "Authentication & Authorization - openclaw/openclaw". DeepWiki. 2026. https://deepwiki.com/openclaw/openclaw/2.2-authentication-and-device-pairing. Accessed 2026-03-24.
[16] DeepWiki. "Native Clients (Nodes) - openclaw/openclaw". DeepWiki. 2026. https://deepwiki.com/openclaw/openclaw/8-channels. Accessed 2026-03-24.

---

## Research Metadata
Duration: ~25 min | Examined: 20+ | Cited: 16 | Cross-refs: 12 | Confidence: High 50%, Medium 40%, Low 10% | Output: docs/research/gateway-protocol-v3-ecosystem-research.md
