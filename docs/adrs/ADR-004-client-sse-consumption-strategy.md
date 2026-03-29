# ADR-004: Client SSE Consumption Strategy for Agent Events

## Status

Accepted

## Context

The coding agent orchestrator emits real-time events (status changes, file edits, stall warnings) via SSE through the Osabio SSE Registry. The client needs to consume these events across three UI surfaces: task popup (EntityDetailPanel), governance feed, and agent review view. We need to decide how the client subscribes to and routes these events.

Key constraints:
- The existing chat system uses Vercel AI SDK's `useChat` which manages its own SSE transport internally -- there is no reusable SSE hook in the codebase.
- Agent SSE streams are per-session, not per-workspace (endpoint: `GET /api/orchestrator/:ws/sessions/:id/stream`).
- The governance feed already polls at 30s intervals and builds items server-side.
- Multiple surfaces may display data for the same agent session simultaneously (e.g. task popup open while feed visible).

## Decision

Use a per-session `EventSource` managed by a `useAgentSession` React hook. The hook opens a native `EventSource` connection when given a session ID and closes it on unmount or terminal status. The governance feed continues to use polling (no SSE).

**SSE hook owns the connection.** Each component that needs real-time agent data calls `useAgentSession(sessionId)`. If two components subscribe to the same session, each gets its own `EventSource`. This is acceptable because at most one task popup and one review view are open simultaneously (never two for the same session).

**Feed uses polling, not SSE.** Agent-related feed items are built server-side from `agent_session` database records. The 30s poll interval is sufficient for governance alerting (stalls, errors, review-ready). This avoids a second SSE subscription model on the feed and keeps feed items consistent with their database state.

## Alternatives Considered

### Alternative 1: Shared SSE connection per workspace
A single `EventSource` subscribes to all agent events for the workspace, with client-side routing by session ID.

- Expected impact: Solves multi-session monitoring. Fewer connections.
- Why insufficient: The orchestrator SSE stream is per-session (matching OpenCode's per-session event model). A workspace-level stream would require a new aggregation endpoint on the server. Over-engineering for the current constraint of 2-3 concurrent agents. Can be added later if multi-agent monitoring becomes a priority.

### Alternative 2: Zustand store with SSE side-effect
A global Zustand store manages all agent session state, with SSE connections as store side-effects.

- Expected impact: Shared state across components, single connection per session.
- Why insufficient: Introduces a new state management pattern not used elsewhere in the codebase (existing stores are view-state and workspace-state, neither manages SSE connections). The hook-based approach follows React conventions and is simpler for the 1-session-at-a-time interaction pattern.

### Alternative 3: Feed subscribes to SSE for real-time agent updates
Feed opens SSE connections for all active agent sessions to get instant updates.

- Expected impact: Faster feed updates (sub-second vs 30s).
- Why insufficient: Feed is governance-scoped -- it shows persistent items requiring human decision. Sub-second updates add complexity (connection management for N sessions) without meaningful UX benefit. Agent reaching "idle" creates a database record; 30s worst-case latency is acceptable for "review ready" notifications.

## Consequences

- **Positive**: Simple hook-based pattern consistent with React conventions. No new state management infrastructure. Feed remains database-driven and consistent. SSE connections only opened when user is actively viewing an agent session.
- **Negative**: If two components need the same session's SSE simultaneously, two connections open. Acceptable given the interaction model (popup closes when review view opens). Page reload requires a status poll before SSE reconnect (bootstrap path).
