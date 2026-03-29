# ADR-042: LLM Trace via Existing `trace` Table

## Status
Proposed

## Context
LLM calls need to be stored for cost attribution, audit provenance, and spend monitoring. The data must support queries like "total cost for task X", "all calls in session Y", and "provenance chain from intent to LLM call". Osabio uses SurrealDB as a graph database with SCHEMAFULL tables and RELATE edges.

Osabio already has a `trace` table — a forensic record of a "unit of thought" (call tree node). It tracks tool calls, messages, subagent spawns, intent submissions, and bridge exchanges. It already has `actor`, `workspace`, `session`, `parent_trace`, `input` (FLEXIBLE object), `output` (FLEXIBLE object), and `duration_ms`.

## Decision
Extend the existing `trace` table with `"llm_call"` as a new type and add LLM-specific fields for model, token counts, cost, and stop reason. Do NOT create a separate `llm_trace` table.

The existing `trace` infrastructure already provides:
- `session` → links to `agent_session`
- `workspace` → workspace scoping
- `parent_trace` → hierarchical call tree
- `input` / `output` → FLEXIBLE objects for request/response payloads
- `duration_ms` → latency
- Indexes on `session`, `workspace`, `created_at`

New fields added:
- `model` — LLM model ID (e.g. `claude-opus-4-6`)
- `input_tokens` — token count from request
- `output_tokens` — token count from response
- `cache_creation_tokens` — prompt cache write tokens
- `cache_read_tokens` — prompt cache hit tokens
- `cost_usd` — computed cost at time of call
- `stop_reason` — why generation stopped (e.g. `end_turn`, `tool_use`)
- `provider` — upstream provider (e.g. `anthropic`, `openrouter`, `ollama`)

### Agent session upsert and external session linking

The proxy upserts an `agent_session` record for each unique session ID extracted from `metadata.user_id`. The existing `opencode_session_id` field is renamed to `external_session_id` to generalize beyond OpenCode — it now stores the Claude Code session UUID (or any external agent's session identifier).

Flow per request:
1. Extract `session_id` from `metadata.user_id` (e.g. `f9beb288-4fd4-4caf-9268-02f8ef0b4675`)
2. In-memory cache: `Map<string, RecordId<agent_session>>` — avoids DB lookup on every call
3. Cache miss → upsert `agent_session` with `external_session_id = session_id`, `agent = "claude-code"` (from `user-agent` header), `workspace` (resolved from session or header)
4. Cache hit → update `last_event_at` (async, non-blocking)
5. Write `trace` with `session: <cached agent_session RecordId>`

Migration renames `opencode_session_id` → `external_session_id` on `agent_session` and updates all existing references.

Migration adds `"llm_call"` to the type ASSERT enum, defines the new optional LLM fields on `trace`, and renames `opencode_session_id` to `external_session_id` on `agent_session`.

## Alternatives Considered

### Alternative 1: Create a separate `llm_trace` table
- **What**: New SCHEMAFULL table with dedicated LLM fields and separate RELATE edges (`invoked`, `scoped_to`, `attributed_to`, `governed_by`)
- **Expected impact**: Clean separation of LLM traces from agent traces
- **Why rejected**: Duplicates infrastructure that already exists. The `trace` table already has workspace scoping, session linking, hierarchical parent traces, flexible input/output, and duration. A separate table means two trace concepts in the schema, duplicate indexes, and queries that need to UNION across both tables to get a complete session timeline. The trace table was designed to be extensible — its type enum exists precisely for adding new trace kinds.

### Alternative 2: Store LLM data only in `input`/`output` FLEXIBLE fields
- **What**: Add `"llm_call"` to type enum but put all LLM-specific data (model, tokens, cost) inside the existing FLEXIBLE `input`/`output` objects
- **Expected impact**: Zero new fields, minimal migration
- **Why insufficient**: Cost aggregation queries (`math::sum` on `cost_usd`, filtering by model) require indexed top-level fields, not nested FLEXIBLE properties. SurrealDB cannot index into FLEXIBLE object keys for efficient filtering.

### Alternative 3: External observability (Langfuse / OpenTelemetry collector)
- **What**: Send traces to Langfuse or an OTel collector
- **Expected impact**: Rich observability UI out of the box
- **Why insufficient**: Traces would not be part of the Osabio knowledge graph. Cannot query "all LLM calls governed by policy X" or "cost of task Y" without cross-system joins. Adds external infrastructure dependency. Osabio's value proposition is that all agent activity is in one graph.

## Consequences
- **Positive**: Single trace timeline per session — agent tool calls and LLM calls in one query, ordered by `created_at`
- **Positive**: Existing `spawns` relation (message → trace) works for LLM calls too
- **Positive**: Spend aggregation via `math::sum(cost_usd)` with `WHERE type = "llm_call"` and workspace/session filters
- **Positive**: Observer can analyze LLM trace patterns alongside agent traces — same table, same queries
- **Positive**: No new relation tables needed — `session`, `workspace`, `parent_trace` edges already exist
- **Negative**: LLM-specific fields are optional on all trace records (only populated when `type = "llm_call"`)
- **Negative**: Type ASSERT enum grows — but this is the intended extension mechanism
