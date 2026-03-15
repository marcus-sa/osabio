# LLM Proxy Intelligence -- Component Boundaries

**Scope**: New modules and integration points for context injection (proxy-owned) + trace creation (proxy-owned) + contradiction detection (Observer-owned, NEW) + missing decision detection (Observer-owned, NEW).

> **Ownership boundary**: The proxy owns context injection and trace creation. ALL detection and analysis logic lives in the Observer system, triggered by SurrealDB EVENTs. The proxy has NO analysis modules.

---

## 1. New Modules

### 1.1 Session ID Resolver

- **Location**: `app/src/server/proxy/session-id-resolver.ts` (a single function, not a module with state)
- **Responsibility**: Extract session ID from incoming request metadata or headers. Pure function -- no DB calls, no side effects.
- **Input**: Request headers, parsed request body metadata
- **Output**: `string | undefined` (the external session ID, or undefined if no recognizable source)
- **Dependencies**: None (pure parsing logic)
- **Error contract**: Returns undefined on any failure or unrecognized input

Extraction sources (checked in order):
- **Claude Code**: `metadata.user_id` field in the request body, pattern `session_{uuid}` (already implemented in walking skeleton)
- **Brain-managed agents**: `X-Brain-Session` header value (set by orchestrator or CLI `brain init` hooks)
- **Unknown client**: No session ID -- returns undefined. Trace linked to workspace only.

### 1.2 Conversation Hash Resolver

- **Location**: `app/src/server/proxy/conversation-hash-resolver.ts` (a single function, not a module with state)
- **Responsibility**: Compute a deterministic conversation UUID from request content. Pure function — no DB calls, no side effects.
- **Input**: Parsed request body (messages array, system field)
- **Output**: `string | undefined` (UUIDv5 string, or undefined if system/first-user-message missing)
- **Dependencies**: None (pure computation — uses built-in crypto for UUIDv5)
- **Error contract**: Returns undefined on any failure or missing input

Algorithm:
- Extract system prompt content (string or concatenated text blocks from array)
- Extract first user message content from messages array
- If either is missing, return undefined
- `UUIDv5(BRAIN_PROXY_NAMESPACE, system_content + "\x00" + first_user_content)` → deterministic UUID
- The null byte separator prevents collisions between different system/user splits that concatenate to the same string

### 1.3 Conversation Upserter

- **Location**: `app/src/server/proxy/conversation-upserter.ts` (a single function, not a module with state)
- **Responsibility**: Create a conversation record using a deterministic UUIDv5 ID derived from request content. Idempotent — `CREATE` with a deterministic ID is a no-op if the record already exists.
- **Input**: Request body (system prompt + first user message), workspace RecordId
- **Output**: `RecordId<"conversation"> | undefined` (the conversation record ID, or undefined on failure)
- **Dependencies**: SurrealDB (`deps.surreal`)
- **Error contract**: Returns undefined on any failure (never throws, never blocks request forwarding)

Functions (behavioral contracts):
- **Compute conversation ID**: `UUIDv5(BRAIN_PROXY_NAMESPACE, system_content + "\x00" + first_user_content)` — pure function, no DB.
- **Create conversation**: `CREATE conversation:⟨$conv_id⟩ CONTENT { ... }` — idempotent, no lookup needed.
- **Title derivation**: First user message truncated to ~100 chars, same pattern as existing `deriveMessageTitle()`.

### 1.4 Context Injector

- **Location**: `app/src/server/proxy/context-injector.ts`
- **Responsibility**: Build context packet from knowledge graph, inject as system block
- **Input**: Parsed request body, workspace identity, session ID, intelligence config
- **Output**: Mutated request body with appended `<brain-context>` system block (or original body on failure)
- **Dependencies**: Embedding Pipeline (`createEmbeddingVector`, `cosineSimilarity`), Context Cache, SurrealDB
- **Error contract**: Returns original body on any failure (fail-open)

