# Technology Stack: Objective & Behavior Nodes

## Principle: Reuse Existing Stack

This feature introduces **zero new dependencies**. All technology choices are "use existing" -- the Brain platform already has every required capability.

| Capability | Technology | Status | License |
|-----------|-----------|--------|---------|
| Graph database | SurrealDB v3.0 | Existing | BSL 1.1 (FOSS after 4yr) |
| Server runtime | Bun (Bun.serve) | Existing | MIT |
| Language | TypeScript | Existing | Apache 2.0 |
| LLM integration | Vercel AI SDK (`ai`) | Existing | Apache 2.0 |
| Schema validation | Zod | Existing | MIT |
| Embedding generation | OpenRouter / Ollama | Existing | N/A (API) |
| Frontend framework | React | Existing | MIT |
| Graph visualization | Reagraph | Existing | Apache 2.0 |
| SSE streaming | Custom (sse-registry.ts) | Existing | N/A (internal) |
| Test framework | Bun test | Existing | MIT |

## Decisions

### No new ORM/query builder
SurrealDB queries are written as raw SurrealQL strings with parameterized inputs, consistent with all existing code. The SDK v2 `RecordId` class is used for type-safe record references.

### No new embedding model
Reuses existing `EMBEDDING_MODEL` and `EMBEDDING_DIMENSION` (1536) configuration. Objective and behavior embeddings use the same pipeline as all other entity types.

### No new LLM model
Observer Agent behavior evaluation reuses existing `OBSERVER_MODEL`. Alignment evaluation during authorization reuses embedding cosine similarity (no LLM call needed -- pure vector math).

### No new caching layer
Behavior score lookups are single-row indexed queries (workspace + identity + metric_type, DESC LIMIT 1). Sub-millisecond on SurrealDB. No Redis/memcache needed.

### No new background job system
Observer graph scan already runs as a triggered endpoint (`POST /api/workspaces/:workspaceId/observer/scan`). Behavior telemetry collection and coherence auditing extend the existing scan pipeline. Background work tracked via `deps.inflight.track()`.
