# Evolution: Graph-Reactive Agent Coordination

**Date**: 2026-03-17
**Branch**: `marcus-sa/reactive-agent-activator`
**Duration**: ~5 hours (12:57 -- 17:36 UTC)

## Feature Summary

Replaced Brain's poll-based reactivity with push-based coordination powered by SurrealDB LIVE SELECT and DEFINE EVENT webhooks. Three capabilities were delivered:

1. **Live Governance Feed via SSE** -- Workspace admins see governance events (decisions, tasks, observations, questions, suggestions, learnings, agent sessions) in real time without page refresh. LIVE SELECT subscriptions on 7 governance tables push events through a Feed SSE Bridge that transforms them to `GovernanceFeedItem`, assigns display tiers via simple rules, batches within 500ms windows, and delivers via per-workspace SSE streams. Supports reconnection with delta sync (< 10 min gap) and full refresh (>= 10 min gap).

2. **Agent Activator with LLM Classification** -- When an observation is created in the graph, a SurrealDB DEFINE EVENT webhook fires to a POST endpoint. The activator checks loop dampening, verifies the target entity has no active agent coverage (proxy handles running sessions), loads registered agent descriptions, and uses a fast LLM (Haiku) to classify which agents should act. Matched agents get new sessions started with `triggered_by` pointing to the observation. Provisional decisions are recorded for conflict/warning routing choices.

3. **Proxy Context Enrichment via Vector Search** -- On each LLM proxy request, the context injector embeds the current message and runs KNN against recent graph entity embeddings (scoped to workspace, filtered to entities updated since `agent_session.last_request_at`). High-similarity matches (> 0.85) are injected as `<urgent-context>` XML blocks before `<brain-context>`. Moderate matches (0.65--0.85) are injected as `<context-update>` blocks after. The MCP context endpoint also returns `urgent_updates` and `context_updates` arrays using the same vector search logic.

## Architecture Decisions

| ADR | Title | Status |
|-----|-------|--------|
| ADR-054 | Vector Search Agent Routing Over Deterministic Rules | **Superseded** by ADR-061 |
| ADR-055 | Graph-Native Context Injection Over context_queue Table | Accepted |
| ADR-056 | Single SurrealDB Connection for LIVE SELECT | Accepted |
| ADR-057 | Per-Workspace SSE Streams for Feed (Extending Existing SSE Registry) | Accepted |
| ADR-058 | DEFINE EVENT Webhooks Over LIVE SELECT for Activator | Confirmed |
| ADR-059 | Activator Skips Active Coverage, Proxy Handles Running Sessions | Confirmed |
| ADR-060 | "Agent Activator" Over "Agent Coordinator" Naming | Confirmed |
| ADR-061 | LLM Classification Over KNN for Agent Activation | Accepted |

## Key Design Pivots

### 1. KNN Vector Search to LLM Classification (ADR-054 -> ADR-061)

The original design used KNN cosine similarity between observation embeddings and agent description embeddings to route observations. During implementation, this was found to be insufficient: the question "which agents can **act** on this?" is a judgment problem, not a proximity problem. Short agent descriptions produce noisy embeddings, and KNN cannot reason about capability vs. textual similarity. The activator was pivoted to use a fast LLM (Haiku) for classification. The `description_embedding` field and HNSW index on `agent` remain in schema for potential future use.

### 2. context_queue Table to Graph-Native Search (ADR-055)

An early design proposed a `context_queue` table where the coordinator writes per-session context updates and the proxy marks them "delivered." This was rejected because it introduces point-to-point messaging semantics into a graph-native system. Instead, the proxy uses vector search against the graph itself -- the graph IS the delivery mechanism. Multiple agents on related tasks naturally see the same relevant changes.

### 3. Agent Coordinator to Agent Activator (ADR-060)

The component was originally named "Agent Coordinator," implying it routes between existing agents. The name was changed to "Agent Activator" because the component only starts NEW agent sessions -- the proxy handles enriching running sessions. The SurrealDB DEFINE EVENT trigger name (`coordinator_observation_routed`) was kept in migrations to avoid a breaking schema change.

### 4. LIVE SELECT to DEFINE EVENT Webhooks for Activator (ADR-058)

The original design had the activator using LIVE SELECT subscriptions to react to new observations. This was pivoted to DEFINE EVENT webhooks because: SurrealDB v3.0 LIVE SELECT WHERE clauses do not support bound parameters (requiring app-side filtering), the codebase already has 8 DEFINE EVENT webhooks following the same pattern, and DEFINE EVENT survives app restarts without re-subscription. LIVE SELECT is still used for the Feed SSE Bridge where multi-table subscriptions are needed for UI updates.

## Components Delivered

### New Modules

| Module | Path |
|--------|------|
| Live Select Manager | `app/src/server/reactive/live-select-manager.ts` |
| Feed SSE Bridge | `app/src/server/reactive/feed-sse-bridge.ts` |
| Agent Activator | `app/src/server/reactive/agent-activator.ts` |
| Loop Dampener | `app/src/server/reactive/loop-dampener.ts` |

### Extended Modules

| Module | Path | Change |
|--------|------|--------|
| SSE Registry | `app/src/server/streaming/sse-registry.ts` | Per-workspace stream management (`registerWorkspaceStream`, `emitWorkspaceEvent`, `handleWorkspaceStreamRequest`) |
| Context Injector | `app/src/server/proxy/context-injector.ts` | `buildRecentChangesXml()` with KNN vector search for relevant recent changes, similarity-based urgency classification |
| Anthropic Proxy Route | `app/src/server/proxy/anthropic-proxy-route.ts` | Wired `loadRelevantGraphChanges()` into context pipeline, updates `last_request_at` |
| Start Server | `app/src/server/runtime/start-server.ts` | Registered activator webhook endpoint and feed stream SSE endpoint |
| MCP Route | `app/src/server/mcp/mcp-route.ts` | Extended context endpoint with `urgent_updates` and `context_updates` arrays |