Functions (behavioral contracts, not signatures):
- **Build candidate pool**: Fetch confirmed decisions, active learnings, open conflict/warning observations for workspace. Return with embeddings for in-memory ranking.
- **Rank candidates**: Given candidate pool and user message embedding, compute weighted cosine similarity, return top N within token budget.
- **Inject system block**: Normalize system field to array, append `<brain-context>` block at end, return mutated body string.

### 1.5 Context Cache

- **Location**: `app/src/server/proxy/context-cache.ts`
- **Responsibility**: Per-session TTL cache for workspace candidate pools
- **Storage**: In-memory `Map<string, {pool, expiresAt}>` -- no shared state across processes
- **Keying**: `ctx:{session_id}` for candidate pools, `emb:{hash}` for embedding vectors
- **TTL**: Configurable (default 5 min for candidates, 10 min for embeddings)
- **Eviction**: TTL-based check on read. No background reaper needed at current scale.

### 1.6 Trace Writer (Extended)

- **Location**: `app/src/server/proxy/trace-writer.ts` (existing, extended with response content)
- **Responsibility**: Write `llm_call` trace with response content in FLEXIBLE `output` field after stream completion. The trace contains all content needed for Observer analysis -- the proxy does NOT analyze it.
- **Input**: Response content (text blocks + tool inputs), stop_reason, workspace identity, session ID, intelligence config metadata
- **Output**: Trace record created in SurrealDB. SurrealDB EVENT on trace creation triggers Observer per-trace analysis.
- **Dependencies**: SurrealDB (`deps.surreal`), Inflight Tracker (`deps.inflight`)
- **Error contract**: On trace write failure, log error and continue. Never throws to caller. Missing trace means Observer analysis is skipped (no EVENT fires).
- **Async contract**: All work tracked via `deps.inflight.track()`

Functions (behavioral contracts):
- **Build trace record**: Assemble trace with response text blocks, tool inputs, stop_reason, and intelligence metadata (context injection stats) in FLEXIBLE fields.
- **Write trace**: CREATE trace record in SurrealDB. This triggers the `trace_llm_call_created` EVENT which notifies the Observer.

> **The proxy does NOT contain a Response Analyzer.** All detection and analysis logic (contradiction detection, missing decision detection, decision signal extraction) lives in the Observer system. The proxy's post-response responsibility ends at trace creation.

### 1.7 Intelligence Config Loader

- **Location**: `app/src/server/proxy/intelligence-config.ts`
- **Responsibility**: Load per-workspace intelligence configuration with env-var fallbacks
- **Input**: Workspace RecordId
- **Output**: Resolved intelligence config (all fields populated from DB record or env defaults)
- **Cache**: Config record cached per-workspace for 5 min (same TTL as candidate pool)
- **Behavior**: Missing DB record = use env defaults. Missing env defaults = use hardcoded defaults.

### 1.6 Trace Response Analyzer (NEW Observer Module -- Per-Trace Analysis)

- **Location**: `app/src/server/observer/trace-response-analyzer.ts`
- **Responsibility**: Analyze individual `llm_call` trace content for decision signals, contradictions with confirmed decisions, and unrecorded decisions. Triggered by SurrealDB EVENT on trace creation.
- **Input**: Trace RecordId + trace body (from Observer route handler dispatching `trace` entity via EVENT webhook)
- **Output**: Zero or more observations created in SurrealDB (contradictions as `conflict`, missing decisions as `info`)
- **Dependencies**: Embedding Pipeline (`createEmbeddingVector`, `cosineSimilarity`), Observation System (`createObservation`), Verification Pipeline (confidence scoring, peer review gating), SurrealDB, Haiku-class model (for Tier 2 verification)
- **Error contract**: Never throws to caller. All errors caught internally, logged, handler returns 200. Analysis is best-effort.
- **Async contract**: Entire analysis runs inside the EVENT webhook handler. The EVENT is ASYNC so trace creation (and thus the proxy pipeline) is never blocked.

> **This module does NOT exist today.** The Observer currently has no handler for `trace` entities. This is a new capability that must be built.

