# LLM Proxy Intelligence -- Data Models

**Scope**: Schema extensions, cache structures, and payload formats for session ID resolution, context injection, and contradiction detection.

---

## 1. Schema Extensions: `agent_session` Table

The existing `agent_session` table gains one field to support proxy session ID resolution. Migration: `schema/migrations/0040_proxy_session_id.surql`.

```sql
-- external_session_id: the client's session identifier (replaces opencode_session_id)
-- Claude Code: metadata.user_id ("session_{uuid}"); Brain-managed: X-Brain-Session header value
DEFINE FIELD OVERWRITE external_session_id ON agent_session TYPE option<string>;

-- Index for session ID lookup: find active session by external ID + workspace
DEFINE INDEX OVERWRITE agent_session_external_id ON agent_session FIELDS external_session_id, workspace;

-- Deprecate opencode_session_id (replaced by external_session_id)
REMOVE FIELD opencode_session_id ON agent_session;
```

**Design notes**:
- `external_session_id` replaces `opencode_session_id` as a generalized client session identifier. The rename reflects that the proxy supports any client, not just OpenCode.
- The proxy only reads this field to link traces to existing sessions. Session creation is handled by the CLI (`brain init` hooks) and orchestrator.
- The composite index on `(external_session_id, workspace)` optimizes the lookup query used by the trace writer.

---

## 2. Conversation Hash Correlation

The proxy derives a deterministic conversation ID using UUIDv5 from the request content. This enables trace grouping without sessions.

### 2.1 Conversation Records Created by Proxy

The proxy computes `UUIDv5(BRAIN_PROXY_NAMESPACE, system_prompt + "\x00" + first_user_message)` to produce a deterministic UUID. This UUID is used directly as the conversation record ID (`conversation:<uuidv5>`). Same conversation content always produces the same ID — no lookup needed.

Both proxy-created and UI-created conversations use UUIDs, but UUIDv5 (deterministic, namespace-based) will not collide with UUIDv4 (random) used by the web UI.

The proxy uses only existing `conversation` table fields — no schema changes required:

| Field | Value | Notes |
|---|---|---|
| `workspace` | Resolved workspace RecordId | Scopes the conversation |
| `title` | First user message (truncated ~100 chars) | Same pattern as `deriveMessageTitle()` |
| `source` | `"proxy"` | Distinguishes proxy-created from UI-created conversations |
| `createdAt` | Timestamp of first request | Set on creation only |
| `updatedAt` | Timestamp of latest request | Updated on subsequent requests |

### 2.2 Conversation Create Query Pattern

```sql
-- Deterministic ID from UUIDv5 — no lookup needed
-- CREATE only runs if the record doesn't exist yet
CREATE conversation:⟨$conv_id⟩ CONTENT {
  workspace: $ws,
  title: $title,
  source: "proxy",
  createdAt: time::now(),
  updatedAt: time::now()
};
```

**Design notes**:
- `$conv_id` is `UUIDv5(BRAIN_PROXY_NAMESPACE, system_content + "\x00" + first_user_content)` (null byte separator prevents collisions)
- The deterministic ID eliminates the need for a `content_hash` field or lookup query — the ID itself encodes the content identity
- `CREATE` is idempotent when the record already exists (SurrealDB returns the existing record)
- The upsert is the ONLY DB write the proxy performs for correlation (besides the trace itself)

### 2.3 Trace-to-Conversation Link

The trace record gains an optional conversation reference:

```
conversation: option<record<conversation>>
```

This field is set by the trace writer when conversation hash resolution succeeds. When the conversation hash cannot be computed (missing system prompt or first user message), this field is omitted.

The link enables:
- `SELECT * FROM trace WHERE conversation = $conv` -- all traces in a conversation
- Cost attribution per conversation across all requests
- Observer fallback correlation when no agent_session exists

**Note**: This field is stored in the FLEXIBLE `input` object alongside existing intelligence metadata, not as a top-level trace field. No schema migration needed.

```json
{
  "brain_context_injected": true,
  "brain_context_decisions": 3,
  "conversation": "conversation:a1b2c3..."
}
```

