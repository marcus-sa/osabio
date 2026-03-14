# Technology Stack: Dynamic Behavior Definitions

## Principle

Brownfield feature -- reuse existing stack. No new runtime dependencies.

## Stack Decisions

| Layer | Technology | Version | License | Rationale |
|-------|-----------|---------|---------|-----------|
| Database | SurrealDB | Existing | BSL 1.1 | Already in use. SCHEMAFULL tables, graph edges, HNSW indexes. No alternative needed. |
| Backend Runtime | Bun | Existing | MIT | Already in use. Server entrypoint, test runner, bundler. |
| Backend Language | TypeScript | Existing | Apache 2.0 | Already in use. Functional paradigm via pure functions + pipeline composition. |
| LLM Integration | Vercel AI SDK | Existing | Apache 2.0 | Already in use for Observer, PM Agent, Extraction. `generateObject` for structured scoring output. |
| LLM Model | OpenRouter (Haiku-class) | Existing | N/A (API) | Same provider. Scorer Agent uses lightweight model for cost efficiency. Configurable via `SCORER_MODEL` env var. |
| Frontend Framework | React | Existing | MIT | Already in use for Learning Library, Feed, Graph View. |
| HTTP Server | Bun.serve | Existing | MIT | Already in use. No framework overhead. |
| Embedding | OpenRouter embedding model | Existing | N/A (API) | Already in use. No new embedding pipeline needed -- behavior_definition does not require embeddings initially. |

## New Environment Variable

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `SCORER_MODEL` | No | Falls back to `EXTRACTION_MODEL` | LLM model for Scorer Agent. Haiku-class recommended for cost. |

## Rejected Alternatives

### Alternative: Dedicated scorer microservice
- **What**: Separate process/container for LLM scoring
- **Why rejected**: Team <10, single deployment, no independent scaling need. Adds operational complexity (networking, health checks, deployment coordination) with no benefit. Modular monolith with function boundaries is sufficient.

### Alternative: Event-driven scorer via SurrealDB DEFINE EVENT
- **What**: SurrealDB event triggers scorer on behavior record creation
- **Why rejected**: SurrealDB events have timing issues (event fires before write is visible -- documented in CLAUDE.md). HTTP webhook from event to scorer adds latency and failure modes. Direct function call within the same process is simpler and more reliable.

### Alternative: Redis/BullMQ for retry queue
- **What**: External job queue for scorer retries
- **Why rejected**: Adds infrastructure dependency. In-process retry with `Promise.allSettled` and `setTimeout` is sufficient for the expected volume (single-digit concurrent scoring requests). If volume grows, this decision can be revisited (ADR-supersede pattern).