Functions (behavioral contracts, not signatures):
- **Extract analysis targets**: From trace `output` FLEXIBLE field, extract text blocks and Edit/Write/Bash tool inputs. Skip Read/Glob/Grep tool uses. Check `stop_reason` -- skip `tool_use` (intermediate loop steps).
- **Decision signal extraction**: Scan extracted text for decision-shaped language (architectural choices, technology selections, approach rejections, "chose X over Y" statements).
- **Contradiction detection -- Tier 1 screening**: Embed extracted text, two-step KNN against confirmed decisions in workspace, filter by similarity threshold. Matches indicate potential contradictions.
- **Contradiction detection -- Tier 2 verification**: For each flagged candidate, call Haiku-class model with contradiction verification prompt. Discard low-confidence results.
- **Missing decision detection -- Tier 1 screening**: Embed each decision signal, two-step KNN against existing decisions. Match above threshold means already recorded -- skip. No match means unrecorded decision candidate.
- **Missing decision detection -- Tier 2 verification**: For each unmatched candidate, call Haiku-class model to verify it is a genuine decision. Discard low-confidence results.
- **Create observations**: For confirmed contradictions, create `conflict` severity observations linked to the contradicted decision and trace. For confirmed missing decisions, create `info` severity observations linked to the trace and agent session (if resolved).

### 1.7 Reverse Coherence Scan (NEW -- Extension to graph-scan.ts)

- **Location**: `app/src/server/observer/graph-scan.ts` (extension to existing `runCoherenceScans()`)
- **Responsibility**: Detect completed tasks and git commits that have NO linked decision records. The reverse of the existing orphaned decision check.
- **Input**: Workspace RecordId (same as existing coherence scans)
- **Output**: Zero or more `info` severity observations for implementations without recorded decisions
- **Dependencies**: SurrealDB (deterministic queries only, no LLM needed)
- **Error contract**: Same as existing coherence scans -- errors logged, do not abort remaining scans.

> **This scan phase does NOT exist today.** It is a new phase added to the existing `runCoherenceScans()` function alongside the orphaned decisions and stale objectives scans.

Functions (behavioral contracts, not signatures):
- **Query implementations without decisions**: Find completed tasks and git commits with no `implemented_by` or `belongs_to` edges connecting them to any decision record. Filter by workspace and age threshold (same 14-day threshold as existing coherence scans).
- **Create observations**: For each implementation without a decision, create `info` severity observation with text describing the gap. Deduplicate against existing observations (same pattern as existing coherence scan dedup).

### 1.8 Session Trace Analyzer (Cross-Trace Pattern Synthesis -- Enhancement)

- **Location**: `app/src/server/observer/session-trace-analyzer.ts`
- **Responsibility**: Analyze all traces from a completed agent session for cross-trace patterns that per-trace detection cannot catch. This is an enhancement for integrated clients with session lifecycle support, not a core detection mechanism.
- **Input**: Session RecordId (from Observer route handler dispatching `agent_session` entity)
- **Output**: Zero or more observations created in SurrealDB (cross-trace contradictions as `conflict`)
- **Dependencies**: Observer Agent (LLM reasoning), Embedding Pipeline (`createEmbeddingVector`, `cosineSimilarity`), Observation System (`createObservation`), Verification Pipeline (confidence scoring, peer review gating), SurrealDB
- **Error contract**: Never throws to caller. All errors caught internally, logged, handler returns 200. Analysis is best-effort.
- **Async contract**: Entire analysis runs inside the EVENT webhook handler. The EVENT is ASYNC so `endAgentSession()` is never blocked.
- **Prerequisite**: Capability 1.6 (Trace Response Analyzer) should be built first, as session-end analysis builds on the same trace content extraction and decision signal patterns.

**Note**: Per-trace contradiction detection and missing decision detection are handled by the Trace Response Analyzer (Section 1.6). This module focuses exclusively on patterns that only emerge when the full session trace history is visible.

Functions (behavioral contracts, not signatures):
- **Load session traces**: Fetch all traces for the session across all trace types. Return with input/output FLEXIBLE fields for content extraction.
- **Extract action content**: From trace input/output, extract text suitable for cross-trace analysis. Filter by trace type (skip read-only tool calls).
- **Cross-trace pattern analysis**: Delegate to OBSERVER_MODEL with full session context to identify approach drift, accumulated contradictions, and decision evolution patterns invisible to per-trace detection.
- **Verify candidates**: Delegate flagged patterns to OBSERVER_MODEL for confidence scoring. Apply same threshold and peer review pipeline as existing Observer.
- **Create observations**: For verified cross-trace patterns, create `conflict` observations linked to contradicted decision and agent_session.

