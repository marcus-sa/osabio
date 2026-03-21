# US-EMB-004: Proxy Context Injection Without Embeddings -- Acceptance Scenarios

Traces: US-EMB-004, JS2 (Inject Relevant Context into Coding Agent Sessions)

Driving port: `POST /proxy/llm/anthropic/v1/messages`
Infrastructure: `acceptance-test-kit.ts` + `llm-proxy-test-kit.ts` (existing)
Test file: `tests/acceptance/remove-embeddings/proxy-context-bm25.test.ts`

---

## Scenario 4.1: Proxy injects workspace decisions ranked by BM25 relevance and recency

@walking_skeleton

```gherkin
Given workspace "Acme Corp" has project "Auth Service"
And the project has decision "Use OAuth 2.1 for all external APIs" updated 2 hours ago
And the project has decision "Use session cookies for internal services" updated 30 days ago
When a proxy message about "implementing OAuth flow" is processed
Then the recent decision is ranked higher than the older decision
And both decisions are injected into the system prompt within token budget
And no embedding API call was made
```

**Implementation notes**:
- Seed decisions with different `updated_at` timestamps via `seedConfirmedDecision`
- Send proxy request via `sendProxyRequestWithIntelligence`
- Verify via trace metadata: `brain_context_injected: true`, `brain_context_decisions >= 2`
- BM25 matches "OAuth" in both decisions, recency weighting boosts the recent one

---

## Scenario 4.2: Recent changes classified by time instead of similarity

```gherkin
Given a decision "Switch to tRPC" was updated 10 minutes ago in project "Platform"
And a task "Migrate billing API" was updated 2 hours ago in project "Platform"
When the proxy processes a message in project "Platform"
Then "Switch to tRPC" is classified as urgent-context
And "Migrate billing API" is classified as context-update
```

**Implementation notes**:
- Time-based classification replaces `classifyBySimilarity`
- Thresholds: < 30 minutes = urgent-context, < 24 hours = context-update, else = background
- No cosine similarity computation

---

## Scenario 4.3: Cross-project context included with lower ranking

```gherkin
Given workspace "Acme Corp" has project "API Gateway"
And project "Platform Standards" has decision "Deprecate REST in favor of tRPC"
When the proxy processes a message about "implementing REST endpoint" in project "API Gateway"
Then the cross-project decision "Deprecate REST in favor of tRPC" is included in context
And it is ranked lower than same-project items
```

**Implementation notes**:
- BM25 matches "REST" across projects
- Graph proximity boost applied to same-project items
- Cross-project items included but demoted in ranking

---

## Scenario 4.4: No matching context results in clean pass-through

```gherkin
Given workspace "Acme Corp" has no decisions, learnings, or observations matching "CSS parser unit tests"
When the proxy processes a message about "writing unit tests for the CSS parser"
Then no brain-context block is injected into the system prompt
And the original system prompt is passed through unchanged
And the response completes successfully
```

**Implementation notes**:
- BM25 returns zero results across all entity types
- Trace metadata shows `brain_context_injected: false` or absent
- Validates fail-open: empty results are not an error

---

## Scenario 4.5: Context injection works without embedding API configured

```gherkin
Given EMBEDDING_MODEL is not configured for the server
And workspace "Acme Corp" has confirmed decisions and active learnings
When the proxy processes a message
Then context injection runs using BM25 search
And the response includes injected context
And no embedding-related errors appear
```

**Implementation notes**:
- Use `configOverrides` to omit embedding config from ServerConfig
- This is a regression test: proves the proxy path has no residual embedding dependency
- May require Phase 1 changes to remove embedding from ServerDependencies first

---

## Scenario 4.6: Token budget selection unchanged after migration

```gherkin
Given workspace "Acme Corp" has 20 confirmed decisions
And the context injection token budget is 2000 tokens
When the proxy processes a message matching 15 of those decisions
Then the injected context fits within the 2000 token budget
And higher-ranked decisions are included over lower-ranked ones
```

**Implementation notes**:
- `selectWithinBudget` pure function is unchanged -- only ranking input changes
- Assert `brain_context_tokens_est` in trace metadata is <= 2000
- Validates that the selection pipeline works correctly with BM25 scores as input
