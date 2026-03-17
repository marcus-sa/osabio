# ADR-058: DEFINE EVENT Webhooks Over LIVE SELECT for Coordinator

## Status
Confirmed

## Context
The Agent Coordinator needs to react to new observations in the graph and route them to semantically matched agents via vector search. Two mechanisms are available in SurrealDB for reacting to data changes:

1. **LIVE SELECT** — application subscribes to table changes via WebSocket, events delivered as callbacks
2. **DEFINE EVENT** — database-side triggers that fire HTTP webhooks on record changes

The codebase already uses 8 DEFINE EVENT webhooks (session_ended, task_completed, decision_confirmed, observation_peer_review, etc.) all following the same pattern: `DEFINE EVENT OVERWRITE ... THEN { http::post(...) } ASYNC RETRY 3`.

## Decision
Use DEFINE EVENT webhooks for the coordinator's observation routing, not LIVE SELECT subscriptions.

The coordinator becomes a POST endpoint (`/api/internal/coordinator/observation`) called by a SurrealDB DEFINE EVENT trigger, rather than an always-on LIVE SELECT listener.

## Rationale

| Factor | LIVE SELECT | DEFINE EVENT |
|--------|-------------|--------------|
| WHERE filtering | Broken in v3.0 (no bound params) — requires app-side filtering | Works correctly — filter in the trigger condition |
| Subscription management | Application must create/track/reconnect subscriptions | None — trigger lives in schema |
| App restart resilience | Subscriptions lost, must re-subscribe | Trigger survives restarts (schema-defined) |
| Existing pattern | Not used elsewhere in codebase | 8 existing webhooks follow this exact pattern |
| Latency | Slightly lower (no HTTP roundtrip) | HTTP roundtrip, but ASYNC means non-blocking |
| Complexity | Requires Live Select Manager + subscription lifecycle | Single migration + endpoint handler |

## Consequences
- The Live Select Manager is no longer needed for coordinator observation routing
- The Live Select Manager remains for the feed SSE bridge (listens to many tables for UI updates)
- New migration adds `DEFINE EVENT coordinator_observation_routed ON observation`
- New internal endpoint `POST /api/internal/coordinator/observation` handles the webhook
- The observation event excludes `source_agent="agent_coordinator"` to prevent self-triggering loops (same pattern as `observation_peer_review` excluding `observer_agent`)

## Alternatives Rejected
- **LIVE SELECT**: Requires working around v3.0 WHERE limitation, adds subscription management complexity, no existing pattern in codebase
- **Polling**: Obvious latency and waste problems
