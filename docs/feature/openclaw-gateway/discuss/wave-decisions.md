# DISCUSS Decisions — openclaw-gateway

## Key Decisions

- [D1] **Feature type: Cross-cutting** — spans WebSocket transport, auth, orchestrator integration, event streaming, governance, and observability (see: `requirements.md`)
- [D2] **Walking skeleton: Yes** — validates full pipeline (connect → execute → stream → trace) with hardcoded identity before building real Ed25519 auth (see: `story-map.md` § Walking Skeleton)
- [D3] **UX research depth: Comprehensive** — two full journeys with emotional arcs, error paths, and shared artifact tracking (see: `journey-*-visual.md`)
- [D4] **JTBD analysis: Yes** — 7 job stories ground all user stories and prioritization (see: `jtbd-*.md`)
- [D5] **Exclude Mission Control Operator persona** — per user direction, focus on developer and agent personas only (see: `jtbd-job-stories.md` § Personas)
- [D6] **Zero new SurrealDB tables** — only 4 field additions to existing `agent` table (see: GitHub issue §Schema changes)
- [D7] **Bun native WebSocket** — no external WS library needed (see: research doc §4)
- [D8] **Ed25519 → DPoP key reuse** — same device key pair serves both protocols (see: research doc §5)

## Requirements Summary

- **Primary jobs**: Context-aware coding sessions (J1, opportunity 16), governed agent execution (J3, opportunity 15), multi-agent coordination (J6, opportunity 14)
- **Walking skeleton scope**: WS upgrade + hardcoded identity → `agent` method → orchestrator with context injection → token streaming → trace recording
- **Feature type**: Cross-cutting (transport, auth, orchestrator, events, governance, observability)

## Constraints Established

- Gateway endpoint MUST coexist with existing HTTP/SSE APIs (NFR-6)
- Zero additional latency — frame dispatch < 1ms (NFR-1)
- API keys never exposed to gateway clients (NFR-5)
- Protocol frames must be parseable by standard OpenClaw clients without modifications (NFR-2)
- Every gateway session must pass through policy evaluation — no bypass path (KPI-4: 100%)

## Upstream Changes

- No DISCOVER artifacts exist — this DISCUSS wave is the first structured analysis
- Research doc (`docs/research/openclaw-native-gateway-architecture.md`) was consumed as input but not modified
- **Post-DESIGN protocol alignment** (2026-03-24): Real Gateway Protocol v3 spec consulted. Connect handshake updated from two-step (connect → connect.verify) to single-frame connect with device identity. Method names aligned: `sessions.*` namespace, `tools.catalog`, `config.get`. Error codes aligned with protocol-standard `DEVICE_AUTH_*`. Requirements FR-8/8a/8b and acceptance criteria AC-1.1/1.5/2.3/2.4/2.5/2.6 updated.
