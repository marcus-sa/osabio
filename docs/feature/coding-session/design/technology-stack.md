# Coding Session -- Technology Stack

All technology choices are existing in the project. No new dependencies required.

## Runtime

| Component | Technology | Version | License | Rationale |
|-----------|-----------|---------|---------|-----------|
| Server runtime | Bun | existing | MIT | Already in use |
| Database | SurrealDB | v3.0 | BSL 1.1 | Already in use; graph model fits conversation log |
| Coding agent | OpenCode | existing | MIT | Already integrated via `@opencode-ai/sdk` |

## Server

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| HTTP server | Bun.serve | Existing; custom route matching |
| SSE streaming | Custom `sse-registry.ts` | Existing; proven pattern from chat system |
| Event transform | Custom `event-bridge.ts` | Existing; pure transform functions |
| Process management | Node `child_process.spawn` | Existing; manages OpenCode server lifecycle |
| Session state | SurrealDB `agent_session` table | Existing; schema already has orchestrator fields |

## Client

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| UI framework | React (vanilla, no meta-framework) | Existing |
| SSE consumption | Browser `EventSource` API | Existing; used by `useAgentSession` hook |
| State management | React hooks (`useState`, `useCallback`, `useRef`) | Existing pattern; no external state library |
| HTTP client | Browser `fetch` API | Existing; wrapped in `orchestrator-api.ts` |

## New Dependencies

**None.** This feature is entirely wiring existing components together plus adding UI components using existing patterns. No new npm packages, no new infrastructure.

## Alternatives Considered

| Decision | Chosen | Rejected | Why Rejected |
|----------|--------|----------|-------------|
| SSE library | Browser EventSource (existing) | Socket.io, ws | EventSource already working; no WebSocket features needed |
| State management | React hooks | Zustand, Redux | Solo dev, component-local state sufficient; workspace store already uses Zustand minimally |
| Log persistence | SurrealDB fields | Redis, SQLite sidecar | SurrealDB already running; no justification for additional data store |
| Diff rendering | Raw text (existing) | monaco-diff, diff2html | Review page already renders diffs; enhancement is adding log tab alongside |
