# ADR-075: SurrealDB Session Store Over In-Memory Handle Registry

## Status

Proposed

## Context

The orchestrator currently stores active agent session handles in a module-level mutable `Map<string, AgentHandle>` (`handleRegistry` in `session-lifecycle.ts`). This approach has three problems:

1. **Violates project convention**: AGENTS.md explicitly prohibits module-level mutable singletons ("Module-level state is shared across the entire process -- when multiple server instances run concurrently, they silently corrupt each other").

2. **Session loss on restart**: All active sessions are lost when Osabio's server restarts. The in-memory Map is the only record of running agent processes. This directly blocks the session restoration requirement (> 95% restoration success rate).

3. **Incompatible with SandboxAgent model**: SandboxAgent SDK communicates with SandboxAgent Server via HTTP API. Session operations (prompt, abort) are HTTP calls to the server, not method calls on an in-process handle. There is no in-process handle to store.

Quality attributes: **reliability** (session survival across restarts), **maintainability** (eliminate mutable singleton), **testability** (SurrealDB state is inspectable in tests).

## Decision

Eliminate the in-memory `handleRegistry`. Store all session state on the existing `agent_session` table with two new fields (`provider`, `session_type`). Session operations (prompt, resume, destroy) delegate to the SandboxAgent adapter, which communicates with SandboxAgent Server via HTTP. No in-process session handle is held. See ADR-076 for the schema decision.

On server startup, Osabio scans for active `agent_session` records with `session_type = "sandbox_agent"` and calls `adapter.resumeSession()` for each, re-establishing the event stream connections.

## Alternatives Considered

### 1. Keep In-Memory Registry + Periodic Checkpoint to SurrealDB

Maintain the `handleRegistry` for fast access, periodically sync state to SurrealDB for recovery.

- **Pro**: Low latency for session lookups
- **Con**: Dual-state (memory + DB) creates consistency bugs. Still loses events between checkpoints. Still violates mutable singleton convention.
- **Rejected**: SurrealDB lookup latency (< 5ms local) is negligible compared to HTTP round-trip to SandboxAgent Server (50-200ms).

### 2. Redis/External Cache for Session State

Use Redis or similar for session state with SurrealDB as backing store.

- **Pro**: Sub-millisecond lookups, built-in TTL
- **Con**: New infrastructure dependency. SurrealDB already provides adequate performance. Osabio's architecture principle is to keep the graph as the single source of truth.
- **Rejected**: Unnecessary complexity. No evidence that SurrealDB session queries are a bottleneck.

### 3. In-Memory Map with Dependency Injection (Fix Convention Violation Only)

Inject the Map via the dependency chain instead of module-level declaration. Still in-memory, but no longer a singleton.

- **Pro**: Fixes the singleton convention violation
- **Con**: Sessions still lost on restart. Doesn't address the core reliability requirement.
- **Rejected**: Addresses convention but not the business requirement.

## Consequences

### Positive

- Sessions survive server restarts (restoration via SurrealDB scan + adapter.resumeSession)
- No module-level mutable state in orchestrator
- Session state is inspectable in SurrealDB for debugging and auditing
- Single source of truth (no dual-state consistency issues)
- Aligns with existing project patterns (SurrealDB for all persistent state)

### Negative

- Every session operation requires a SurrealDB query (small latency addition)
- Server startup has a restoration phase that may take up to 10 seconds for many active sessions
- SurrealDB outage blocks session operations (mitigated by existing SurrealDB reliability practices)