---

## 2. Existing Module Dependencies

### 2.1 Embedding Pipeline (`app/src/server/graph/embeddings.ts`)

| Used by | Function | Purpose |
|---|---|---|
| Context Injector | `createEmbeddingVector()` | Embed last user message for per-turn ranking |
| Context Injector | `cosineSimilarity()` | In-memory ranking of cached candidates |
| Trace Response Analyzer (NEW) | `createEmbeddingVector()` | Embed trace response text + decision signals for KNN search |
| Session Trace Analyzer (NEW) | `createEmbeddingVector()` | Embed extracted trace content for KNN similarity |
| Session Trace Analyzer (NEW) | `cosineSimilarity()` | Compare trace-derived decision candidates against existing decisions |

No modifications needed. Functions are pure and reusable.

### 2.2 Observation System (`app/src/server/observation/queries.ts`)

| Used by | Function | Purpose |
|---|---|---|
| Trace Response Analyzer (NEW) | `createObservation()` | Create contradiction and missing-decision observations (per-trace) |
| Reverse Coherence Scan (NEW) | `createObservation()` | Create implementation-without-decision observations (batch) |
| Session Trace Analyzer (NEW) | `createObservation()` | Create cross-trace pattern observations (session-end enhancement) |

Parameters used:
- `observationType: "contradiction"` (already in `ObservationType` union)
- `observationType: "validation"` (for missing decisions -- already in `ObservationType` union)
- `severity: "conflict"` (contradictions) or `"info"` (missing decisions, implementations without decisions)
- `sourceAgent: "observer_agent"` (NOT `"llm_proxy"` -- the Observer owns all detection)
- `relatedRecords: [contradicted_decision_record, trace_record]`
- `embedding: tier1_embedding`
- `sourceSessionRecord` (if agent session resolved)

No modifications needed. The existing function signature supports all required parameters.

### 2.3 Inflight Tracker (`app/src/server/runtime/types.ts`)

| Used by | Function | Purpose |
|---|---|---|
| Trace Writer | `deps.inflight.track()` | Track async trace write for graceful shutdown |

Trace creation is fire-and-forget from the request handler's perspective but must be tracked to prevent `ConnectionUnavailableError` during shutdown. Observer analysis runs in the EVENT webhook handler, not in the proxy process -- no inflight tracking needed for detection.

### 2.4a Observer Agent (`app/src/server/agents/observer/agent.ts`)

| Used by | Function | Purpose |
|---|---|---|
| Trace Response Analyzer (NEW) | `runObserverAgent()` (extended with `trace` dispatch) | LLM reasoning for per-trace contradiction + missing decision verification |
| Session Trace Analyzer (NEW) | `runObserverAgent()` (extended with `agent_session` dispatch) | LLM reasoning for cross-trace pattern analysis |

The Observer agent's switch statement gains two new cases:
- `trace` case: delegates to the Trace Response Analyzer for per-trace contradiction + missing decision detection (NEW capability)
- `agent_session` case: delegates to the Session Trace Analyzer for cross-trace pattern synthesis (enhancement)

Both follow the same pattern as existing `task`, `intent`, `git_commit`, `decision`, and `observation` dispatches.

### 2.4b Observer Route Handler (`app/src/server/observer/observer-route.ts`)

| Used by | Function | Purpose |
|---|---|---|
| SurrealDB EVENT (trace_llm_call_created) | `createObserverRouteHandler()` | Receives `trace` webhook, dispatches to Observer agent (NEW) |
| SurrealDB EVENT (session_ended) | `createObserverRouteHandler()` | Receives `agent_session` webhook, dispatches to Observer agent |

