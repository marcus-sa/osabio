# US-EMB-002: Learning Collision Detection via BM25 -- Acceptance Scenarios

Traces: US-EMB-002, JS3 (Detect Duplicate or Previously Dismissed Learnings)

Driving port: `POST /api/workspaces/:workspaceId/learnings`
Infrastructure: `acceptance-test-kit.ts` + `learning-test-kit.ts` (existing, to be updated)
Test file: `tests/acceptance/remove-embeddings/collision-detection-bm25.test.ts`

---

## Scenario 2.1: Dismissed learning blocks re-suggestion via BM25

@walking_skeleton

```gherkin
Given workspace "Acme Corp" has a dismissed learning "Always run integration tests before merging PRs"
When a learning is proposed with text "Always run integration tests before merging pull requests"
Then the proposal is blocked with reason "dismissed_similarity"
And no embedding API call was made
```

**Implementation notes**:
- Seed dismissed learning via `createTestLearning` with `status: "dismissed"` (no embedding field)
- Create learning via HTTP endpoint `createLearningViaHttp`
- Assert `body.collisions` contains entry with `collisionType: "duplicates"` or blocked reason
- New BM25 index on `learning.text` required (migration prerequisite)

---

## Scenario 2.2: Active learning coverage prevents duplicate proposal

```gherkin
Given workspace "Acme Corp" has an active learning "Enforce code review approval before merge"
When a learning is proposed with text "Require code review sign-off before merging"
Then the proposal is blocked because active coverage was detected
And the collision references the existing active learning
```

**Implementation notes**:
- BM25 matches "code review" and "merge/merging" via stemmer
- Assert collision response includes `targetKind: "learning"` and blocking flag

---

## Scenario 2.3: Genuinely different learning passes collision detection

```gherkin
Given workspace "Acme Corp" has an active learning "Enforce code review approval before merge"
And the workspace has a dismissed learning "Always run integration tests before merging PRs"
When a learning is proposed with text "Add circuit breaker to payment service external calls"
Then the proposal passes collision detection
And the learning is created with status "pending_approval" or "active"
```

**Implementation notes**:
- No BM25 term overlap between "circuit breaker payment service" and existing learnings
- Assert `body.collisions` is empty or absent

---

## Scenario 2.4: Collision detection respects workspace boundaries

```gherkin
Given workspace "Alpha" has an active learning "Always use REST APIs for all external integrations"
And workspace "Beta" has no learnings
When a learning "Always use REST APIs for all external integrations" is proposed in workspace "Beta"
Then no collision is detected
And the learning is created successfully in workspace "Beta"
```

**Implementation notes**:
- Seed identical learning text in workspace Alpha only
- Create via HTTP in workspace Beta
- BM25 search must be scoped to the target workspace

---

## Scenario 2.5: Learning proposal with empty text is rejected

```gherkin
Given workspace "Acme Corp" exists
When a learning is proposed with empty text ""
Then the request is rejected with a validation error
And no collision detection runs
```

**Implementation notes**:
- Input validation at HTTP boundary, before BM25 search
- Assert HTTP 400 response

---

## Scenario 2.6: BM25 index on learning.text returns scored results

```gherkin
Given workspace "Acme Corp" has 3 active learnings about different topics
And one learning contains the word "authentication"
When BM25 search runs against learning.text for "authentication"
Then exactly 1 learning is returned with a positive BM25 score
```

**Implementation notes**:
- Validates the new BM25 fulltext index on `learning.text` works correctly
- This is an infrastructure validation scenario ensuring the migration is correct

---

## Scenario 2.7: Learning without embedding field is accepted and persisted

```gherkin
Given workspace "Acme Corp" exists
When a learning is created with text "Use structured logging in all services"
Then the learning is persisted without an embedding field
And the learning record has no embedding array stored
```

**Implementation notes**:
- After migration, `suggestLearning` no longer accepts `embedding` parameter
- Assert `learning.embedding` is undefined on the persisted record
- Regression: ensures new code path does not attempt to generate embeddings