## Schema Changes

Two migrations, no new tables:

**Migration 0053** (`schema/migrations/0053_reactive_coordination_fields.surql`):
- `DEFINE FIELD OVERWRITE last_request_at ON agent_session TYPE option<datetime>` -- tracks when proxy last enriched the session
- `DEFINE FIELD OVERWRITE description_embedding ON agent TYPE option<array<float>>` -- agent description embedding (kept for future use, not used by activator after ADR-061 pivot)
- `DEFINE INDEX OVERWRITE idx_agent_desc_embedding ON agent FIELDS description_embedding HNSW DIMENSION 1536 DIST COSINE`
- `DEFINE FIELD OVERWRITE description ON agent TYPE option<string>` -- agent description text used by LLM classification

**Migration 0055** (`schema/migrations/0055_agent_session_triggered_by.surql`):
- `DEFINE FIELD OVERWRITE triggered_by ON agent_session TYPE option<record<observation | task | decision | question>>` -- polymorphic reference to the entity that caused the activator to start the session

## Test Coverage

### Unit Tests

| File | Coverage |
|------|----------|
| `tests/unit/loop-dampener.test.ts` | Sliding window counter, threshold, window expiry, dampening signal |
| `tests/unit/feed-sse-bridge.test.ts` | Graph event to GovernanceFeedItem transform, tier assignment, batching |
| `tests/unit/reactive-coordination-schema.test.ts` | Schema field definitions and constraints |
| `tests/unit/reactive/agent-activator.test.ts` | LLM classification, active coverage skip, provisional decision recording |
| `tests/unit/proxy-context-injector.test.ts` | Similarity classification (urgent/context-update/filtered), XML block generation |

### Acceptance Tests

| File | Coverage |
|------|----------|
| `tests/acceptance/reactive/schema-reactive-fields.test.ts` | Migration applies, fields queryable |
| `tests/acceptance/reactive/milestone-1-feed-sse-bridge.test.ts` | SSE connection lifecycle, feed item delivery < 2s, tier transitions, reconnection delta sync, deduplication, batching |
| `tests/acceptance/reactive/milestone-2-agent-activator.test.ts` | Observation activates relevant agent, skips active coverage, multi-agent activation, irrelevant agent not activated, new agent type activated by LLM, loop dampener integration |
| `tests/acceptance/reactive/milestone-3-proxy-context-enrichment.test.ts` | Urgent context injection, context updates, session timestamp update, MCP endpoint enrichment |

Shared test infrastructure: `tests/acceptance/reactive/reactive-test-kit.ts`.

### Execution Log Summary

14 steps executed across 4 milestones. All steps passed. Several RED_UNIT phases were skipped as NOT_APPLICABLE when the step was pure IO wiring with no new domain logic (e.g., SSE endpoint registration, delta sync wiring, existing pure functions reused). The execution log shows continuous PREPARE -> RED -> GREEN -> COMMIT cadence from 12:57 to 17:36 UTC.

## Risks and Known Limitations

1. **LIVE SELECT WHERE limitation (SurrealDB v3.0)**: Workspace filtering for feed events happens application-side, not in the LIVE SELECT query. If SurrealDB fixes bound parameter support in WHERE clauses for LIVE SELECT, the filter can move database-side for efficiency.

2. **In-memory loop dampener state**: The dampener's sliding window counters are not persisted. Server restart resets all dampening state. Acceptable because dampening windows are short-lived (60s), but a rapid restart during an event storm could temporarily allow excess activations.

3. **LLM dependency for activator**: The agent activator depends on a fast LLM (Haiku) being available. If the LLM is unavailable, new observations will not trigger agent activations. The system degrades gracefully -- existing agents continue working, and observations remain in the graph for manual review or retry.

4. **Agent description quality**: LLM classification quality depends on how well agent descriptions communicate capabilities. Poorly written descriptions will produce poor routing. No automated validation of description quality exists.

5. **description_embedding on agent table**: The HNSW index on `agent.description_embedding` remains in schema despite ADR-061 superseding KNN-based routing. This is unused overhead that could be removed if no future feature needs it.

6. **Event buffer bounded at 1000 per workspace**: The SSE reconnection delta sync buffer holds the last 1000 events. At high event volume, disconnections longer than a few minutes may exceed the buffer, forcing a full refresh.

7. **Single SurrealDB connection for LIVE SELECT and queries**: If LIVE SELECT event volume spikes, it shares the WebSocket with request-scoped queries. No contention observed with high-volume tables excluded, but this is a monitoring concern.

## Future Work

- **Client-side SSE integration**: The Feed SSE Bridge delivers events server-side; the React client needs to establish `EventSource` connections and merge SSE events into the feed UI state.
- **Additional activator triggers**: Currently only fires on observation CREATE. Decision supersession, task blocking, and other entity events could also trigger agent activation.
- **Activator retry/dead-letter**: If the LLM classification fails or the activator endpoint is down, DEFINE EVENT ASYNC RETRY 3 handles transient failures. Persistent failures have no dead-letter mechanism.
- **Feed SSE authentication**: The feed stream endpoint uses workspace ID in the URL path (same as GET feed). DPoP or session-based auth should be evaluated for long-lived SSE connections.
- **Dampener tuning**: The 3-event / 60-second threshold is a starting point. Production telemetry should inform whether this needs adjustment.
- **Remove unused description_embedding index**: If no feature claims the HNSW index on `agent.description_embedding` within a reasonable timeframe, remove it to reduce write overhead.
