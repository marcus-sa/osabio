# LLM Proxy Intelligence -- Technology Stack

**Scope**: Technology choices for context injection + contradiction detection.

---

## 1. Reused Technologies (No New Dependencies)

| Technology | Version | License | Used For | Already In |
|---|---|---|---|---|
| **SurrealDB** | v3.0 | BSL 1.1 | Knowledge graph queries, config storage | `schema/surreal-schema.surql` |
| **Vercel AI SDK** (`ai`) | ^4.x | Apache 2.0 | `embed()` for embeddings, `generateObject()` for Tier 2 verification | `app/src/server/graph/embeddings.ts` |
| **Bun** | >=1.3 | MIT | Runtime, `Bun.serve`, `fetch` for upstream relay | `app/server.ts` |
| **TypeScript** | ^5.x | Apache 2.0 | All new modules | Project-wide |
| **surrealdb** (JS SDK) | v2.x | Apache 2.0 | DB client, `RecordId`, query execution | `app/src/server/runtime/dependencies.ts` |

---

## 2. Reused Internal Modules (No New Code Required)

| Module | File | Functions Used |
|---|---|---|
| Embedding Pipeline | `app/src/server/graph/embeddings.ts` | `createEmbeddingVector()`, `cosineSimilarity()` |
| Observation System | `app/src/server/observation/queries.ts` | `createObservation()` |
| Inflight Tracker | `app/src/server/runtime/types.ts` | `deps.inflight.track()` |
| HTTP Observability | `app/src/server/http/observability.ts` | `logInfo()`, `logError()`, `elapsedMs()` |

---

## 3. New Technology Choices

### 3.1 Contradiction Verification Model (Tier 2)

| Choice | Details |
|---|---|
| **Model class** | Haiku-class (cheapest available model with structured output support) |
| **Configuration** | `CONTRADICTION_MODEL` env var, fallback to workspace config, fallback to `EXTRACTION_MODEL` |
| **Access method** | Vercel AI SDK `generateObject()` via existing model client infrastructure |
| **License impact** | None -- uses existing model client plumbing |
| **Cost estimate** | ~$0.001 per Tier 2 check. Expected invocation rate: <5% of proxied responses. |

**Rationale**: The extraction pipeline already uses a Haiku-class model via `EXTRACTION_MODEL`. The contradiction verification prompt is simple (compare two texts, return JSON). Reusing the same model class and SDK eliminates new dependencies.

**Alternatives considered**:
- Dedicated contradiction model endpoint: Unnecessary complexity for a simple binary classification
- Local/Ollama model: Adds operational dependency, latency uncertainty for a task where cloud Haiku is fast enough (~200ms)

### 3.2 In-Memory Cache (Context Cache)

| Choice | Details |
|---|---|
| **Implementation** | Native `Map<string, {data, expiresAt}>` |
| **Why not Redis/external** | Single-process deployment (ADR-040), <10MB footprint, no cross-process sharing needed |
| **Eviction** | TTL check on read. No background timer. |

**Alternatives considered**:
- Redis: Overkill for single-process. Adds operational dependency for <10MB of cache.
- LRU cache library (e.g., `lru-cache`): Adds a dependency for a trivial Map + TTL check. Not justified.

---

## 4. Environment Variables (New)

| Variable | Purpose | Default | Required |
|---|---|---|---|
| `LLM_PROXY_CONTEXT_INJECTION` | Global kill switch for context injection | `true` | No |
| `LLM_PROXY_CONTRADICTION_DETECTION` | Global kill switch for contradiction detection | `true` | No |
| `CONTRADICTION_MODEL` | Model ID for Tier 2 verification | Falls back to `EXTRACTION_MODEL` | No |
| `LLM_PROXY_CONTEXT_TOKEN_BUDGET` | Default token budget for context injection | `1000` | No |

---

## 5. New Production Files (Estimated)

| File | Purpose |
|---|---|
| `app/src/server/proxy/session-id-resolver.ts` | Pure function: extract session ID from request metadata/headers |
| `app/src/server/proxy/context-injector.ts` | Context injection logic |
| `app/src/server/proxy/context-cache.ts` | TTL cache for candidate pools and embeddings |
| `app/src/server/proxy/contradiction-detector.ts` | Two-tier contradiction detection |
| `app/src/server/proxy/intelligence-config.ts` | Config loader with env fallbacks |
| `schema/migrations/0040_proxy_session_id.surql` | agent_session external_session_id field + index |
| `schema/migrations/0041_proxy_intelligence_config.surql` | proxy_intelligence_config table + session_ended EVENT |

7 new files. With 6 roadmap steps, step ratio = 6/7 = 0.86 (well under 2.5 limit).
