# US-GRC-01: Live Governance Feed via SSE

## Problem
Marcus Oliveira is a workspace admin who monitors agent activity via the governance feed. He finds it frustrating to manually refresh the feed page 8-10 times per session to see current state. When an agent confirms a decision or the Observer creates a conflict observation, Marcus does not see it until the next page refresh -- which can be minutes later. During that gap, other agents may continue working with stale assumptions.

## Who
- Workspace admin | Monitors governance feed in browser | Wants to see graph changes in real-time without manual refresh

## Solution
Replace the current poll-on-load governance feed with a persistent SSE stream that pushes graph changes to the browser as they happen. The initial feed state is loaded via the existing GET endpoint. Subsequent changes are delivered via SSE events that the client merges into the feed state.

## Job Story Trace
- JS-GRC-01: Real-Time Governance Awareness
- Outcome #1: Minimize the time between a graph change and the workspace admin seeing it in the feed (Score: 16.5)
- Outcome #5: Minimize the number of manual page refreshes needed to see current feed state (Score: 16.0)

## Domain Examples

### 1: Decision Confirmation Appears Live
Marcus Oliveira has the governance feed open for workspace "montreal." The blocking tier shows 2 items including provisional decision "Standardize on tRPC for all APIs." At 3:43 PM, the chat agent confirms the decision via conversation C-12. Within 2 seconds, the decision disappears from the blocking tier and a new awareness item appears: "Decision confirmed: Standardize on tRPC for all APIs." The blocking count badge updates from 2 to 1. Marcus did not refresh the page.

### 2: Observer Warning Surfaces Without Refresh
Marcus is reviewing the feed at 10:15 AM. The Observer agent runs a graph scan and creates a warning observation: "Schema migration missing for new field on task table." Within 2 seconds, a new review item slides into the feed with severity "warning" and source "observer_agent." The review count increases from 3 to 4. Marcus sees the [NEW] badge and clicks to investigate.

### 3: Connection Drops and Recovers
Marcus's MacBook goes to sleep at 3:55 PM. The SSE connection drops. The feed header changes from "Connected [*] live" to "Reconnecting..." with an amber indicator. At 3:59 PM Marcus wakes the laptop. The SSE reconnects. The feed header shows "Reconnected. 3 updates received since 3:55 PM." Two new review items and one awareness item appear with [NEW] badges. Marcus can see exactly what changed while he was away.

### 4: High-Volume Event Burst
At 2:00 PM, Marcus imports a large batch of tasks via the API. This creates 50 new task records in 10 seconds. The feed does not receive 50 separate SSE events. Instead, the SSE bridge batches events within a 500ms window and delivers a single "feed_update" event with the count of new awareness items. The feed shows "+12 new awareness items" (only the first 12 that cross the feed item limit) without overwhelming the client.

## UAT Scenarios (BDD)

### Scenario: Feed establishes SSE connection on page load
Given Marcus Oliveira navigates to the governance feed for workspace "montreal"
When the feed page finishes loading
Then an SSE connection is established to /api/workspaces/montreal/feed/stream
And the connection indicator shows "Connected" with a live indicator
And the initial feed state is loaded via GET /api/workspaces/montreal/feed

### Scenario: Graph change appears in feed within 2 seconds
Given Marcus has the governance feed open for workspace "montreal"
And the feed shows 2 blocking items
When the extraction pipeline creates a new provisional decision "Use event sourcing for audit trail" with confidence 0.92
Then within 2 seconds a new blocking item appears in the feed
And the blocking count updates to 3
And the new item has a [NEW] visual indicator

### Scenario: Item moves between tiers on status change
Given Marcus has the governance feed open
And the blocking tier contains provisional decision "Standardize on tRPC for all APIs"
When chat_agent confirms the decision
Then within 2 seconds the decision is removed from the blocking tier
And a new awareness item appears with text "Decision confirmed: Standardize on tRPC for all APIs"
And tier counts update accordingly

### Scenario: SSE reconnects after network loss with delta sync
Given Marcus has the governance feed open and last received event ID "evt-42"
When the SSE connection drops for 30 seconds
And during disconnection 1 observation and 1 task completion occur
Then the connection indicator changes to "Reconnecting..."
And when the connection recovers, the feed shows "Reconnected. 2 updates received"
And the missed items appear in the correct tiers with [NEW] badges

### Scenario: Extended disconnection triggers full refresh
Given Marcus has the governance feed open
When the SSE connection drops for 10 minutes
Then on reconnection the server triggers a full feed refresh (not delta)
And the feed state is completely rebuilt from the current graph state
And the banner shows "Reconnected. Feed refreshed."

### Scenario: SSE keep-alive maintains connection
Given Marcus has the governance feed open with no graph changes for 5 minutes
Then the SSE connection sends a keep-alive comment every 15 seconds
And the connection indicator remains "Connected"
And the connection does not time out

## Acceptance Criteria
- [ ] SSE endpoint GET /api/workspaces/:id/feed/stream established on feed page load
- [ ] Feed items delivered via SSE use the same GovernanceFeedItem contract as the GET endpoint
- [ ] New items appear in the correct tier within 2 seconds of the graph write (95th percentile)
- [ ] Connection status indicator accurately reflects EventSource readyState (Connected/Reconnecting/Disconnected)
- [ ] On reconnection, missed events are replayed from the last event ID (delta sync)
- [ ] After 10+ minutes disconnection, a full feed refresh is performed instead of delta
- [ ] SSE keep-alive sent every 15 seconds to prevent connection timeout
- [ ] High-volume event bursts are batched within a 500ms window to prevent client overload
- [ ] No duplicate feed items after reconnection

## Technical Notes
- Depends on: SurrealDB LIVE SELECT capability (requires WebSocket connection from server to SurrealDB -- current transport is HTTP per AGENTS.md; this is a known constraint that needs resolution)
- Depends on: existing SSE registry infrastructure (streaming/sse-registry.ts) -- needs extension from per-message to per-workspace scope
- Depends on: existing GovernanceFeedItem contract (shared/contracts.ts)
- Current feed route (feed/feed-route.ts) runs 14 parallel queries on each request; SSE bridge must avoid re-running all 14 queries on every graph change
- SurrealDB LIVE SELECT requires ws:// or wss:// transport. Current SURREAL_URL uses HTTP. Transport change needed.
- Constraint: LIVE SELECT cannot be used on high-volume tables (trace, message) without flooding the SSE bridge. Exclude these tables; use existing DEFINE EVENT webhooks for those.
- Phase: 3 (Foundation)

## Dependencies
- Transport protocol change: SURREAL_URL from http:// to ws:// (or dual connection: HTTP for queries, WS for LIVE SELECT)
- SSE registry refactor: extend from per-message to per-workspace scope
- GovernanceFeedItem type must be shared between feed-route.ts GET handler and SSE bridge