---

## 3. New Table: `proxy_intelligence_config`

Per-workspace configuration for intelligence capabilities. Migration: `schema/migrations/0040_proxy_intelligence_config.surql`.

```sql
DEFINE TABLE proxy_intelligence_config SCHEMAFULL;
DEFINE FIELD workspace ON proxy_intelligence_config TYPE record<workspace>;

-- Context Injection
DEFINE FIELD context_injection_enabled ON proxy_intelligence_config TYPE bool DEFAULT true;
DEFINE FIELD context_injection_token_budget ON proxy_intelligence_config TYPE int DEFAULT 1000;
DEFINE FIELD context_injection_cache_ttl_seconds ON proxy_intelligence_config TYPE int DEFAULT 300;
DEFINE FIELD context_injection_tier ON proxy_intelligence_config TYPE string
  DEFAULT "secure"
  ASSERT $value IN ["fast", "secure"];

-- Contradiction Detection
DEFINE FIELD contradiction_detection_enabled ON proxy_intelligence_config TYPE bool DEFAULT true;
DEFINE FIELD contradiction_tier1_threshold ON proxy_intelligence_config TYPE float DEFAULT 0.75;
DEFINE FIELD contradiction_tier2_confidence_min ON proxy_intelligence_config TYPE float DEFAULT 0.6;

-- Timestamps
DEFINE FIELD created_at ON proxy_intelligence_config TYPE datetime;
DEFINE FIELD updated_at ON proxy_intelligence_config TYPE datetime;

-- One config per workspace
DEFINE INDEX proxy_intel_config_workspace ON proxy_intelligence_config FIELDS workspace UNIQUE;
```

**Design notes**:
- SCHEMAFULL (project convention, no SCHEMALESS tables)
- `context_injection_tier`: `"fast"` skips injection, `"secure"` enables it. Both tiers still run contradiction detection (async, no latency impact)
- Default values match env-var defaults for zero-config operation
- No secret scanning fields in this scope (excluded per task constraints)

---

## 4. Trace Metadata Extensions

The existing `trace` table (migration 0023) has FLEXIBLE `input` and `output` fields. Intelligence metadata is stored in these fields -- no schema changes required.

### `input` FLEXIBLE additions (when context injection runs)

```json
{
  "brain_context_injected": true,
  "brain_context_decisions": 3,
  "brain_context_learnings": 2,
  "brain_context_observations": 1,
  "brain_context_tokens_est": 680
}
```

### `output` FLEXIBLE additions (when post-response analysis runs)

```json
{
  "contradiction_tier1_candidates": 2,
  "contradiction_tier2_confirmed": 1,
  "contradiction_observation_ids": ["observation:7f3a..."],
  "missing_decision_candidates": 1,
  "missing_decision_confirmed": 1,
  "missing_decision_observation_ids": ["observation:8b4c..."]
}
```

These fields enable the Observer to query intelligence pipeline effectiveness:
- "How often is context injected?" -- `SELECT count() FROM trace WHERE type = 'llm_call' AND input.brain_context_injected = true GROUP ALL`
- "What percentage of responses trigger contradiction candidates?" -- `SELECT count() FROM trace WHERE output.contradiction_tier1_candidates > 0 GROUP ALL`
- "How many missing decisions detected?" -- `SELECT count() FROM trace WHERE output.missing_decision_confirmed > 0 GROUP ALL`

---

## 5. Context Cache Structure (In-Memory)

### Candidate Pool Cache

```
Map<string, CandidatePoolEntry>

Key format: "ctx:{session_id}"

CandidatePoolEntry = {
  pool: CandidateItem[]
  expiresAt: number  // Date.now() + TTL ms
}

CandidateItem = {
  id: string         // RecordId serialized
  table: string      // "decision" | "learning" | "observation"
  text: string       // summary/text field
  detail: string     // rationale (decisions) or empty
  priority: number   // 1.0 for decisions, 0.8 for learnings, 0.7 for observations
  embedding: number[] // pre-fetched for in-memory ranking
}
```

### Embedding Cache

