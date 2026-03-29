# ADR-049: Proxy Session ID Resolution -- Read-Only, No Lifecycle Management

## Status

Superseded by ADR-052

## Context

The LLM proxy intercepts API traffic from external coding agents (Claude Code, custom agents via Vercel AI SDK, etc.). Post-session analysis -- Observer trace scanning for missing decisions and contradictions (ADR-048) -- requires traces to be linked to agent sessions.

Session lifecycle management already exists at the correct layers:
- **CLI (`osabio init` hooks)**: Installs SessionStart/SessionEnd hooks for Claude Code. These call `createAgentSession()` and `endAgentSession()` respectively.
- **Orchestrator**: Manages sessions for Osabio-managed agents via the same `createAgentSession()`/`endAgentSession()` API.

The proxy sees every LLM request and can extract session identifiers from request metadata/headers. The question is whether the proxy should also manage session lifecycle (create, update activity, end via timeout) or simply read session IDs and link traces to existing sessions.

See: `docs/research/llm-session-boundary-detection.md`

### Constraints

- Session lifecycle is already managed by CLI hooks and orchestrator
- The proxy's primary obligation is transparent passthrough
- Observer trace analysis (ADR-048) depends on a session-end trigger, which the existing SurrealDB EVENT on `ended_at` already provides
- Adding duplicate lifecycle management creates race conditions (double-end, activity tracking conflicts)

## Decision

The proxy **reads session IDs only**. It never creates, updates, or ends sessions.

### Session ID Extraction

The proxy extracts a session ID from incoming requests via two sources:

| Source | Extraction | Example |
|--------|-----------|---------|
| Claude Code | `metadata.user_id` field in request body | `session_abc-123-def` |
| Osabio-managed agents | `X-Osabio-Session` header | `agent_session:7f3a...` |
| Unknown client | No extraction possible | Trace linked to workspace only |

This is a pure function with no DB calls or side effects. The extracted session ID is passed to the trace writer, which looks up the corresponding `agent_session` record via `external_session_id` to link the trace.

### What the proxy does NOT do

- Create `agent_session` records
- Update `last_activity_at` or any session fields
- End sessions (no inactivity timeout, no background sweep, no `setInterval`)
- Track session activity
- Run background timers

### Session-end trigger for Observer

The SurrealDB EVENT on `agent_session.ended_at` fires whenever `ended_at` transitions from NONE to a value -- regardless of who sets it (CLI, orchestrator, or any future mechanism). This EVENT triggers the Observer trace analysis pipeline (ADR-048). The proxy is not involved in this flow.

## Alternatives Considered

### Alternative 1: Proxy Manages Sessions with Inactivity Timeout

The proxy upserts `agent_session` records on every request, tracks `last_activity_at`, and runs a `setInterval` background sweep to end sessions after N minutes of inactivity.

**Rejected because**: Duplicates responsibility. The CLI already manages session lifecycle for Claude Code via `osabio init` hooks. The orchestrator manages sessions for Osabio-managed agents. Adding a third session manager in the proxy creates:
- Double-end races (CLI ends session, then sweep also tries to end it)
- Activity tracking conflicts (`last_activity_at` updated by proxy, but session state managed by CLI/orchestrator)
- Unnecessary DB writes on every proxied request (upsert `last_activity_at`)
- A background timer (`setInterval`) that adds operational complexity for no unique value

### Alternative 2: Proxy Upserts Sessions on Each Request

The proxy creates a session if none exists, but does not manage lifecycle (no timeout, no sweep).

**Rejected because**: Still performs unnecessary DB writes on every LLM call. If a session already exists (created by CLI/orchestrator), the upsert is wasted work. If no session exists, the proxy should not be the one creating it -- that is the CLI/orchestrator's responsibility.

## Consequences

### Positive

- Zero DB writes from the proxy for session management (read-only lookup)
- No background timers or sweep logic in the proxy
- No race conditions with CLI/orchestrator session lifecycle
- Simpler proxy code -- session ID resolution is a pure function
- Single source of truth for session lifecycle (CLI/orchestrator)

### Negative

- Agents not managed by CLI or orchestrator will have no session -- their traces are linked to workspace only
- No automatic session creation for unknown clients (requires explicit `osabio init` or orchestrator integration)

### Mitigations

- Unknown-client traces are still captured and linked to workspace, enabling workspace-level analysis
- As Osabio adoption grows, more agents will use `osabio init` or orchestrator integration

## References

- ADR-040: LLM Proxy In-Process Module
- ADR-048: Observer Session-End Trace Analysis
- Research: `docs/research/llm-session-boundary-detection.md`
