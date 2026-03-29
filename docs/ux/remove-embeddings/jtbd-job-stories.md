# JTBD Analysis: Remove Embeddings from Osabio Knowledge Graph

## Job Classification

**Job Type**: Complex Refactoring (Job 3)
**Workflow**: `[research] -> discuss -> baseline -> roadmap -> split -> execute -> review`
**Rationale**: Code works but structure needs improvement. Embeddings function correctly but impose disproportionate cost (latency, complexity, CI fragility) for marginal value in a structured, typed knowledge graph with explicit relationships.

---

## Job Story 1: Find Relevant Entities by Intent

**When** a chat agent receives a user query like "what decisions have we made about authentication",
**I want to** find the most relevant entities across the knowledge graph,
**so I can** provide accurate, contextual answers without the user needing to know exact entity names or IDs.

### Functional Job
Retrieve entities semantically related to a natural language query, ranked by relevance.

### Emotional Job
Feel confident that search results are comprehensive and relevant -- not missing important entities or surfacing noise.

### Social Job
Be perceived as a capable assistant that understands what the user is asking about, not a keyword-matching robot.

### Forces Analysis
- **Push**: `searchEntitiesByEmbedding` loads 120+ candidates with full embedding arrays into JS memory, computes cosine similarity in-process. Does NOT use HNSW index at all. Each search requires an embedding API call (60s timeout). CI tests fail intermittently due to embedding timeouts.
- **Pull**: BM25 fulltext search already exists across 9 entity types in `entity-search-route.ts`. It runs entirely in-database, returns in milliseconds, handles stemming and tokenization natively via SurrealDB analyzers.
- **Anxiety**: BM25 is keyword-based -- will it miss semantically related entities that share no keywords? (e.g., "auth" matching "authentication", "login", "credential management")
- **Habit**: The chat agent tool description says "Semantic search across the knowledge graph." Agents may have learned to rely on fuzzy semantic matching.