```
Map<string, EmbeddingCacheEntry>

Key format: "emb:{sha256(text).slice(0,16)}"

EmbeddingCacheEntry = {
  vector: number[]
  expiresAt: number  // Date.now() + TTL ms
}
```

**Sizing estimates** (per session):
- Candidate pool: ~50 decisions + 30 learnings + 20 observations = 100 items
- Each item embedding: 1536 floats x 4 bytes = ~6KB
- Total per session: ~600KB + metadata
- With 10 concurrent sessions: ~6MB -- negligible for an in-process cache

---

## 6. Injected System Block Format

The `<brain-context>` block appended to the Anthropic Messages API `system` field:

```json
{
  "type": "text",
  "text": "<brain-context workspace=\"acme\" project=\"backend-v2\" session=\"abc-123\" injected_at=\"2026-03-15T10:30:00Z\">\n## Active Decisions\n- [d:7f3a] Standardize on tRPC for all internal APIs (confirmed 2026-03-10)\n\n## Constraints\n- [l:4e1f] All new endpoints must include DPoP authentication\n\n## Open Observations\n- [o:2d5a] WARNING: billing API still uses REST, contradicts tRPC decision d:7f3a\n</brain-context>",
  "cache_control": { "type": "ephemeral" }
}
```

**Format choices**:
- XML wrapper with attributes: LLMs parse XML reliably, distinctive tag avoids collisions
- Short IDs (`d:7f3a`): First 4 chars of UUID, sufficient for LLM reference without token waste
- Markdown inside: Bullet lists for decisions/learnings/observations
- `cache_control: ephemeral`: Enables prompt caching for subsequent turns (context stable per session)

---

## 7. Observation Payloads (Observer Per-Trace Analysis)

> **These observations are created by the Observer, NOT the proxy.** The proxy writes traces; the Observer analyzes them via SurrealDB EVENT triggers and creates observations. The `sourceAgent` is `"observer_agent"`, not `"llm_proxy"`.

Both contradiction detection and missing decision detection run in the Observer's Trace Response Analyzer (triggered by the `trace_llm_call_created` EVENT). Each produces different observation payloads.

### 6.1 Contradiction Observation (from per-trace analysis)

When the Observer's Trace Response Analyzer confirms a contradiction, it creates an observation using the existing `createObservation()` function:

```
{
  surreal: deps.surreal
  workspaceRecord: <workspace RecordId>
  text: "Agent action contradicts decision [d:7f3a]: Agent implemented REST endpoint, but decision d:7f3a requires tRPC for all internal APIs"
  severity: "conflict"
  observationType: "contradiction"
  sourceAgent: "observer_agent"
  sourceSessionRecord: <agent_session RecordId> (if resolved from trace -> session link)
  relatedRecords: [<decision RecordId>, <trace RecordId>]
  embedding: <tier1 embedding vector>
  confidence: <tier2 confidence score>
  verified: true
  now: new Date()
}
```

The `observes` edge is created automatically by `createObservation()` linking the observation to the contradicted decision and the triggering trace.

### 6.2 Missing Decision Observation (from per-trace analysis)

When the Observer's Trace Response Analyzer detects an unrecorded decision in trace content:

```
{
  surreal: deps.surreal
  workspaceRecord: <workspace RecordId>
  text: "Unrecorded decision detected: Agent decided '{candidate_summary}' but no matching decision exists in workspace graph"
  severity: "info"
  observationType: "validation"
  sourceAgent: "observer_agent"
  sourceSessionRecord: <agent_session RecordId> (if resolved from trace -> session link)
  relatedRecords: [<trace RecordId>, <agent_session RecordId>] (if session resolved)
  embedding: <candidate decision embedding>
  confidence: <tier2 confidence score>
  verified: true
  now: new Date()
}
```

**Notes**:
- Severity is `info` (not `conflict`) because a missing decision is informational -- it suggests a decision should be recorded, not that something is wrong
- `observationType: "validation"` aligns with the existing Observer pattern for entity verification findings
- The observation text includes enough context for a human to decide whether to create the decision

### 6.3 Implementation Without Decision Observation (from reverse coherence scan)