The `SUPPORTED_TABLES` set gains `"trace"` and `"agent_session"`. Workspace resolution for `trace` requires looking up the session -> workspace chain (trace may not have a direct workspace field). Workspace resolution for `agent_session` uses its direct `workspace` field.

### 2.4c Verification Pipeline (`app/src/server/observer/verification-pipeline.ts`)

| Used by | Function | Purpose |
|---|---|---|
| Session Trace Analyzer | Confidence scoring, peer review gating | Same pipeline used by all Observer entity verification |

### 2.4d Embedding Pipeline (`app/src/server/graph/embeddings.ts`)

| Used by | Function | Purpose |
|---|---|---|
| Session Trace Analyzer | `createEmbeddingVector()` | Embed extracted trace content for KNN similarity |
| Session Trace Analyzer | `cosineSimilarity()` | Compare trace-derived decision candidates against existing decisions |

### 2.4e SurrealDB (via `deps.surreal`)

| Used by | Query Type | Tables |
|---|---|---|
| Context Injector (cache miss) | Simple indexed SELECT | `decision`, `learning`, `observation` |
| Conversation Upserter | SELECT + conditional CREATE/UPDATE | `conversation` |
| Trace Writer | CREATE | `trace` (triggers EVENT) |
| Intelligence Config Loader | Simple SELECT | `proxy_intelligence_config` |
| Trace Response Analyzer (NEW) | Two-step KNN | `decision` |
| Trace Response Analyzer (NEW) | Observation write | `observation`, `observes` |
| Reverse Coherence Scan (NEW) | Simple SELECT + edge traversal | `task`, `git_commit`, `decision`, `implemented_by` |
| Reverse Coherence Scan (NEW) | Observation write | `observation`, `observes` |

---

## 3. Module Dependency Graph

```
PROXY PIPELINE:

anthropic-proxy-route.ts (orchestrator)
  |-> intelligence-config.ts (config loader)
  |-> session-id-resolver.ts (pure function, no deps)
  |-> conversation-hash-resolver.ts (pure function, no deps)
  |-> conversation-upserter.ts (idempotent DB write)
  |     |-> deps.surreal (existing)
  |-> context-injector.ts (pre-forward hook)
  |     |-> context-cache.ts (session TTL cache)
  |     |-> graph/embeddings.ts (existing)
  |     |-> deps.surreal (existing)
  |-> trace-writer.ts (post-response: writes trace, triggers Observer EVENT)
  |     |-> deps.surreal (existing)
  |     |-> deps.inflight (existing)

OBSERVER PIPELINE (EVENT-driven, decoupled from proxy):

observer-route.ts (EVENT webhook handler, existing -- EXTENDED with trace + agent_session)
  |-> agents/observer/agent.ts (existing -- EXTENDED with trace + agent_session cases)
  |     |-> trace-response-analyzer.ts (NEW -- per-trace contradiction + missing decision)
  |     |     |-> graph/embeddings.ts (existing)
  |     |     |-> observation/queries.ts (existing)
  |     |     |-> observer/verification-pipeline.ts (existing)
  |     |     |-> Vercel AI SDK generateObject (for Tier 2 verification)
  |     |     |-> deps.surreal (existing)
  |     |-> session-trace-analyzer.ts (NEW -- cross-trace pattern synthesis, enhancement)
  |           |-> graph/embeddings.ts (existing)
  |           |-> observation/queries.ts (existing)
  |           |-> observer/verification-pipeline.ts (existing)
  |           |-> observer/llm-reasoning.ts (existing)
  |           |-> deps.surreal (existing)

graph-scan.ts (batch scan -- EXTENDED with reverse coherence check)
  |-> runCoherenceScans() gains implementations-without-decisions phase
  |     |-> observation/queries.ts (existing)
  |     |-> deps.surreal (existing)
```

---

## 4. Interface Contracts

### 4.1 Route Handler -> Session ID Resolver

The route handler calls the session ID resolver early in the pipeline (after identity resolution) to extract the session ID from the request.

- **Input**: Request headers, parsed request body metadata
- **Output**: `string | undefined` (the external session ID, or undefined if unrecognized)
- **Contract**: Pure function. Never throws. No DB calls. No side effects. Returns undefined on any failure or unrecognized input.

