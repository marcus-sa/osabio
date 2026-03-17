# Definition of Ready Validation: Graph-Reactive Agent Coordination

## SP-GRC-01: SurrealDB LIVE SELECT Transport Feasibility

**Type**: Spike -- DoR validation not applicable (spikes have time-box and learning objectives, not UAT scenarios).
**Status**: READY (time-boxed at 2 days, clear learning objectives, deliverables defined)

---

## US-GRC-01: Live Governance Feed via SSE

| DoR Item | Status | Evidence |
|----------|--------|----------|
| 1. Problem statement clear, domain language | PASS | "Marcus Oliveira manually refreshes the feed page 8-10 times per session"; specific persona, specific pain in domain terms |
| 2. User/persona with specific characteristics | PASS | Marcus Oliveira, workspace admin, checks feed 10-15x/day, Chrome on MacBook |
| 3. 3+ domain examples with real data | PASS | 4 examples: decision confirmation live, observer warning surfaces, connection recovery, high-volume burst -- all with real entity IDs and timestamps |
| 4. UAT scenarios (3-7) | PASS | 6 scenarios covering: SSE connection, live update, tier transition, reconnect delta, extended disconnect, keep-alive |
| 5. AC derived from UAT | PASS | 9 AC items, each traceable to UAT scenario |
| 6. Right-sized (1-3 days, 3-7 scenarios) | PASS | 3 days estimated, 6 scenarios |
| 7. Technical notes identify constraints | PASS | WebSocket transport dependency, SSE registry refactor, LIVE SELECT table exclusions, GovernanceFeedItem sharing |
| 8. Dependencies resolved or tracked | PASS | SP-GRC-01 (spike, tracked), SSE registry refactor (tracked), transport protocol change (tracked) |

**DoR Status**: PASSED

---

## US-GRC-02: Graph Event Classifier

| DoR Item | Status | Evidence |
|----------|--------|----------|
| 1. Problem statement clear, domain language | PASS | "All graph changes treated equally"; distinguishes noise from signal in domain terms |
| 2. User/persona with specific characteristics | PASS | Marcus (noise filtering) + Agent Coordinator (deterministic classification) |
| 3. 3+ domain examples with real data | PASS | 4 examples: decision confirmation multi-target, decision superseded interrupt, info observation log-only, conflict observation interrupt |
| 4. UAT scenarios (3-7) | PASS | 6 scenarios covering all classification paths |
| 5. AC derived from UAT | PASS | 7 AC items traceable to scenarios |
| 6. Right-sized (1-3 days, 3-7 scenarios) | PASS | 2 days estimated, 6 scenarios |
| 7. Technical notes identify constraints | PASS | No LLM in classifier, graph traversal for dependencies, DEFINE EVENT coexistence |
| 8. Dependencies resolved or tracked | PASS | US-GRC-01 (tracked), graph traversal queries (tracked) |

**DoR Status**: PASSED

---

## US-GRC-03: Agent Coordinator with Context Injection

| DoR Item | Status | Evidence |
|----------|--------|----------|
| 1. Problem statement clear, domain language | PASS | "Marcus acts as integration layer between agents"; specific relay pain |
| 2. User/persona with specific characteristics | PASS | Marcus (oversight), Chat Agent (orchestrator), Coding agents (MCP) |
| 3. 3+ domain examples with real data | PASS | 4 examples: enqueue context, interrupt context, loop dampening, no active session skip |
| 4. UAT scenarios (3-7) | PASS | 7 scenarios covering: enqueue delivery, tool-turn injection, batch, TTL, skip inactive, dampening activate, dampening reset |
| 5. AC derived from UAT | PASS | 10 AC items traceable to scenarios |
| 6. Right-sized (1-3 days, 3-7 scenarios) | PASS | 3 days estimated, 7 scenarios |
| 7. Technical notes identify constraints | PASS | In-memory queue, tool-use loop hook points, KNN+WHERE bug awareness, never-cancel rule |
| 8. Dependencies resolved or tracked | PASS | US-GRC-01, US-GRC-02 (tracked), session lifecycle (existing) |

**DoR Status**: PASSED

---

## US-GRC-04: Mid-Session Interrupt Context Injection

| DoR Item | Status | Evidence |
|----------|--------|----------|
| 1. Problem statement clear, domain language | PASS | "Agent works for 15+ minutes on task whose foundational decision was just superseded" |
| 2. User/persona with specific characteristics | PASS | Marcus (zero wasted work), coding agents (immediate awareness) |
| 3. 3+ domain examples with real data | PASS | 4 examples: decision superseded, task blocked, conflict observation, interrupt during streaming |
| 4. UAT scenarios (3-7) | PASS | 5 scenarios covering: superseded interrupt, no-cancel streaming, task blocked, conflict observation, multiple interrupt consolidation |
| 5. AC derived from UAT | PASS | 7 AC items traceable to scenarios |
| 6. Right-sized (1-3 days, 3-7 scenarios) | PASS | 2 days estimated, 5 scenarios |
| 7. Technical notes identify constraints | PASS | Priority over enqueue, MCP integration, SSE stream completion, feed notification |
| 8. Dependencies resolved or tracked | PASS | US-GRC-02, US-GRC-03 (tracked), streaming infrastructure (existing) |

**DoR Status**: PASSED

---

## Summary

| Story | DoR Status | Ready for DESIGN |
|-------|-----------|------------------|
| SP-GRC-01 | N/A (Spike) | Yes (time-boxed) |
| US-GRC-01 | PASSED (8/8) | Yes |
| US-GRC-02 | PASSED (8/8) | Yes |
| US-GRC-03 | PASSED (8/8) | Yes |
| US-GRC-04 | PASSED (8/8) | Yes |

All stories pass the Definition of Ready hard gate. Ready for handoff to DESIGN wave (solution-architect).

---

## Anti-Pattern Check

| Anti-Pattern | Status | Evidence |
|-------------|--------|----------|
| Implement-X | CLEAR | All stories start from user pain, not "Implement LIVE SELECT" |
| Generic data | CLEAR | Real names (Marcus Oliveira, Tomas Chen), real entity IDs (decision:d-99, task:t-47), real timestamps |
| Technical AC | CLEAR | AC describe observable outcomes ("item appears within 2 seconds"), not implementation ("use WebSocket") |
| Oversized story | CLEAR | All stories 2-3 days, 5-7 scenarios |
| Abstract requirements | CLEAR | 3-4 domain examples per story with concrete data |