When the Observer's reverse coherence scan finds completed tasks or commits with no linked decision records:

```
{
  surreal: deps.surreal
  workspaceRecord: <workspace RecordId>
  text: "Implementation without recorded decision: Task '{task_title}' (completed {date}) has no linked decision record. Consider recording the decision that led to this implementation."
  severity: "info"
  observationType: "validation"
  sourceAgent: "observer_agent"
  relatedRecords: [<task RecordId> or <git_commit RecordId>]
  now: new Date()
}
```

**Notes**:
- No embedding or LLM verification needed -- this is a deterministic graph query (same pattern as existing orphaned decision and stale objective scans)
- Severity is `info` because the absence of a decision record is informational, not an error
- Deduplicated against existing observations on the same entity (same pattern as existing coherence scan dedup)

---

## 8. SurrealDB Queries

### Session ID Lookup (trace writer, when session ID resolved)

```sql
-- Find active session by external_session_id + workspace
-- Used by trace writer to link traces to existing sessions
SELECT id FROM agent_session
  WHERE external_session_id = $ext_session_id
    AND workspace = $ws
    AND ended_at IS NONE
  LIMIT 1;
```

This is a read-only lookup. The proxy never creates or updates agent_session records.

### Context Injection -- Candidate Pool Fetch (cache miss)

```sql
-- Confirmed decisions for workspace
SELECT id, summary, rationale, status, embedding
FROM decision
WHERE workspace = $ws AND status = "confirmed"
ORDER BY created_at DESC
LIMIT 50;

-- Active learnings for workspace
SELECT id, text, learning_type, priority, target_agents, embedding
FROM learning
WHERE workspace = $ws AND status = "active"
ORDER BY priority DESC, created_at DESC
LIMIT 30;

-- Open conflict/warning observations for workspace
SELECT id, text, severity, observation_type, embedding
FROM observation
WHERE workspace = $ws
  AND status IN ["open", "acknowledged"]
  AND severity IN ["conflict", "warning"]
ORDER BY created_at DESC
LIMIT 20;
```

These are simple indexed queries (no KNN). The workspace field has a B-tree index on `decision`, `learning`, and `observation` tables.

### Contradiction Detection -- Two-Step KNN

```sql
-- Step 1: KNN candidates (HNSW index only)
LET $candidates = SELECT id, summary, rationale, status, workspace,
  vector::similarity::cosine(embedding, $response_embedding) AS similarity
FROM decision WHERE embedding <|20, COSINE|> $response_embedding;

-- Step 2: Filter by workspace + status + threshold
SELECT id, summary, rationale, similarity
FROM $candidates
WHERE workspace = $ws
  AND status = "confirmed"
  AND similarity > $tier1_threshold
ORDER BY similarity DESC
LIMIT 5;
```

Uses the two-step pattern required by the SurrealDB v3.0 KNN + WHERE bug (documented in CLAUDE.md).

### Intelligence Config Load

```sql
SELECT * FROM proxy_intelligence_config
WHERE workspace = $ws
LIMIT 1;
```

---

## 9. SurrealDB EVENTs

### 8.1 EVENT: `trace_llm_call_created` on `trace` (NEW)

Migration: `schema/migrations/0042_trace_llm_call_event.surql`

```sql
-- EVENT: trace_llm_call_created -- fires when a trace record with type = "llm_call" is created
-- Triggers Observer per-trace analysis (contradiction detection + missing decision detection)
-- This is the bridge between the proxy (trace creator) and the Observer (trace analyzer)
DEFINE EVENT OVERWRITE trace_llm_call_created ON trace
  ASYNC
  RETRY 3
  WHEN $event = "CREATE"
    AND $after.type = "llm_call"
  THEN {
    LET $id = record::id($after.id);
    http::post("http://localhost:3000/api/observe/trace/" + <string> $id, $after);
  };
```

