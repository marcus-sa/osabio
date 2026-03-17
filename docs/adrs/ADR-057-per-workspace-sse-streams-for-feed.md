# ADR-057: Per-Workspace SSE Streams for Feed (Extending Existing SSE Registry)

## Status
Accepted

## Context
The existing SSE Registry (`streaming/sse-registry.ts`) manages per-message streams: one stream per chat message, closed after the response completes. The governance feed requires a different pattern: one long-lived stream per workspace, shared across all admin clients viewing that workspace's feed.

Two approaches: create a separate SSE system for the feed, or extend the existing registry.

## Decision
Extend the existing SSE Registry with per-workspace stream management. Add `registerWorkspaceStream`, `emitWorkspaceEvent`, and `handleWorkspaceStreamRequest` methods alongside the existing per-message methods.

## Alternatives Considered

### Alternative 1: Separate Feed SSE Module
- **What**: Create `feed/feed-sse.ts` with its own stream management, independent of the SSE Registry
- **Expected Impact**: Clean separation, no risk of breaking existing per-message streams
- **Why Insufficient**: Duplicates SSE plumbing (ReadableStream creation, keep-alive, encoding, cleanup). Two SSE systems to maintain. The per-workspace pattern is a natural extension of the existing registry, not a conflicting pattern.

### Alternative 2: WebSocket for Feed
- **What**: Use WebSocket instead of SSE for bidirectional feed communication
- **Expected Impact**: Enables future client-to-server feed actions
- **Why Insufficient**: Feed is unidirectional (server pushes updates). SSE is simpler, has built-in reconnection (EventSource), and the existing codebase already uses SSE. Adding WebSocket infrastructure for a unidirectional use case adds unnecessary complexity.

## Consequences
- **Positive**: Reuses existing SSE encoding, keep-alive, and cleanup logic. Single module for all SSE concerns. Consistent patterns across codebase.
- **Positive**: Per-workspace streams support multiple clients (fan-out). When admin opens feed in two tabs, both receive the same events.
- **Negative**: SSE Registry grows in responsibility. Mitigated: per-message and per-workspace methods are clearly separated and independently testable. The registry remains a thin coordination layer.
- **Negative**: Per-workspace streams are long-lived, unlike per-message streams. Requires cleanup on last client disconnect (with grace period to avoid thrashing on page refreshes). This lifecycle difference must be tested.
