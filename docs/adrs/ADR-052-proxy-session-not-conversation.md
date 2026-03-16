# ADR-052: Proxy Upserts Agent Sessions, Not Conversations

## Status

Proposed — supersedes ADR-049 and ADR-050

## Context

The LLM proxy was correlating traces into `conversation` records using a UUIDv5 content hash (ADR-050). However, `conversation` is a chat UI entity — it models the back-and-forth between a human and Brain's chat agent. Proxy traffic comes from external coding agents (Claude Code, Cursor, custom agents), which are not chat UI conversations. Mixing the two domains in the same table conflates semantics and creates confusion for Observer analysis, feed rendering, and cost attribution.

Meanwhile, ADR-049 established the proxy as read-only for sessions — it would never create or update `agent_session` records, deferring lifecycle to CLI hooks and orchestrators. This was sound when all agents used `brain init`, but unknown clients (no session header, no metadata) produced orphaned traces linked only to a workspace. Observer session-end analysis (ADR-048) cannot run on traces that have no session.

The `agent_session` table is the correct grouping entity for agent work. The content hash mechanism from ADR-050 is still valuable — but it should produce session IDs, not conversation IDs.

## Decision

The proxy upserts `agent_session` records instead of `conversation` records. The content hash (UUIDv5 of system prompt + first user message) serves as a **fallback** session ID when no explicit session signal is available.

### Session ID resolution priority

| Priority | Source | Signal |
|----------|--------|--------|
| 1 | `X-Brain-Session` header | Explicit session ID from orchestrator |
| 2 | `metadata.user_id` (Claude Code) | Session extracted from `user_<hash>_account_<uuid>_session_<uuid>` |
| 3 | Content hash (UUIDv5) | Deterministic from system prompt + first user message |

When priority 1 or 2 resolves a session, the proxy links the trace to the existing `agent_session` via `resolveAgentSessionId` (DB lookup by `external_session_id`). When only priority 3 is available, the proxy **upserts** an `agent_session` record using the content hash as the session ID.

### Agent identity on hash-derived sessions

Hash-derived sessions have no CLI/orchestrator to set the `agent` field. The proxy resolves the agent name from available signals:

| Priority | Source | Value |
|----------|--------|-------|
| 1 | `X-Brain-Agent-Type` header | Explicit agent type (e.g. `"coding-agent"`, `"architect"`) |
| 2 | `User-Agent` header containing `"claude-cli"` | `"claude-cli"` |
| 3 | Fallback | `"proxy"` |

### Schema change

A `source` field is added to `agent_session`:

```sql
DEFINE FIELD OVERWRITE source ON agent_session TYPE option<string>;
```

The proxy sets `source: "proxy"` on upserted sessions to distinguish them from CLI/orchestrator-created sessions. This enables Observer and UI to filter or annotate proxy-inferred sessions differently.

### What changed from ADR-049

ADR-049 prohibited the proxy from creating sessions. This ADR relaxes that constraint **only for the content-hash fallback path**. When an explicit session ID is present (priority 1 or 2), the proxy remains read-only — it looks up the existing session and links the trace. The proxy still does not manage session lifecycle (no `ended_at`, no inactivity timeout, no background sweep).

### What changed from ADR-050

The `conversation-upserter` is removed. The content hash resolver is renamed from `conversation-hash-resolver` to `session-hash-resolver`. Its output type changes from `ConversationHash` to `SessionHash`. The UUIDv5 namespace constant is renamed to `BRAIN_PROXY_SESSION_NS`. The deterministic ID mechanism is identical — only the target table changes from `conversation` to `agent_session`.

## Alternatives Considered

### Alternative 1: Keep Conversations for Proxy, Add Session Link Later

Continue upserting `conversation` records from the proxy and add an `agent_session` link as a separate field on the conversation.

**Rejected because**: A conversation is a chat UI concept with its own lifecycle (messages, streaming, onboarding state). Proxy traces are not conversations — they are agent work sessions. Adding a session link to a conversation record does not fix the semantic mismatch; it papers over it with an extra indirection.

### Alternative 2: Create a New `proxy_session` Table

Introduce a dedicated table for proxy-inferred sessions, separate from `agent_session`.

**Rejected because**: Proxy-inferred sessions and CLI/orchestrator sessions serve the same purpose — grouping agent traces for analysis. A separate table would require Observer, feed, and cost attribution to query two tables. The `source` field on `agent_session` provides sufficient distinction without table proliferation.

### Alternative 3: No Fallback — Unknown Clients Get No Session

Only create session links when explicit session signals (priority 1 or 2) are present. Unknown clients produce workspace-only traces.

**Rejected because**: This was the ADR-049 approach. In practice, many agents do not send session headers. Observer session-end analysis (ADR-048) cannot run on sessionless traces. The content hash fallback is low-cost (one upsert per unique system prompt + first message) and provides grouping for all clients.

## Consequences

### Positive

- Correct domain modeling — agent work is tracked in `agent_session`, chat UI stays in `conversation`
- All proxy clients get session grouping — no integration required
- Observer session-end analysis works for all clients, not just those with `brain init`
- `source: "proxy"` enables filtering proxy-inferred sessions from CLI-managed ones
- Content hash mechanism preserved — zero-lookup correlation still works, just targets the right table

### Negative

- Proxy now writes to `agent_session` on the fallback path (one upsert per unique content hash, not per request)
- Hash-derived sessions have no `ended_at` — Observer session-end trigger does not fire for them (same as before with conversations; a future inactivity timeout ADR can address this)
- Agent identity on hash-derived sessions is best-effort — `User-Agent` detection is heuristic-based

## References

- ADR-049: Proxy Session ID Resolution (superseded — proxy was read-only)
- ADR-050: Conversation Hash Correlation via UUIDv5 (superseded — used conversation table)
- ADR-048: Observer Session-End Trace Analysis
- ADR-040: LLM Proxy In-Process Module
- Migration: `schema/migrations/0049_agent_session_source_field.surql`
