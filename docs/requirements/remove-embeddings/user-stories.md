# User Stories: Remove Embeddings from Osabio Knowledge Graph

## US-EMB-001: Chat Agent BM25 Entity Search

### Problem
The chat agent (operated by Osabio's AI orchestration layer) needs to find entities matching a user's natural language query. Currently it calls an external embedding API (60s timeout), loads 120+ candidates with full 1536-dimension embedding arrays into JS memory, and computes cosine similarity in-process. This causes CI test failures from embedding timeouts, adds seconds of latency to every search, and creates a hard dependency on an external API for a core operation.

### Who
- Chat agent | Handling a user query about workspace entities | Needs fast, reliable search to provide contextual answers

### Solution
Replace `searchEntitiesByEmbedding` with BM25 fulltext search, reusing the proven pattern from `entity-search-route.ts`. The search runs entirely in-database using SurrealDB's BM25 engine with the existing `entity_search` analyzer (snowball stemmer + lowercase).

### Domain Examples

#### 1: Happy Path -- Maria Santos searches for authentication decisions
Maria Santos asks the chat agent "what decisions have we made about authentication?" The chat agent calls `search_entities` with query "authentication decisions" and kinds ["decision"]. BM25 search matches the decision "Standardize on OAuth 2.1 for authentication" via the stemmer matching "authentication." Results return in <100ms with no external API call.

#### 2: Edge Case -- Carlos Rivera searches with stemmed variation
Carlos Rivera asks "what tasks are related to implementing rate limits?" The search query "implementing rate limits" matches task "Implement rate limiting for public endpoints" because the snowball stemmer equates "implementing" with "implement" and "limits" with "limiting." The search also matches task "Add rate limit headers to API responses."

#### 3: Error/Boundary -- Empty results for unrelated query
Priya Sharma asks "what about quantum computing?" The BM25 search finds no matches across any entity type. The search returns an empty result set with no error. The chat agent responds that no entities match the query.

#### 4: Scope Filter -- Project-scoped search
Tomoko Nakamura asks "what's the status of auth work in the Platform project?" The search runs with project scope, first resolving project entities via `belongs_to` edges, then running BM25 within that set. Only entities belonging to "Platform" project are returned.

### UAT Scenarios (BDD)

#### Scenario: BM25 search returns relevant entities
Given the workspace "Acme Corp" has a decision "Standardize all APIs on tRPC"
And the workspace has a task "Migrate billing API to tRPC"
When the chat agent searches for "tRPC migration"
Then the search returns at least 2 results
And the results include the decision "Standardize all APIs on tRPC"
And the results include the task "Migrate billing API to tRPC"
And no embedding API call was made during the search

#### Scenario: BM25 stemmer handles word variations
Given the workspace "Acme Corp" has a task "Implementing rate limiting for public endpoints"
When the chat agent searches for "rate limit implementation"
Then the search returns the task "Implementing rate limiting for public endpoints"

#### Scenario: Search filters by entity kind
Given the workspace "Acme Corp" has a decision "Use PostgreSQL for analytics"
And the workspace has a task "Set up PostgreSQL cluster"
When the chat agent searches for "PostgreSQL" with kinds ["decision"]
Then the search returns exactly 1 result
And the result is the decision "Use PostgreSQL for analytics"

#### Scenario: Search returns empty results without error
Given the workspace "Acme Corp" has no entities matching "quantum computing"
When the chat agent searches for "quantum computing"
Then the search returns 0 results
And the response status is successful

#### Scenario: Project-scoped search excludes other projects
Given workspace "Acme Corp" has project "Alpha" with task "Deploy auth service"
And workspace "Acme Corp" has project "Beta" with task "Deploy auth proxy"
When the chat agent searches for "deploy auth" in project "Alpha"
Then the search returns exactly 1 result
And the result is the task "Deploy auth service"

### Acceptance Criteria
- [ ] `search_entities` tool uses BM25 fulltext search instead of embedding-based search
- [ ] No `createEmbeddingVector` call in the search path
- [ ] Search supports kind filtering (project, feature, task, decision, question, suggestion)
- [ ] Search supports project-scope filtering
- [ ] BM25 results are sorted by relevance score descending
- [ ] Search completes without external API dependency
- [ ] Existing neighbor enrichment (listEntityNeighbors) continues to work

### Technical Notes
- Reuse BM25 query pattern from `entity-search-route.ts` (`buildWorkspaceSearchSQL`)
- Requires BM25 fulltext indexes on entity title/summary/text fields (most already exist from migration 0002)
- `embeddingModel` and `embeddingDimension` can be removed from `ChatToolDeps` if no other chat tool uses them
- Tool description should change from "Semantic search" to "Full-text search"
- The `@N@` operator doesn't work with SDK bound parameters -- search term must be embedded as string literal (existing pattern in entity-search-route.ts)

### Dependencies
- BM25 fulltext indexes already exist from migration 0002 for: task (title), decision (summary), question (text), observation (text), suggestion (text), feature (name), project (name), person (name), message (text)
- No new migrations required for this story

---

## US-EMB-002: Learning Collision Detection via BM25

### Problem
The Observer agent proposes learnings from root cause analysis. Before creating a learning, the system checks for duplicates (active learnings covering the same pattern) and re-suggestions (previously dismissed learnings). Currently this requires an embedding API call, two-step KNN on HNSW index (with SurrealDB bug workaround), AND a brute-force fallback that loads ALL learnings with embeddings into memory. The cross-form comparison (observation centroids vs directive learning text) at 0.50 cosine threshold is barely above random chance.

### Who
- Observer agent | Proposing a learning from pattern analysis | Needs reliable duplicate detection without false positives or false negatives

### Solution
Replace embedding-based collision detection with BM25 fulltext search on the `learning` table. Add a BM25 fulltext index on `learning.text`. Use BM25 score thresholds for dismissed re-suggestion blocking and active coverage detection.

### Domain Examples

#### 1: Happy Path -- Near-identical dismissed learning blocked
The Observer proposes "Always run integration tests before merging pull requests." A dismissed learning exists with text "Always run integration tests before merging PRs." BM25 search matches on "integration tests", "merging", with high score. The proposal is blocked with reason "dismissed_similarity."

#### 2: Edge Case -- Genuinely different learning passes
The Observer proposes "Add circuit breaker to payment service external calls." Active learnings include "Enforce code review approval before merge" and "Monitor database connection pool exhaustion." BM25 search finds no high-scoring matches. The proposal passes and is created with status "pending_approval."

#### 3: Error/Boundary -- Coverage check identifies existing active learning
The diagnostic clustering pipeline finds a cluster of 5 observations about "database connection timeout." BM25 search against active learnings finds "Monitor database connection pool exhaustion" with high relevance. The cluster is marked as covered and skipped.

### UAT Scenarios (BDD)

#### Scenario: Dismissed learning blocks re-suggestion
Given the workspace "Acme Corp" has a dismissed learning "Always run integration tests before merging PRs"
When the Observer proposes "Always run integration tests before merging pull requests"
Then the proposal is blocked with reason "dismissed_similarity"
And no embedding API call was made

#### Scenario: Active learning coverage prevents duplicate
Given the workspace "Acme Corp" has an active learning "Enforce code review approval before merge"
When the Observer proposes "Require code review sign-off before merging"
Then the proposal is blocked because active coverage was detected

#### Scenario: New learning passes collision detection
Given the workspace "Acme Corp" has active learning "Enforce code review approval before merge"
And the workspace has dismissed learning "Always run integration tests before merging PRs"
When the Observer proposes "Add circuit breaker to payment service external calls"
Then the proposal passes collision detection
And the learning is created with status "pending_approval"

#### Scenario: Cluster coverage check uses BM25
Given the workspace "Acme Corp" has 5 open observations about "database connection timeout"
And the workspace has an active learning "Monitor database connection pool exhaustion"
When the diagnostic clustering pipeline runs
Then the cluster is marked as covered by the active learning

### Acceptance Criteria
- [ ] `checkDismissedSimilarity` uses BM25 search instead of KNN + brute-force
- [ ] `checkCoverageAgainstActiveLearnings` uses BM25 search instead of KNN + centroid cosine
- [ ] No `createEmbeddingVector` call in the collision detection path
- [ ] No brute-force fallback loading all learnings into memory
- [ ] `suggestLearning` no longer accepts `embedding` parameter
- [ ] New BM25 fulltext index exists on `learning.text` field
- [ ] Near-identical dismissed learnings are blocked
- [ ] Genuinely different learnings pass collision detection

### Technical Notes
- New migration required: `DEFINE INDEX idx_learning_text_fulltext ON learning FIELDS text FULLTEXT ANALYZER entity_search BM25(1.2, 0.75);`
- BM25 score thresholds will differ from cosine similarity thresholds -- need calibration via acceptance tests
- The `@N@` operator limitation (no bound parameters) applies -- use string literal interpolation with escaping
- `learning-diagnosis.ts` clustering still uses `cosineSimilarity` for pairwise observation clustering -- this operates on pre-loaded observation embeddings and should be addressed in Phase 3 (or replaced with a different clustering approach)
- Remove `embedding` field from `CreateLearningInput` and all callers

### Dependencies
- Depends on: New migration for BM25 index on learning.text
- Blocked by: Nothing
- Note: `clusterObservationsBySimilarity` in learning-diagnosis.ts still uses cosine similarity on observation embeddings. This is a separate concern (Phase 3) and does not block this story.

---

## US-EMB-003: Graph-Based Objective-Intent Alignment

### Problem
The Authorizer evaluates whether an intent aligns with organizational objectives by computing cosine similarity between intent and objective embeddings. This requires an embedding API call per authorization, uses the two-step KNN workaround, and produces unreliable results when intent and objective vocabulary differ (e.g., "implement rate limiting" vs "improve platform reliability"). Meanwhile, the knowledge graph already has explicit edges connecting tasks to projects to objectives -- a deterministic, auditable path.

### Who
- Authorizer | Evaluating an intent for strategic alignment | Needs accurate, fast alignment classification without external API dependency

### Solution
Replace embedding-based KNN search with graph path traversal. The intent resolution pipeline already resolves most intents to a task or project. Follow the graph path: task -> belongs_to -> project <- has_objective <- objective. Fall back to BM25 keyword match for intents that don't resolve to a specific entity.

### Domain Examples

#### 1: Happy Path -- Task-level alignment via graph path
The Authorizer evaluates an intent referencing task "Implement rate limiting." Graph traversal finds: task "Implement rate limiting" -> belongs_to -> project "Infrastructure" <- has_objective <- objective "Improve platform reliability." Classification: "matched." A `supports` edge is created.

#### 2: Edge Case -- Free-form intent uses BM25 fallback
An intent with description "fix the flaky CI pipeline that blocks deploys" doesn't resolve to a specific task. BM25 search matches objective "Reduce deployment failures by 50%" via stemmer matching "deploys"/"deployment." Classification: "ambiguous" (BM25 match, not graph path).

#### 3: Error/Boundary -- No alignment found
An intent resolves to project "Marketing Site." No objective is linked to "Marketing Site" via graph edges. BM25 search on the intent description also finds no matching objectives. Classification: "none." A warning observation is created.

### UAT Scenarios (BDD)

#### Scenario: Graph traversal finds alignment via task path
Given workspace "Acme Corp" has an active objective "Improve platform reliability"
And the objective is linked to project "Infrastructure"
And the project has task "Implement rate limiting"
When the Authorizer evaluates an intent referencing task "Implement rate limiting"
Then the alignment classification is "matched"
And a supports edge is created between intent and objective
And no embedding API call was made

#### Scenario: Graph traversal finds alignment via project path
Given workspace "Acme Corp" has an active objective "Launch MVP by Q3"
And the objective is linked to project "Product Launch"
When the Authorizer evaluates an intent that resolves to project "Product Launch"
Then the alignment classification is "matched"

#### Scenario: BM25 fallback for free-form intents
Given workspace "Acme Corp" has an active objective "Reduce deployment failures by 50%"
And an intent has description "fix the flaky CI pipeline that blocks deploys"
And the intent does not resolve to any task or project
When the Authorizer evaluates the intent
Then BM25 search produces a match against the objective
And the alignment classification is "ambiguous"

#### Scenario: No alignment creates warning
Given workspace "Acme Corp" has an active objective "Improve platform reliability"
And the objective is linked to project "Infrastructure"
When the Authorizer evaluates an intent that resolves to project "Marketing Site"
Then the alignment classification is "none"
And a warning observation is created

### Acceptance Criteria
- [ ] `findAlignedObjectivesSurreal` uses graph traversal instead of KNN search
- [ ] Graph path follows: task -> belongs_to -> project <- has_project <- workspace -> has_objective -> objective
- [ ] BM25 fallback search exists for intents not resolvable to task/project
- [ ] No `createEmbeddingVector` call in the alignment path
- [ ] Classification contract unchanged: matched (>= 0.7) / ambiguous (>= 0.5) / none (< 0.5)
- [ ] `supports` edge creation continues to work
- [ ] Warning observation created for unaligned intents
- [ ] ADR-032 superseded with new ADR documenting rationale

### Technical Notes
- The intent resolution pipeline in `intent-context.ts` already resolves to task/project level (steps 1-4 of `resolveContextLevel`). The alignment adapter should receive the resolved level, not re-resolve independently.
- Graph traversal query: `SELECT <-has_objective<-objective FROM project WHERE id = $project AND <-has_objective<-objective.status = "active"`
- BM25 fallback for unresolved intents: search intent description against `objective.title` and `objective.description` fields. Requires BM25 index on objective table (new migration).
- Superseding ADR-032 requires documenting: (1) structured graph > probabilistic similarity for typed data, (2) deterministic alignment is better for governance/audit, (3) embedding API dependency removed.

### Dependencies
- Depends on: Graph edges (has_objective, belongs_to, has_feature, has_task) consistently created when objectives/projects/tasks are linked
- New migration: BM25 fulltext index on `objective.title` and `objective.description`
- ADR: Supersede ADR-032

---

## US-EMB-004: Proxy Context Injection Without Embeddings

### Problem
When a coding agent sends a message through the proxy, Osabio injects relevant decisions, learnings, and observations into the system prompt. Currently this requires an embedding API call (60s timeout) to embed the message, then computes weighted cosine similarity against all candidate embeddings in JS memory. Recent changes detection uses three parallel two-step KNN queries with similarity thresholds (0.4/0.7). This creates latency on every proxied message and a hard dependency on the embedding API for the proxy's core value proposition.

### Who
- Proxy context injector | Processing a proxied coding agent message | Needs to rank context by relevance within token budget without external API dependency

### Solution
Replace cosine-based ranking with BM25 fulltext search combined with recency weighting. Replace similarity-based recent changes classification with time-based + graph-proximity classification. The token budget selection and XML injection pipeline remain unchanged.

### Domain Examples

#### 1: Happy Path -- Recent project decision injected
Carlos Rivera's coding agent sends a message about "implementing OAuth flow." Osabio resolves to project "Auth Service." BM25 search finds decision "Use OAuth 2.1 for all external APIs" (updated 2 hours ago, high BM25 score, same project). Decision is ranked first and injected into system prompt.

#### 2: Edge Case -- Cross-project context via BM25
Priya Sharma works on "API Gateway" project but a relevant decision "Deprecate REST in favor of tRPC" exists in "Platform Standards" project. BM25 matches "API" and scores the decision. It's included in context but ranked lower than same-project items.

#### 3: Error/Boundary -- No relevant context found
A message about "writing unit tests for the CSS parser" finds no BM25 matches in decisions, learnings, or observations. The system prompt is injected without osabio-context. Coding agent works with its built-in context only.

### UAT Scenarios (BDD)

#### Scenario: Context injection ranks by relevance and recency
Given workspace "Acme Corp" has project "Auth Service"
And the project has decision "Use OAuth 2.1 for all external APIs" updated 2 hours ago
And the project has decision "Use session cookies for internal services" updated 30 days ago
When a proxy message about "implementing OAuth flow" is processed
Then the recent decision is ranked higher than the older decision
And both are injected into the system prompt within token budget
And no embedding API call was made

#### Scenario: Recent changes classified by time
Given a decision "Switch to tRPC" was updated 10 minutes ago in project "Platform"
And a task "Migrate billing API" was updated 2 hours ago in project "Platform"
When the proxy processes a message in project "Platform"
Then "Switch to tRPC" is classified as urgent-context
And "Migrate billing API" is classified as context-update

#### Scenario: No context found results in clean injection
Given no decisions, learnings, or observations match the proxy message text
When the proxy processes the message
Then no osabio-context block is injected
And the original system prompt is passed through unchanged

### Acceptance Criteria
- [ ] `rankCandidates` uses BM25 score + recency weight instead of cosine similarity
- [ ] `classifyBySimilarity` replaced with time-based classification
- [ ] `createSearchRecentChanges` uses BM25 + recency instead of KNN
- [ ] No `createEmbeddingVector` call in the proxy context path
- [ ] Token budget selection logic unchanged
- [ ] XML injection pipeline unchanged
- [ ] Context injection telemetry (span attributes) continues to report item counts

### Technical Notes
- Phase 2 story -- depends on Phase 1 completion for confidence
- `context-injector.ts` pure functions (buildOsabioContextXml, injectOsabioContext, selectWithinBudget) are unaffected -- only ranking and classification change
- Recency weighting: multiply BM25 score by decay factor based on time since last update
- Graph proximity: boost items in the same project as the resolved context
- The `SearchRecentChanges` port signature changes: no longer requires `messageEmbedding` parameter

### Dependencies
- Depends on: US-EMB-001 (BM25 search pattern proven in chat agent)
- Depends on: BM25 fulltext indexes on decision, learning, observation tables (already exist)
- The intent-context BM25 fallback (step 6 in journey) is part of this story

---

## US-EMB-005: Drop Embedding Infrastructure

### Problem
After Phases 1 and 2 are complete, the codebase retains 17 HNSW indexes, embedding fields on every entity table, the `embeddings.ts` module, `EMBEDDING_MODEL`/`EMBEDDING_DIMENSION` config, and `embeddingModel`/`embeddingDimension` dependency threading. This dead infrastructure consumes storage, slows writes (HNSW index updates), and creates confusion about what's still used.

### Who
- Osabio platform engineer | Maintaining the codebase after migration | Needs clean infrastructure with no dead code

### Solution
Single migration to drop all HNSW indexes and embedding fields. Remove `embeddings.ts` module. Remove embedding config from `runtime/config.ts`. Remove embedding dependency from `ServerDependencies`.

### Domain Examples

#### 1: Happy Path -- Clean schema after migration
After running migration `NNNN_drop_embedding_infrastructure.surql`, `INFO FOR TABLE task` shows no `embedding` field and no `idx_task_embedding` index. The schema file `surreal-schema.surql` has zero HNSW index definitions.

#### 2: Edge Case -- Server starts without embedding config
The `.env` file has no `EMBEDDING_MODEL` or `EMBEDDING_DIMENSION` variables. `loadServerConfig()` does not require them. The server starts and all endpoints work.

#### 3: Error/Boundary -- Grep finds zero embedding references
Running `grep -r "createEmbeddingVector\|cosineSimilarity\|embeddingModel\|embeddingDimension" app/src/` returns zero results. The `app/src/server/graph/embeddings.ts` file does not exist.

### UAT Scenarios (BDD)

#### Scenario: All HNSW indexes removed
Given Phases 1 and 2 are complete
When the infrastructure removal migration runs
Then INFO FOR TABLE shows no HNSW indexes on any table
And the migration removed all 17 HNSW index definitions

#### Scenario: Embedding fields removed from schema
Given the infrastructure removal migration has run
When querying any entity table
Then no "embedding" field exists in the schema
And existing records have no embedding data

#### Scenario: Server starts without embedding configuration
Given EMBEDDING_MODEL is not in the environment
And EMBEDDING_DIMENSION is not in the environment
When the Osabio server starts
Then startup completes successfully
And no embedding-related warnings or errors appear

#### Scenario: No embedding code remains in codebase
Given all embedding-related code has been removed
Then app/src/server/graph/embeddings.ts does not exist
And no file imports from "graph/embeddings"
And no file references createEmbeddingVector or cosineSimilarity

### Acceptance Criteria
- [ ] All 17 HNSW indexes dropped via migration
- [ ] Embedding fields removed from all entity tables via migration
- [ ] `embeddings.ts` module deleted
- [ ] `EMBEDDING_MODEL` and `EMBEDDING_DIMENSION` removed from config
- [ ] `embeddingModel` and `embeddingDimension` removed from `ServerDependencies`
- [ ] `surreal-schema.surql` updated to remove all embedding field definitions and HNSW indexes
- [ ] Server starts and passes all tests without embedding configuration
- [ ] Zero references to embedding functions in application code

### Technical Notes
- Single migration script with `BEGIN TRANSACTION ... COMMIT TRANSACTION`
- `DEFINE ANALYZER` cannot be in a transaction (SurrealDB v3.0 limitation) -- but we're only removing, not adding
- The `cosineSimilarity` function in `learning-diagnosis.ts` (used for observation clustering) must also be removed or replaced with an alternative clustering strategy
- Consider keeping `cosineSimilarity` as a utility only if observation clustering is migrated to a non-embedding approach in the same phase
- 26 files currently import from `graph/embeddings` -- all must be updated

### Dependencies
- Depends on: US-EMB-001, US-EMB-002, US-EMB-003, US-EMB-004 (all use cases migrated)
- Blocked by: All Phase 1 and Phase 2 stories must be complete and passing
- Note: Observation clustering in `learning-diagnosis.ts` uses `cosineSimilarity` on pre-loaded embeddings. This must be addressed (either replaced with BM25-based clustering or text similarity) before embedding fields can be dropped.
