# US-EMB-003: Graph-Based Objective-Intent Alignment -- Acceptance Scenarios

Traces: US-EMB-003, JS4 (Align Intents with Strategic Objectives)

Driving port: Alignment evaluator (graph queries + BM25 fallback)
Infrastructure: `acceptance-test-kit.ts` + `objective-behavior-test-kit.ts` (existing, to be updated)
Test file: `tests/acceptance/remove-embeddings/graph-alignment.test.ts`

---

## Scenario 3.1: Graph traversal finds alignment via task-project-objective path

@walking_skeleton

```gherkin
Given workspace "Acme Corp" has an active objective "Improve platform reliability"
And the objective is linked to project "Infrastructure"
And the project has task "Implement rate limiting"
When the alignment evaluator processes an intent referencing task "Implement rate limiting"
Then the alignment classification is "matched"
And a supports edge is created between intent and objective
And no embedding API call was made
```

**Implementation notes**:
- Seed: objective -> has_objective -> project, task -> belongs_to -> project
- Alignment adapter receives the resolved task, traverses graph path
- Graph query: `SELECT <-has_objective<-objective FROM project WHERE id = $project`
- Assert `supports` edge exists between intent and objective records
- Assert `alignment_method` on edge is "graph_traversal" (not "embedding")

---

## Scenario 3.2: Graph traversal finds alignment via direct project-objective path

```gherkin
Given workspace "Acme Corp" has an active objective "Launch MVP by Q3"
And the objective is linked to project "Product Launch"
When the alignment evaluator processes an intent that resolves to project "Product Launch"
Then the alignment classification is "matched"
```

**Implementation notes**:
- Intent resolves to project level (no task)
- Shorter graph path: project <- has_objective <- objective
- Same classification logic, fewer hops

---

## Scenario 3.3: BM25 fallback matches free-form intent to objective

```gherkin
Given workspace "Acme Corp" has an active objective "Reduce deployment failures by 50%"
And an intent has description "fix the flaky CI pipeline that blocks deploys"
And the intent does not resolve to any task or project
When the alignment evaluator processes the intent
Then BM25 search matches the objective via "deployment" / "deploys" stemmer equivalence
And the alignment classification is "ambiguous"
```

**Implementation notes**:
- Intent resolution returns no task or project (free-form text)
- BM25 fallback searches intent description against `objective.title` and `objective.description`
- New BM25 fulltext index on objective table required (migration prerequisite)
- "ambiguous" classification because BM25 match is not a deterministic graph path

---

## Scenario 3.4: No alignment found creates warning observation

```gherkin
Given workspace "Acme Corp" has an active objective "Improve platform reliability"
And the objective is linked to project "Infrastructure"
When the alignment evaluator processes an intent that resolves to project "Marketing Site"
Then the alignment classification is "none"
And a warning observation is created with text containing "no supporting objective"
```

**Implementation notes**:
- "Marketing Site" project has no objective linked via `has_objective` edge
- BM25 fallback on intent description also finds no match
- Warning observation created via `createAlignmentWarningObservation`
- Intent is NOT blocked (warning mode)

---

## Scenario 3.5: Intent with no task or project resolution and no BM25 match

```gherkin
Given workspace "Acme Corp" has an active objective "Improve platform reliability"
And an intent has description "refactor CSS grid layout for mobile responsive design"
And the intent does not resolve to any task or project
When the alignment evaluator processes the intent
Then the alignment classification is "none"
And a warning observation is created
```

**Implementation notes**:
- Neither graph traversal nor BM25 finds a match
- "CSS grid layout" shares no vocabulary with "platform reliability"
- Validates the full fallback chain: graph miss -> BM25 miss -> "none"

---

## Scenario 3.6: Multiple objectives linked to same project returns best match

```gherkin
Given workspace "Acme Corp" has project "Infrastructure"
And the project has active objective "Improve platform reliability"
And the project has active objective "Reduce infrastructure costs by 30%"
And the project has task "Implement rate limiting"
When the alignment evaluator processes an intent referencing task "Implement rate limiting"
Then the alignment classification is "matched"
And the supports edge links to the first objective found via graph traversal
```

**Implementation notes**:
- Graph traversal may return multiple objectives for one project
- Selection logic picks the first or highest-priority match
- Both objectives are valid -- the system should deterministically pick one
