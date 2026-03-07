# ADR-005: Conversation Log Persistence Strategy

## Status
Accepted

## Context
The coding-session feature requires a chronological conversation log (agent output + user prompts + file changes) for two purposes: (1) live display during an active session, (2) review display after the agent finishes. The log must survive page navigation and browser refresh.

Team: solo developer. Timeline: 7-10 days. Database: SurrealDB already running.

## Decision
Persist conversation log entries server-side as an inline array field (`conversation_log`) on the existing `agent_session` SurrealDB table. Batch `agent_token` events in memory and flush as single `agent_text` entries at turn boundaries to keep the array at ~10-50 entries per session.

Live sessions use SSE events for real-time display. The persisted log is read via GET endpoint for the review page (Agent Log tab).

## Alternatives Considered

### Alternative 1: Client-side session storage
- What: Store log entries in browser sessionStorage/localStorage, no server persistence
- Expected Impact: Solves ~60% (live display works, review works only in same tab)
- Why Insufficient: Log lost on navigation, refresh, or tab close. Review page may open in different context (e.g., from governance feed link). Multi-device access impossible. Violates J3 requirement (review with full context).

### Alternative 2: Separate `conversation_log_entry` table with relations
- What: Dedicated SCHEMAFULL table with `RELATE agent_session->logged->conversation_log_entry`
- Expected Impact: Solves 100% with better queryability
- Why Insufficient: Over-engineered. Entries are always accessed as a full set per session, never queried individually. Adds schema complexity (new table, relation, indexes) for data that has a 1:1 relationship with sessions. Solo dev, no team boundary justifying separation.

### Alternative 3: Append individual token events to log
- What: Each `agent_token` SSE event creates a separate log entry
- Expected Impact: Solves 100% with maximum fidelity
- Why Insufficient: A single agent turn can produce 1000+ token events. At 50 turns, the array hits 50,000+ entries. SurrealDB SCHEMAFULL array updates become expensive. Review page must load and render all entries. Batching at turn boundaries provides equivalent user value at 1/100th the storage.

## Consequences
- Positive: Zero new infrastructure; reuses existing table; log survives all client scenarios; simple single-query retrieval
- Positive: Token batching keeps array small and review page fast
- Negative: In-memory token accumulation lost on server restart (partial log for that turn only)
- Negative: Inline array not independently queryable (acceptable -- no use case for cross-session log queries)
