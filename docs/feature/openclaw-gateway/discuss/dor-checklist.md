# Definition of Ready Checklist — openclaw-gateway

## DoR Items

### 1. User stories are written from the user's perspective
- [x] All stories use "As a [persona], I want to [action], so that [outcome]" format
- [x] Personas: Coding Agent Developer, Platform Engineer, Autonomous Agent
- [x] Mission Control Operator excluded per scope decision
- **Evidence**: `user-stories.md` — 16 stories across 4 releases

### 2. Acceptance criteria are testable and unambiguous
- [x] All criteria use Given-When-Then Gherkin format
- [x] Each criterion specifies exact protocol frames (type, method, payload structure)
- [x] Error cases have specific error codes and response formats
- **Evidence**: `acceptance-criteria.md` — AC for all releases, `journey-*.feature` files

### 3. Dependencies are identified
- [x] Walking skeleton has zero external dependencies (uses existing Brain infra)
- [x] R1 depends on Ed25519 crypto (Bun native `crypto.subtle`)
- [x] R1 depends on DCR endpoint (existing `/api/oauth/register` or new internal route)
- [x] R2 depends on R1 (auth required for execution pipeline)
- [x] R3 depends on R2 (governance applies to execution)
- **Evidence**: `story-map.md` § Dependency Graph

### 4. Technical feasibility is confirmed
- [x] Bun has native WebSocket support — no new dependencies
- [x] Brain already has 80% of the business logic (orchestrator, auth, traces, policies)
- [x] Schema changes are minimal (4 new fields on existing `agent` table)
- [x] New domain `app/src/server/gateway/` — clean separation
- **Evidence**: Research doc §4, GitHub issue §Design

### 5. Scope is bounded and estimated
- [x] Walking skeleton: 1 route, 1 method handler, 1 event bridge
- [x] R1: 6 stories (auth + protocol framing)
- [x] R2: 4 stories (execution + streaming)
- [x] R3: 5 stories (governance + multi-agent)
- [x] R4: 5 stories (device management + polish) — explicitly "Could"
- **Evidence**: `story-map.md`, `prioritization.md`

### 6. UX/journey is mapped
- [x] Two comprehensive journeys: Agent Connect & Execute, Platform Governance
- [x] Emotional arcs defined for both journeys
- [x] Error paths documented with recovery actions
- [x] Shared artifacts registry tracks all `${variables}` to single sources
- **Evidence**: `journey-*-visual.md`, `journey-*.yaml`, `shared-artifacts-registry.md`

### 7. JTBD analysis grounds the work
- [x] 7 job stories with functional/emotional/social dimensions
- [x] Four Forces analysis for all 7 jobs
- [x] Opportunity scores computed — J1, J3, J6 are highest opportunity
- [x] Every user story traces to at least one job
- **Evidence**: `jtbd-job-stories.md`, `jtbd-four-forces.md`, `jtbd-opportunity-scores.md`

### 8. Non-functional requirements are specified
- [x] Latency: < 1ms overhead (NFR-1)
- [x] Protocol compliance: standard OpenClaw clients (NFR-2)
- [x] Schema minimalism: zero new tables (NFR-3)
- [x] Observability: OTel spans (NFR-4)
- [x] Security: cryptographic auth, no key exposure (NFR-5)
- [x] Backward compatibility: coexists with HTTP/SSE APIs (NFR-6)
- **Evidence**: `requirements.md` § Non-Functional Requirements

### 9. Outcome KPIs are defined with measurable targets
- [x] 5 primary KPIs tied to highest-opportunity jobs
- [x] 4 secondary KPIs for quality signals
- [x] Leading indicators with action thresholds
- [x] SurrealDB queries and OTel attributes specified for measurement
- **Evidence**: `outcome-kpis.md`

## DoR Verdict: **PASS** (9/9)

All items validated with evidence. Ready for DESIGN wave handoff.
