# Cross-Cutting Regression Scenarios

Traces: CC-01 through CC-05 (acceptance-criteria.md)

These scenarios cut across all user stories and validate that embedding infrastructure is fully removed.
They run after all Phase 1, 2, and 3 stories are complete.

---

## Scenario CC.1: No code path calls createEmbeddingVector after migration

@property

```gherkin
Given Phases 1 and 2 are complete
Then no application code path calls createEmbeddingVector
And no test helper generates embeddings for production use
```

**Implementation notes**:
- Static analysis: grep for `createEmbeddingVector` in `app/src/`
- Should return zero matches
- `@property` tag: universal invariant across entire codebase

---

## Scenario CC.2: All acceptance tests pass without EMBEDDING_MODEL env var

```gherkin
Given EMBEDDING_MODEL is removed from the test environment
And EMBEDDING_DIMENSION is removed from the test environment
When the full acceptance test suite runs
Then all tests pass
And no test references testAI.embeddingModel
```

**Implementation notes**:
- After Phase 3, `acceptance-test-kit.ts` should no longer require `EMBEDDING_MODEL`
- The `testAI.embeddingModel` export should be removed
- All test kits using `generateEmbedding` / `createTestLearningWithEmbedding` should be updated

---

## Scenario CC.3: Entity write latency has no HNSW index overhead

```gherkin
Given the infrastructure removal migration has been applied
When 50 task records are created in rapid succession
Then the average write latency per record is below 50ms
And no HNSW index update occurs during writes
```

**Implementation notes**:
- Benchmark test: create 50 tasks, measure average write time
- Before migration: HNSW index update adds overhead to every write
- After migration: writes should be faster without index maintenance
- This is a performance regression test, not a strict pass/fail assertion
