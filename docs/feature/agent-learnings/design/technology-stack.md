# Agent Learnings Technology Stack

## No New Technologies Required

Agent Learnings is implemented entirely within Osabio's existing technology stack. No new dependencies, services, or infrastructure components are introduced.

| Concern | Technology | License | Rationale |
|---|---|---|---|
| Persistence | SurrealDB (existing) | BSL 1.1 | Already in use. SCHEMAFULL table, HNSW index for embeddings, TYPE RELATION for evidence edges. |
| Vector similarity | SurrealDB HNSW + cosine (existing) | BSL 1.1 | Collision detection and precedent relevance use existing vector infrastructure. Two-step KNN pattern per codebase constraint. |
| Embedding generation | Existing embedding model via AI SDK (existing) | N/A | Same `createEmbeddingVector()` used by observation, suggestion, entity embeddings. |
| LLM reasoning | Existing extraction/observer model via AI SDK (existing) | N/A | Pattern detection reuses existing model wiring. No new model dependency. |
| HTTP layer | Bun.serve (existing) | MIT | New route handlers registered in `start-server.ts`, same pattern as feed, entity, observer routes. |
| Token estimation | Word-count heuristic (new, zero-dependency) | N/A | ~500 token budget estimated as ~375 words. No tokenizer library needed -- precision not critical for prompt budget. |
| Type contracts | TypeScript (existing) | Apache-2.0 | Shared types in `contracts.ts`, internal types in `learning/types.ts`. |

## Decision: Word-Count Heuristic over Tokenizer Library

See ADR-026 for full rationale. Summary: exact tokenization adds a dependency (tiktoken, ~2MB WASM) for marginal precision improvement on a soft budget. Word-count heuristic (1 word ~= 1.33 tokens) is sufficient for the ~500 token learning injection budget.

## Decision: New Table over Extending Suggestion Table

See ADR-027 for full rationale. Summary: learnings have a fundamentally different lifecycle (active/superseded/deactivated vs pending/accepted/dismissed/converted), different schema (target_agents, learning_type, priority), and different consumption pattern (JIT prompt injection vs feed card governance). Extending suggestion would require discriminated union fields and complex status machinery.

## Reuse Analysis

| Existing Component | Reuse | Justification |
|---|---|---|
| `observation/queries.ts` pattern | Pattern reuse | Learning queries follow same workspace-scoped CRUD pattern |
| `suggestion/queries.ts` pattern | Pattern reuse | Status transition pattern (validate workspace scope, update status, set timestamp) |
| `graph/embeddings.ts` | Direct reuse | `createEmbeddingVector()` for learning embeddings |
| `feed/feed-queries.ts` pattern | Pattern reuse | Pending learning query + feed item mapper |
| `feed/feed-route.ts` pattern | Extension | Add pending learnings to existing review tier |
| `entities/entity-actions-route.ts` pattern | Pattern reuse | Learning action handler follows same action dispatch pattern |
| `shared/contracts.ts` | Extension | Add learning types to existing contracts |
| `chat/context.ts` | Extension | Add learnings to ChatContext and buildSystemPrompt |
| `agents/pm/prompt.ts` | Extension | Add learnings section |
| `agents/observer/prompt.ts` | Extension | Add learnings section |
| `mcp/context-builder.ts` | Extension | Add learnings to context packets |
