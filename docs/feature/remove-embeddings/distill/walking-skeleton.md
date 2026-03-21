# Walking Skeleton: Remove Embeddings

## Skeleton Selection Rationale

Each skeleton answers "can a user accomplish their goal?" through the system's driving ports,
exercising the full path from request to observable outcome without touching internal components directly.

## Skeleton 1: Chat Agent Finds Entities via BM25 (US-EMB-001)

**User goal**: A user asks the chat agent about workspace entities and gets relevant results.

**Observable outcome**: The chat agent search tool returns matching entities ranked by relevance, with no external embedding API call.

**Driving port**: `search_entities` chat tool (invoked via chat agent tool execution)

**Why this is the skeleton**: This is the highest-traffic consumer of embeddings. Proving BM25 search works end-to-end through the chat tool validates the core replacement pattern that all other stories depend on.

```
Given workspace "Acme Corp" has a decision "Standardize all APIs on tRPC"
And the workspace has a task "Migrate billing API to tRPC"
When the chat agent searches for "tRPC migration"
Then the search returns results including both entities
And no embedding API call was made during the search
```

**End-to-end path exercised**:
1. Search query enters via chat tool input
2. BM25 fulltext query executes against SurrealDB indexes
3. Results ranked by BM25 score
4. Neighbor enrichment via graph traversal
5. Results returned to chat agent

---

## Skeleton 2: Collision Detection Blocks Duplicate Learning via BM25 (US-EMB-002)

**User goal**: The Observer agent proposes a learning, and the system correctly detects it as a near-duplicate of a dismissed learning.

**Observable outcome**: The proposal is blocked with reason "dismissed_similarity", with no embedding API call.

**Driving port**: `POST /api/workspaces/:workspaceId/learnings` (HTTP create with collision check)

**Why this is the skeleton**: Collision detection is the most complex embedding consumer (two-step KNN + brute-force fallback). Proving BM25 handles the dismissed re-suggestion gate validates the replacement for the hardest case.

```
Given workspace "Acme Corp" has a dismissed learning "Always run integration tests before merging PRs"
When a learning is proposed with text "Always run integration tests before merging pull requests"
Then the proposal is blocked with reason "dismissed_similarity"
And no embedding API call was made
```

**End-to-end path exercised**:
1. Learning creation request via HTTP
2. BM25 search against dismissed learnings
3. Score threshold evaluation
4. Collision result returned in response

---

## Skeleton 3: Intent Alignment via Graph Traversal (US-EMB-003)

**User goal**: The Authorizer evaluates whether an intent aligns with organizational objectives, using graph paths instead of embedding similarity.

**Observable outcome**: An intent referencing a task linked to a project with an objective is classified as "matched", and a `supports` edge is created.

**Driving port**: Alignment evaluation pipeline (invoked via DB seeding + graph query verification)

**Why this is the skeleton**: This validates the graph-traversal replacement strategy -- a fundamentally different approach from BM25, proving that structured graph paths can replace probabilistic similarity.

```
Given workspace "Acme Corp" has an active objective "Improve platform reliability"
And the objective is linked to project "Infrastructure"
And the project has task "Implement rate limiting"
When the alignment evaluator processes an intent referencing task "Implement rate limiting"
Then the alignment classification is "matched"
And a supports edge is created between intent and objective
And no embedding API call was made
```

**End-to-end path exercised**:
1. Intent resolves to task
2. Graph traversal: task -> belongs_to -> project <- has_objective <- objective
3. Classification computed from graph path (matched/ambiguous/none)
4. Supports edge created

---

## Implementation Sequence

Enable one skeleton at a time, in this order:

1. **Skeleton 1** (Chat Agent BM25 Search) -- establishes the BM25 pattern
2. **Skeleton 2** (Collision Detection BM25) -- extends BM25 to a different domain
3. **Skeleton 3** (Graph-Based Alignment) -- validates the graph traversal strategy

After all three skeletons pass, proceed to focused scenarios for each user story.

## Skeleton Litmus Test

Each skeleton was validated against:
- **Demo-able?** Yes -- each can be demonstrated to a stakeholder as "the system does X without calling the embedding API"
- **User goal?** Yes -- each answers a real user need (search, dedup, alignment)
- **Observable outcome?** Yes -- each produces a verifiable result (search results, collision block, supports edge)
- **E2E?** Yes -- each exercises the full path from driving port to SurrealDB and back
