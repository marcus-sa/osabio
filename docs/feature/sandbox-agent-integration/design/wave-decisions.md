# DESIGN Wave Decisions: Sandbox Agent Integration

## Architecture Decisions

### AD-01: Adapter Abstracts at SDK Level (Answers Q-04)

**Decision**: The adapter interface wraps the SandboxAgent SDK instance (SDK level), not individual session handles (session level).

**Rationale**: Session handles are SDK-specific objects with SDK-specific event emitter patterns. Wrapping at the SDK level means one adapter factory creates sessions that return Brain-owned `SessionHandle` types. The adapter boundary is a single point -- the factory function. Session-level abstraction would spread the SDK dependency across every session interaction.

**Status**: Provisional

---

### AD-02: SurrealDB Replaces In-Memory Handle Registry

**Decision**: Eliminate the module-level mutable `handleRegistry` Map. All session state is stored in SurrealDB (`agent_session` table with sandbox fields). Session operations (prompt, abort, etc.) look up the session record in SurrealDB and delegate to the SandboxAgent adapter via HTTP.

**Rationale**: The `handleRegistry` violates the project convention against module-level mutable singletons (AGENTS.md). It also means all session state is lost on server restart, which directly conflicts with the restoration requirement (US-05). SurrealDB persistence is the source of truth; the adapter communicates with SandboxAgent Server via HTTP API, so no in-process handle is needed.

**Status**: Provisional

---

### AD-03: Sandbox Fields on agent_session (Not a Separate Table)

**Decision**: Add sandbox-specific fields (`provider`, `session_type`, `replay_max_events`, `replay_max_chars`, `last_event_seq`) directly to `agent_session` rather than creating a separate `sandbox_session` table.

**Rationale**: Most SandboxAgent concepts already map to existing `agent_session` fields (`external_session_id`, `agent`, `orchestrator_status`, `worktree_path`, `ended_at`, `last_event_at`). Only 5 new optional fields are needed. A separate table would require joins on every session operation and transaction coordination on creation — unnecessary complexity for 5 fields. See ADR-076.

**Status**: Provisional

---

### AD-04: 100ms Write Buffer for Event Persistence

**Decision**: Buffer events in memory for 100ms before batch-inserting to SurrealDB. Per-session buffer with overflow protection.

**Rationale**: SandboxAgent can emit 50+ events/second during test runs. Individual inserts at this rate would create excessive SurrealDB load. 100ms batching groups ~5 events per write at peak, reducing round-trips 5x while keeping latency well under the 500ms SLA.

**Alternatives considered**:
1. **Synchronous per-event writes** -- Simpler but creates backpressure at high event rates
2. **1-second batch window** -- Lower DB load but risks 1s of event loss on crash
3. **Background queue with separate writer** -- More complex architecture for marginal benefit

**Status**: Deferred — applies only when SurrealDB persistence driver is implemented for cloud providers. See ADR-077 and [#187](https://github.com/marcus-sa/brain/issues/187).

---

### AD-05: Event Bridge Replacement with Forward-Compatible Unknown Event Handling

**Decision**: Build a new event bridge (`sandbox-event-bridge.ts`) for SandboxAgent events. Unknown event types are logged at warn level and skipped (not crash). The persistence driver stores all events regardless of type (including unknown).

**Rationale**: SandboxAgent SDK is 0.x and may add new event types in any release. The bridge must not break on unknown events. Storing raw events in `sandbox_event.payload` (FLEXIBLE object) ensures replay fidelity even for event types the bridge does not yet translate. This is the opposite of the fail-fast convention -- for event translation specifically, graceful degradation is the correct choice because a missing UI event is far less costly than a crashed session.

**Status**: Provisional

---

### AD-06: Permission Handler as Separate Component

**Decision**: Extract permission handling into a dedicated `permission-handler.ts` module, separate from the event bridge.

**Rationale**: Permission requests are bidirectional (SandboxAgent -> Brain -> User -> Brain -> SandboxAgent), unlike other events which are unidirectional. The handler manages SSE delivery, timeout logic (60s auto-reject), auto-approve scope checking, and response routing. Mixing this with the event bridge would violate single responsibility.

**Status**: Provisional

---

### AD-07: Session Restoration via Active Session Scan on Startup

**Decision**: On server startup, Brain queries SurrealDB for `agent_session` records with `session_type = "sandbox_agent" AND orchestrator_status IN ["running", "idle"]` and calls `adapter.resumeSession()` for each. Restoration is fire-and-forget per session with individual error handling.

**Rationale**: The SDK handles the heavy lifting (event replay, session rebinding). Brain only needs to enumerate active sessions and trigger restoration. Individual session failures do not block other restorations. Failed sessions are marked `status = "error"` with a restoration failure message.

**Status**: Provisional

---

## Technology Stack Summary

| Component | Technology | License |
|-----------|-----------|---------|
| Agent execution | SandboxAgent SDK (0.x, pin version) | Apache 2.0 |
| Session persistence | SurrealDB (existing) | BSL 1.1 (existing dependency) |
| Event streaming | SSE Registry (existing) | N/A (internal) |
| LLM proxy | Brain proxy module (existing) | N/A (internal) |
| Tool governance | Brain dynamic MCP endpoint (existing + new route) | N/A (internal) |

## Constraints Established

| Constraint | Enforcement |
|-----------|-------------|
| Orchestrator modules must not import SandboxAgent SDK directly | dependency-cruiser rule |
| No module-level `let` in orchestrator/ | ESLint custom rule |
| All session state must be in SurrealDB, not in-memory | Code review + test coverage |
| Event bridge must not crash on unknown event types | Unit test with fuzzy event input |
| Permission timeout is 60 seconds (configurable) | Config constant with test coverage |

## Upstream Changes to DISCUSS Assumptions

| DISCUSS Decision | Change | Reason |
|-----------------|--------|--------|
| D-04 (SurrealDB Persistence Driver) | Confirmed, detailed with 100ms write buffer and per-session buffering | NFR: 50 events/second throughput |
| D-07 (Adapter Interface) | Confirmed, scoped to SDK level (not session level) per Q-04 answer | Testability + single boundary point |
| D-08 (Event Bridge Replacement) | Confirmed, with explicit forward-compatibility for unknown event types | SDK 0.x stability concern |
| None | New: 5 sandbox fields added to `agent_session` (no separate table) | Reuse existing fields, avoid join overhead |
| None | New: server startup restoration scan | Addresses US-05 server restart scenario |
