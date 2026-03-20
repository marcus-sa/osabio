# US-EMB-001: Chat Agent BM25 Entity Search -- Acceptance Scenarios

Traces: US-EMB-001, JS1 (Find Relevant Entities by Intent)

Driving port: `search_entities` chat tool
Infrastructure: `acceptance-test-kit.ts` + new `remove-embeddings-test-kit.ts`
Test file: `tests/acceptance/remove-embeddings/chat-bm25-search.test.ts`

---

## Scenario 1.1: Chat agent finds entities by keyword via BM25

@walking_skeleton

```gherkin
Given workspace "Acme Corp" has a decision "Standardize all APIs on tRPC"
And the workspace has a task "Migrate billing API to tRPC"
When the chat agent searches for "tRPC migration"
Then the search returns at least 2 results
And the results include the decision "Standardize all APIs on tRPC"
And the results include the task "Migrate billing API to tRPC"
And no embedding API call was made during the search
```

**Implementation notes**:
- Seed decision and task via `createDecisionDirectly` and SurrealDB CREATE for task
- Invoke `search_entities` tool execute function with mock tool context
- Assert results contain both entities by checking `name` field
- Assert no embedding: verify `createEmbeddingVector` was not called (no embedding field on search result, or spy/mock)

---

## Scenario 1.2: BM25 stemmer matches word variations

```gherkin
Given workspace "Acme Corp" has a task "Implementing rate limiting for public endpoints"
When the chat agent searches for "rate limit implementation"
Then the search returns the task "Implementing rate limiting for public endpoints"
```

**Implementation notes**:
- SurrealDB snowball(english) stemmer equates "implementing" / "implementation" and "limiting" / "limit"
- Validates that BM25 analyzer handles morphological variants without embeddings

---

## Scenario 1.3: Search filters results by entity kind

```gherkin
Given workspace "Acme Corp" has a decision "Use PostgreSQL for analytics"
And the workspace has a task "Set up PostgreSQL cluster"
When the chat agent searches for "PostgreSQL" with kinds ["decision"]
Then the search returns exactly 1 result
And the result is the decision "Use PostgreSQL for analytics"
```

**Implementation notes**:
- Pass `kinds: ["decision"]` to tool input
- BM25 query should only run against the decision table when kind filter is active

---

## Scenario 1.4: Project-scoped search excludes other projects

```gherkin
Given workspace "Acme Corp" has project "Alpha" with task "Deploy auth service"
And workspace "Acme Corp" has project "Beta" with task "Deploy auth proxy"
When the chat agent searches for "deploy auth" in project "Alpha"
Then the search returns exactly 1 result
And the result is the task "Deploy auth service"
```

**Implementation notes**:
- Seed two projects with tasks linked via `belongs_to` edges
- Pass `project: "Alpha"` to tool input
- Verify project scoping uses `belongs_to` graph edges, not workspace-wide search

---

## Scenario 1.5: Search returns empty results without error

```gherkin
Given workspace "Acme Corp" has no entities matching "quantum computing"
When the chat agent searches for "quantum computing"
Then the search returns 0 results
And the search completes successfully without error
```

**Implementation notes**:
- Seed workspace with unrelated entities only
- Assert empty results array, no thrown exception

---

## Scenario 1.6: Search with special characters does not cause errors

```gherkin
Given workspace "Acme Corp" has a task "Fix the user's login flow"
When the chat agent searches for "user's login"
Then the search does not throw an error
And the search returns the task "Fix the user's login flow"
```

**Implementation notes**:
- The `@N@` operator requires string literal interpolation
- Single quotes in search terms must be escaped via `escapeSearchQuery`
- This tests the boundary condition of SQL injection prevention

---

## Scenario 1.7: Search results include neighbor enrichment

```gherkin
Given workspace "Acme Corp" has a decision "Use OAuth 2.1 for authentication"
And the decision belongs to project "Auth Service"
When the chat agent searches for "OAuth authentication"
Then the search returns the decision "Use OAuth 2.1 for authentication"
And the result includes related entities showing project "Auth Service"
```

**Implementation notes**:
- Seed decision + project + belongs_to edge
- Assert `related` array in result contains the project neighbor
- Validates that `listEntityNeighbors` graph traversal continues to work after BM25 migration
