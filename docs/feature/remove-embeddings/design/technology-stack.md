# Technology Stack: Remove Embeddings

## What Stays (Unchanged)

| Technology | Version | Purpose | License |
|-----------|---------|---------|---------|
| SurrealDB | v3.0 | Graph database + BM25 engine | BSL 1.1 |
| Bun | >= 1.3 | Runtime + HTTP server | MIT |
| TypeScript | 5.x | Application language | Apache 2.0 |
| Vercel AI SDK | latest | LLM integration (chat, extraction) | Apache 2.0 |
| OpenRouter / Ollama | - | LLM providers | MIT (ollama-ai-provider) |

## What Changes

### Removed

| Technology | Was Used For | Replacement |
|-----------|-------------|-------------|
| OpenRouter `textEmbeddingModel` | Vector embedding generation | Removed -- no embeddings |
| Ollama `embedding()` | Vector embedding generation | Removed -- no embeddings |
| HNSW indexes (18 total) | Approximate nearest neighbor search | BM25 fulltext indexes |
| `embed()` from `ai` SDK | Embedding API calls | Removed |

### Leveraged (Existing, Now Primary)

| Technology | Current Use | Expanded Use |
|-----------|------------|--------------|
| SurrealDB BM25 | UI entity search only (`entity-search-route.ts`) | All search: chat, collision, proxy context, alignment fallback |
| SurrealDB `entity_search` analyzer | UI search tokenization | All fulltext search (snowball(english), lowercase, blank/class/camel/punct tokenizers) |
| SurrealDB graph traversal | Entity neighbors, project status | Objective-intent alignment (primary path) |
| `fn::entity_edges` | Neighbor enrichment | Unchanged |

### New BM25 Indexes Required

| Index | Table | Field | Migration |
|-------|-------|-------|-----------|
| `idx_learning_text_fulltext` | `learning` | `text` | New (0062) |
| `idx_policy_description_fulltext` | `policy` | `description` | New (0062) |

Already existing fulltext indexes (from migrations 0002, 0008, 0034):
- `idx_task_fulltext` on `task.title`
- `idx_decision_fulltext` on `decision.summary`
- `idx_question_fulltext` on `question.text`
- `idx_observation_fulltext` on `observation.text`
- `idx_feature_fulltext` on `feature.name`
- `idx_project_fulltext` on `project.name`
- `idx_person_fulltext` on `person.name`
- `idx_message_fulltext` on `message.text`
- `idx_suggestion_fulltext` on `suggestion.text`
- `idx_objective_fulltext` on `objective.title`

## Configuration Changes

### Removed Environment Variables

| Variable | Current | After |
|----------|---------|-------|
| `EMBEDDING_MODEL` | Required | Removed |
| `EMBEDDING_DIMENSION` | Required | Removed |

### Removed from `ServerConfig`

| Field | Type | After |
|-------|------|-------|
| `embeddingModelId` | `string` | Removed |
| `embeddingDimension` | `number` | Removed |

### Removed from `ServerDependencies`

| Field | Type | After |
|-------|------|-------|
| `embeddingModel` | `any` | Removed |

## SurrealDB BM25 Constraints (Critical)

These constraints are documented in CLAUDE.md and affect all BM25 usage:

1. **`@N@` operator does not work with SDK bound parameters** -- search term must be embedded as escaped string literal in the query. Pattern: `escapeSearchQuery(query)` then interpolate.

2. **`search::score()` does not work inside `DEFINE FUNCTION`** -- all BM25 queries must run from the app layer, not as SurrealDB stored functions.

3. **`BM25` without explicit parameters returns score=0** -- always use `BM25(1.2, 0.75)`.

4. **`DEFINE ANALYZER` cannot run inside a transaction** -- place before `BEGIN TRANSACTION` block in migrations. (Not applicable here -- analyzer already exists.)

## Decision Rationale

### Why BM25 over alternative search approaches

| Alternative | Why Rejected |
|-------------|-------------|
| Keep embeddings, optimize | Doesn't address root cause (external API dependency, 60s timeouts, CI failures). HNSW+WHERE bug requires workaround. 1536-dim arrays in memory. |
| Meilisearch / Typesense | External dependency. SurrealDB already has BM25. Adds operational complexity for marginal benefit. |
| pg_trgm trigram search | Would require PostgreSQL. SurrealDB is the database. |
| LLM-based search | 2-8s latency per query. Cost scales with query volume. Overkill for structured knowledge graph with consistent vocabulary. |

### Why graph traversal for alignment over alternatives

| Alternative | Why Rejected |
|-------------|-------------|
| Keep embedding similarity | Unreliable for cross-vocabulary matching ("rate limiting" vs "platform reliability"). External API dependency. |
| LLM classification | 2-8s in authorization hot path. Violates 200ms requirement. |
| Keyword/tag matching | Manual maintenance. Brittle to phrasing variation. |