### Assessment
- Switch likelihood: **High**
- Key blocker: Anxiety about semantic gap (mitigated by SurrealDB's snowball stemmer + synonym patterns in structured data)
- Key enabler: BM25 already proven in production for UI search
- Design implication: BM25 search must cover same entity types as current embedding search. Stemming analyzer handles most semantic equivalences in domain vocabulary.

---

## Job Story 2: Inject Relevant Context into Coding Agent Sessions

**When** a coding agent starts a new session and sends its first message through the proxy,
**I want to** inject the most relevant decisions, learnings, and observations into the system prompt,
**so I can** work with full awareness of project context without the developer needing to manually copy-paste decisions.

### Functional Job
Rank workspace decisions, learnings, and observations by relevance to the current coding task, select within token budget, inject into system prompt.

### Emotional Job
Feel confident that the coding agent has the right context -- not overwhelmed by irrelevant noise, not missing critical decisions.

### Social Job
Demonstrate to the developer that Osabio adds value by surfacing the right context at the right time.

### Forces Analysis
- **Push**: Context injection requires embedding the proxy message (60s timeout, N+1 API call per request). Uses two-step KNN workaround for SurrealDB bug. Recent changes classification uses cosine similarity thresholds (0.4/0.7) on pre-computed embeddings.
- **Pull**: Recent changes could use recency + graph proximity (decisions/tasks recently updated in the same project). Static context (decisions, learnings) could be loaded by graph traversal from the resolved project/task. Token budget selection is independent of ranking method.
- **Anxiety**: This is the medium-confidence replacement. Semantic similarity genuinely helps when a coding task description doesn't share vocabulary with relevant decisions. Graph traversal may miss cross-project relevance.
- **Habit**: The weighted cosine similarity ranking feels sophisticated. Replacing it with graph-based ranking may feel like a downgrade.

### Assessment
- Switch likelihood: **Medium**
- Key blocker: Cross-project context relevance without shared vocabulary
- Key enabler: Intent context resolution already has 4 fallback strategies (explicit refs, single-project shortcut, vector search, path matching). Vector search is step 3 of 4 -- other strategies handle most cases.
- Design implication: Phase 2 migration. Needs BM25 as fallback for the intent-context vector search step. Recent changes classification needs time-based + graph-based alternative.

---

## Job Story 3: Detect Duplicate or Previously Dismissed Learnings

**When** the Observer agent proposes a new learning from root cause analysis,
**I want to** check whether a similar learning already exists (active or dismissed),
**so I can** avoid re-proposing learnings the human already rejected or that duplicate existing behavioral rules.

### Functional Job
Compare a proposed learning's text against existing learnings to detect near-duplicates (active coverage at 0.50 threshold, dismissed re-suggestion at 0.85 threshold).

### Emotional Job
Feel confident that the collision detection is reliable -- not blocking genuinely new insights, not allowing spam of previously rejected proposals.

### Social Job
Be perceived as a learning system that respects human decisions (dismissals stick) and doesn't waste attention with duplicates.

### Forces Analysis
- **Push**: Collision detection uses two-step KNN (HNSW bug workaround) with brute-force fallback that loads ALL dismissed/active learnings with embeddings into memory. Each learning proposal generates an embedding API call. Cross-form comparison (observation centroids vs learning text) produces unreliable similarity scores, requiring lower thresholds (0.50 vs typical 0.85).
- **Pull**: BM25 fulltext search with scoring can find text-similar learnings efficiently. For the dismissed re-suggestion gate (0.85 threshold), BM25 with high score threshold is a strong match -- near-identical text produces high BM25 scores. For coverage check (0.50 threshold), the current approach is already unreliable due to cross-form text comparison.
- **Anxiety**: Will BM25 miss learnings that use different words for the same concept? (e.g., "enforce code review" vs "require PR approval")
- **Habit**: The dual KNN + brute-force fallback pattern is deeply embedded in the codebase.

### Assessment
- Switch likelihood: **High**
- Key blocker: Synonym-level collision detection (mitigated by snowball stemmer + the fact that learnings are short, directive text -- vocabulary overlap is high for true duplicates)
- Key enabler: The dismissed re-suggestion gate (0.85 threshold) is essentially near-exact text matching, which BM25 handles natively. The coverage check (0.50 threshold) is already unreliable and could be replaced with LLM classification.
- Design implication: Two-tier replacement. BM25 pre-filter for candidate retrieval, then LLM classification for nuanced semantic comparison where needed.

---

## Job Story 4: Align Intents with Strategic Objectives

**When** the Authorizer evaluates an intent for authorization,
**I want to** determine whether the intended action aligns with any active organizational objective,
**so I can** flag unaligned work and create `supports` edges for aligned intents.

### Functional Job
Compare an intent's embedding against all active objective embeddings, classify as matched (>=0.7), ambiguous (>=0.5), or none (<0.5).

### Emotional Job
Feel confident that the alignment check is meaningful -- not rubber-stamping everything as "aligned" or blocking legitimate work as "unaligned."

### Social Job
Demonstrate to the organization that agent work is governed and directed toward strategic goals.

### Forces Analysis
- **Push**: Pure cosine similarity between intent and objective embeddings is a weak signal. An intent like "implement rate limiting" and an objective like "improve platform reliability" share no vocabulary but are clearly aligned. The embedding similarity score is unreliable for this cross-domain comparison. Each intent authorization requires an embedding API call.
- **Pull**: Graph traversal is strictly more accurate: intent -> task -> feature -> project -> objective. The graph already has `belongs_to`, `has_feature`, `has_task` edges. If the intent references a task, the alignment is deterministic via graph path, not probabilistic via embedding similarity.
- **Anxiety**: What about intents that don't reference a specific task? (Free-form intents without explicit entity references.)
- **Habit**: ADR-032 explicitly chose embedding similarity for this. Reversing an ADR requires clear justification.

### Assessment
- Switch likelihood: **High**
- Key blocker: Free-form intents without task references (mitigated by the intent resolution pipeline which already resolves to task/project level before authorization)
- Key enabler: Graph traversal produces deterministic, auditable alignment -- not a probabilistic score. This is strictly better for governance.
- Design implication: Replace with graph path traversal. For intents that resolve to a task/project, traverse `task->belongs_to->project<-has_project<-workspace->has_objective->objective`. Fall back to BM25 keyword match for unresolved intents.

---

## Opportunity Scoring

| # | Outcome Statement | Imp. (%) | Sat. (%) | Score | Priority |
|---|-------------------|----------|----------|-------|----------|
| 1 | Minimize the time to return entity search results to the chat agent | 90 | 25 | 15.5 | Extremely Underserved |
| 2 | Minimize the likelihood of CI test failures caused by embedding timeouts | 95 | 20 | 16.5 | Extremely Underserved |
| 3 | Minimize the number of external API calls per user message | 85 | 30 | 13.5 | Underserved |
| 4 | Minimize the likelihood of undetected duplicate learning proposals | 80 | 45 | 11.5 | Appropriately Served |
| 5 | Maximize the accuracy of intent-objective alignment classification | 85 | 35 | 13.5 | Underserved |
| 6 | Minimize the time to inject context into coding agent sessions | 80 | 40 | 12.0 | Underserved |
| 7 | Minimize the operational cost of maintaining HNSW indexes across 18 tables | 75 | 30 | 12.0 | Underserved |
| 8 | Minimize the likelihood of proxy context injection missing critical decisions | 70 | 50 | 9.0 | Overserved |

### Scoring Method
- Source: Team estimates based on codebase audit + CI failure analysis
- Sample: Internal team (N=3 engineers)
- Confidence: Medium (team estimates, not user interviews)

### Top Opportunities (Score >= 12)
1. CI test failures from embedding timeouts (16.5) -- Phase 1: eliminate embedding dependency from search + collision detection
2. Entity search latency (15.5) -- Phase 1: replace with BM25
3. External API calls per message (13.5) -- Phase 1+2: remove 16 embedding generation call sites
4. Intent-objective alignment accuracy (13.5) -- Phase 1: replace with graph traversal
5. Context injection latency (12.0) -- Phase 2: replace proxy embedding with BM25/graph
6. HNSW index operational cost (12.0) -- Phase 3: drop indexes after migration

### Overserved Areas (Score < 10)
1. Proxy context missing critical decisions (9.0) -- Current system over-invests in semantic ranking when recency + graph proximity would suffice

---

## Cross-Cutting Observations

### Embedding Infrastructure Cost Summary
- **17 HNSW indexes** consuming storage and rebuild time on every write
- **16 call sites** generating embeddings on entity creation (N+1 per message)
- **60-second timeout** recently increased from 30s due to CI failures
- **In-memory cosine computation** loading 120+ full embedding arrays for search
- **Two-step KNN workaround** required everywhere due to SurrealDB v3.0 bug
- **Brute-force fallbacks** loading all embeddings when HNSW hasn't indexed recent inserts

### What Already Works Without Embeddings
- UI entity search (BM25, 9 entity types, migration 0002)
- Explicit entity reference parsing in intent context
- Single-project shortcut in intent context
- Path-to-project matching in intent context
- Graph traversal for entity neighbors
- Graph traversal for project status aggregation