### 4.1b Route Handler -> Conversation Hash Resolver

The route handler calls the conversation hash resolver after session ID resolution. It extracts the system prompt and first user message from the request body, producing a deterministic UUIDv5.

- **Input**: Parsed request body (messages array, system field)
- **Output**: `string | undefined` (UUIDv5 string, or undefined if system/first-user-message missing)
- **Contract**: Pure function. Never throws. No DB calls. No side effects. Returns undefined on any failure or missing input.

### 4.1c Route Handler -> Conversation Upserter

The route handler calls the conversation upserter with the hash from 4.1b. It upserts a conversation record keyed by content hash and workspace, returning the conversation RecordId for trace linking.

- **Input**: Content hash string, workspace RecordId, first user message text (for title derivation), SurrealDB connection
- **Output**: `RecordId<"conversation"> | undefined` (the conversation record ID, or undefined on failure)
- **Contract**: Never throws. Returns undefined on any failure. Failure never blocks request forwarding.

### 4.2 Route Handler -> Context Injector

The route handler passes the parsed request body, identity context, and config. The injector returns a (possibly mutated) serialized body string.

- **Input**: Request body string, workspace RecordId, session ID, intelligence config, embedding model + dimension
- **Output**: `{ body: string, metadata: { injected: boolean, decisions: number, learnings: number, observations: number, tokensEst: number } }`
- **Contract**: Never throws. Returns original body + `injected: false` on any failure.

### 4.3 Route Handler -> Trace Writer

The route handler calls the trace writer after the stream completes. The trace writer runs async and returns nothing to the caller. It writes the `llm_call` trace with response content, which triggers the Observer via SurrealDB EVENT.

- **Input**: Response content blocks, stop_reason, workspace RecordId, session RecordId (optional), conversation RecordId (optional), intelligence config metadata, dependencies (surreal, inflight tracker)
- **Output**: `void` (side-effect: trace record created in SurrealDB, which triggers Observer EVENT)
- **Contract**: Never throws. All errors caught internally and logged. Failed trace write means Observer analysis is silently skipped (no EVENT fires). Conversation link stored in trace input FLEXIBLE field when provided.

### 4.4 Observer Route -> Trace Response Analyzer (via Observer Agent, NEW)

The Observer route handler receives the `trace` EVENT webhook (fired on `llm_call` trace creation) and delegates to the Observer agent. The agent dispatches to the Trace Response Analyzer for per-trace contradiction + missing decision detection.

- **Input**: Trace RecordId, workspace RecordId, trace body (with `type`, `output`, `session`, `workspace`), Haiku-class model, embedding model + dimension
- **Output**: `ObserverAgentOutput` (same shape as all Observer entity verifications: `{ observations_created, verdict, evidence }`)
- **Contract**: Never throws. All errors caught internally. Returns `{ observations_created: 0, verdict: "inconclusive" }` on any failure.

> **This contract does not exist today.** The Observer route currently does not handle `trace` entities. The `SUPPORTED_TABLES` set, Observer agent dispatch, and the Trace Response Analyzer module all need to be created.

### 4.5 Observer Route -> Session Trace Analyzer (via Observer Agent)

The Observer route handler receives the `agent_session` EVENT webhook and delegates to the Observer agent. The agent dispatches to the Session Trace Analyzer for cross-trace pattern synthesis (enhancement for integrated clients).

- **Input**: Session RecordId, workspace RecordId, session body (with `ended_at`, `workspace`, `summary`), OBSERVER_MODEL, embedding model + dimension
- **Output**: `ObserverAgentOutput` (same shape as all Observer entity verifications: `{ observations_created, verdict, evidence }`)
- **Contract**: Never throws. All errors caught internally. Returns `{ observations_created: 0, verdict: "inconclusive" }` on any failure.

### 4.6 Route Handler -> Intelligence Config Loader

- **Input**: Workspace RecordId, SurrealDB connection
- **Output**: Resolved config object with all fields populated (DB values override env defaults)
- **Contract**: Returns hardcoded defaults on any failure (config loading failure must never block the request).