**Design notes**:
- Follows the exact same pattern as existing Observer EVENTs (task_completed, intent_completed, commit_created, decision_confirmed, observation_peer_review, session_ended)
- `ASYNC` ensures the trace write commits before the webhook fires and is never blocked
- `RETRY 3` provides resilience against transient webhook failures
- `$after.type = "llm_call"` ensures the EVENT only fires for proxy-created traces, not for other trace types (tool_call, message, subagent_spawn, etc.)
- Passes `$after` body so the Observer route can extract workspace and session from the trace record without extra queries
- **This EVENT triggers NEW Observer capabilities** that must be built (Trace Response Analyzer). The Observer currently has no handler for `trace` entities.

### 8.2 EVENT: `session_ended` on `agent_session`

Migration: `schema/migrations/0040_session_ended_event.surql`

```sql
-- EVENT 6: session_ended -- fires when any agent_session.ended_at transitions from NONE to a value
-- Triggers Observer session trace analysis (missing decisions + session-scoped contradictions)
-- Fires for ALL sessions regardless of who ends them (CLI, orchestrator, or any future mechanism)
DEFINE EVENT OVERWRITE session_ended ON agent_session
  ASYNC
  RETRY 3
  WHEN $event = "UPDATE"
    AND $before.ended_at IS NONE
    AND $after.ended_at IS NOT NONE
  THEN {
    LET $id = record::id($after.id);
    http::post("http://localhost:3000/api/observe/agent_session/" + <string> $id, $after);
  };
```

**Design notes**:
- Follows the exact same pattern as existing Observer EVENTs (task_completed, intent_completed, commit_created, decision_confirmed, observation_peer_review)
- `ASYNC` ensures the session-ending write commits before the webhook fires and is never blocked
- `RETRY 3` provides resilience against transient webhook failures
- `$before.ended_at IS NONE AND $after.ended_at IS NOT NONE` ensures the event fires exactly once per session end
- No `source` filter -- the EVENT fires for all sessions. Session lifecycle is owned by CLI/orchestrator; the Observer analyzes all ended sessions uniformly.
- Passes `$after` body so the Observer route can extract workspace from the session record without an extra query

---

## 10. Trace Query Patterns for Session Analysis

### Load All Session Traces

```sql
-- All traces for a session, ordered chronologically
SELECT id, type, tool_name, input, output, duration_ms, created_at
FROM trace
WHERE session = $session
ORDER BY created_at ASC;
```

Uses the existing `trace_session` index. Returns all trace types: `tool_call`, `message`, `subagent_spawn`, `intent_submission`, `bridge_exchange` (and `llm_call` once the proxy trace type migration lands).

### Session Trace Statistics (for logging/diagnostics)

```sql
SELECT type, count() AS count
FROM trace
WHERE session = $session
GROUP BY type;
```

---

## 11. Observation Payloads for Session-End Cross-Trace Pattern Synthesis (Enhancement)

**Note**: Per-trace contradiction and missing decision detection are handled by the Observer's Trace Response Analyzer (Section 6), triggered by the `trace_llm_call_created` EVENT. This section covers observations from the session-end cross-trace pattern synthesis -- an enhancement for integrated clients only.

### Cross-Trace Pattern Observation

```
{
  surreal: deps.surreal
  workspaceRecord: <workspace RecordId>
  text: "Cross-trace pattern detected in session {session_id}: Agent actions across traces contradict decision [d:{short_id}]: {explanation}"
  severity: "conflict"
  observationType: "contradiction"
  sourceAgent: "observer_agent"
  sourceSessionRecord: <agent_session RecordId>
  relatedRecords: [<decision RecordId>, <agent_session RecordId>]
  embedding: <pattern embedding>
  confidence: <OBSERVER_MODEL confidence score>
  verified: true (passed peer review)
  source: "llm"
}
```

**Notes**:
- These observations capture patterns invisible to per-request detection (e.g., approach drift across traces, accumulated contradictions)
- Severity is `conflict` (same as per-request contradiction observations from the proxy)
- `observationType: "contradiction"` aligns with existing proxy contradiction observations, enabling the graph scan to correlate per-request and session-level findings
- Both the contradicted `decision` and the `agent_session` are linked via `observes` edges
- Deduplication: before creating, check for existing open contradiction observations on the same decision + session pair (same pattern as `queryExistingObserverObservationsForEntity`)
