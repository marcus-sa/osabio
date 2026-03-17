# Graph-Reactive Coordination -- Test Scenarios

## Summary

| Category | Count |
|----------|-------|
| Walking Skeletons | 2 |
| Happy Path (focused) | 8 |
| Error/Edge Path | 7 |
| Boundary | 3 |
| **Total** | **20** |
| **Error/Edge Ratio** | **50%** (10/20 including boundary) |

## Implementation Sequence (One-at-a-Time TDD)

Enable in this order. Each test should pass before enabling the next.

| # | File | Scenario | Story | Skip? |
|---|------|----------|-------|-------|
| 1 | walking-skeleton | Admin sees new observation in feed without refreshing | US-GRC-01 | **enabled** |
| 2 | walking-skeleton | Admin sees confirmed decision move between tiers | US-GRC-01 | **enabled** |
| 3 | milestone-1 | Feed establishes SSE connection for workspace | US-GRC-01 | **enabled** |
| 4 | milestone-1 | New observation appears within 2 seconds | US-GRC-01 | skip |
| 5 | milestone-1 | SSE feed items match GET endpoint contract | US-GRC-01 | skip |
| 6 | milestone-1 | Decision confirmation moves item between tiers | US-GRC-01 | skip |
| 7 | milestone-1 | Blocked task surfaces in review tier | US-GRC-01 | skip |
| 8 | milestone-1 | SSE keep-alive maintains connection | US-GRC-01 | skip |
| 9 | milestone-1 | Missed events delivered after reconnection | US-GRC-01 | skip |
| 10 | milestone-1 | No duplicate feed items after reconnection | US-GRC-01 | skip |
| 11 | milestone-1 | Rapid graph changes batched into fewer SSE events | US-GRC-01 | skip |
| 12 | milestone-2 | Observation routed to semantically matched agent | US-GRC-03 | skip |
| 13 | milestone-2 | Observation routed to multiple matching agents | US-GRC-03 | skip |
| 14 | milestone-2 | Irrelevant agent not matched below threshold | US-GRC-03 | skip |
| 15 | milestone-2 | Agent with completed session not invoked | US-GRC-03 | skip |
| 16 | milestone-2 | New agent type matched by semantic similarity alone | US-GRC-03 | skip |
| 17 | milestone-2 | Loop dampener activates after 3 rapid observations | US-GRC-03 | skip |
| 18 | milestone-2 | Dampening resets after window expires | US-GRC-03 | skip |
| 19 | milestone-3 | Superseded decision as urgent context | US-GRC-04 | skip |
| 20 | milestone-3 | Blocked task as urgent context | US-GRC-04 | skip |

(Scenarios 21-26 in milestone-3 are also skip: conflict observation, consolidated updates, session timestamp, no cancellation.)

## Scenario-to-Story Mapping

### US-GRC-01: Live Governance Feed via SSE (Phase 3: Foundation)

| Scenario | AC Covered | Type |
|----------|-----------|------|
| Admin sees new observation in feed without refreshing | AC-1 (SSE endpoint), AC-2 (GovernanceFeedItem), AC-3 (within 2s) | Walking Skeleton |
| Admin sees confirmed decision move between tiers | AC-3 (correct tier) | Walking Skeleton |
| Feed establishes SSE connection for workspace | AC-1 (SSE endpoint established) | Happy Path |
| New observation appears within 2 seconds | AC-3 (95th percentile < 2s) | Happy Path + Boundary |
| SSE feed items match GET endpoint contract | AC-2 (same GovernanceFeedItem contract) | Happy Path |
| Decision confirmation moves item between tiers | AC-3 (correct tier transition) | Happy Path |
| Blocked task surfaces in review tier | AC-3 (correct tier assignment) | Happy Path |
| SSE keep-alive maintains connection | AC-7 (15s keep-alive) | Edge Case |
| Missed events delivered after reconnection | AC-5 (delta sync from last event ID) | Error Recovery |
| No duplicate feed items after reconnection | AC-9 (no duplicates) | Edge Case |
| Rapid graph changes batched into fewer events | AC-8 (500ms batching) | Boundary |

### US-GRC-03: Agent Coordinator with Vector Search Routing (Phase 4: Coordinator)

| Scenario | AC Covered | Type |
|----------|-----------|------|
| Observation routed to semantically matched agent | AC-1 (LIVE SELECT), AC-2 (vector search routing) | Happy Path |
| Observation routed to multiple matching agents | AC-2 (vector search routing) | Happy Path |
| Irrelevant agent not matched below threshold | AC-4 (similarity threshold) | Error Path |
| Agent with completed session not invoked | AC-3 (active session scope), AC-5 (no invocation) | Error Path |
| New agent type matched by semantic similarity | AC-6 (no classifier rule changes) | Edge Case |
| Loop dampener activates after 3 rapid observations | AC-7 (>3 events in 60s), AC-8 (logged not invoked), AC-9 (meta-observation) | Error Path |
| Dampening resets after window expires | AC-7 (60s window) | Boundary |

### US-GRC-04: Proxy Context Enrichment via Vector Search (Phase 5: Delivery)

| Scenario | AC Covered | Type |
|----------|-----------|------|
| Superseded decision as urgent context | AC-1 (vector search), AC-2 (urgent-context) | Happy Path |
| Blocked task as urgent context | AC-2 (urgent-context), AC-6 (injected context format) | Happy Path |
| Conflict observation on active task as urgent context | AC-2 (urgent-context), AC-6 (entity ref, change type) | Happy Path |
| Multiple urgent updates consolidated | AC-6 (consolidated block) | Edge Case |
| Session timestamp updated after proxy request | AC-7 (last_request_at) | Happy Path |
| No cancellation of current agent work | AC-4 (NEVER cancelled) | Error Path |

## Mandate Compliance Evidence

### CM-A: Hexagonal Boundary Enforcement

All tests invoke through driving ports only:
- **SSE stream**: `GET /api/workspaces/:workspaceId/feed/stream` (HTTP driving port)
- **Feed state**: `GET /api/workspaces/:workspaceId/feed` (HTTP driving port)
- **MCP context**: `POST /api/mcp/:workspaceId/context` (DPoP-authenticated HTTP driving port)
- **SurrealDB queries**: Direct graph writes to trigger LIVE SELECT (database driving port)

No internal component imports. Tests never import from `app/src/server/reactive/`.

### CM-B: Business Language Purity

Test descriptions use domain language exclusively:
- "admin sees observation in feed" (not "SSE event received by EventSource")
- "decision moves between tiers" (not "feed_update event with removals array")
- "agent matched by semantic similarity" (not "KNN returns cosine > 0.8")
- "loop dampener activates" (not "sliding window counter exceeds threshold")

### CM-C: Walking Skeleton + Focused Scenario Counts

- Walking Skeletons: 2 (both prove user-observable E2E value)
- Focused Scenarios: 18 (boundary tests at driving ports)
- Error/Edge ratio: 50% (exceeds 40% target)
