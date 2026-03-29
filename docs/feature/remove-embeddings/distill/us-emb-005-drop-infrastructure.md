# US-EMB-005: Drop Embedding Infrastructure -- Acceptance Scenarios

Traces: US-EMB-005, All Job Stories (infrastructure supporting JS1-JS4)

Driving port: Server startup + SurrealDB schema queries
Infrastructure: `acceptance-test-kit.ts`
Test file: `tests/acceptance/remove-embeddings/drop-embedding-infrastructure.test.ts`

Prerequisite: All Phase 1 (US-EMB-001, 002, 003) and Phase 2 (US-EMB-004) scenarios pass.

---

## Scenario 5.1: Server starts without embedding configuration

```gherkin
Given EMBEDDING_MODEL is not in the environment
And EMBEDDING_DIMENSION is not in the environment
When the Osabio server starts
Then startup completes successfully
And all HTTP endpoints respond to requests
And no embedding-related warnings or errors appear in logs
```

**Implementation notes**:
- Use `configOverrides` to omit `embeddingModelId` and `embeddingDimension`
- Boot server via `setupAcceptanceSuite` with these overrides
- Assert server starts (port responds)
- This tests that `loadServerConfig` no longer requires these env vars

---

## Scenario 5.2: All HNSW indexes removed after migration

```gherkin
Given the infrastructure removal migration has been applied
When querying INFO FOR TABLE for task, decision, question, observation, suggestion, feature, project, person, learning, objective, intent, policy, message
Then no table has an HNSW index defined
And all 17 previously-existing HNSW indexes are absent
```

**Implementation notes**:
- Run `INFO FOR TABLE <table>` for each entity table
- Parse the indexes section of each result
- Assert zero entries containing "HNSW"
- This validates the migration script correctly dropped all indexes

---

## Scenario 5.3: Schema has no embedding field definitions

```gherkin
Given the infrastructure removal migration has been applied
When querying INFO FOR TABLE for all entity tables
Then no table has an "embedding" field in its schema definition
And existing records have no embedding data
```

**Implementation notes**:
- Parse the fields section of `INFO FOR TABLE` results
- Assert no field named "embedding" exists
- Optionally create a record and verify no embedding field is stored

---

## Scenario 5.4: No file imports from graph/embeddings module

@property

```gherkin
Given all embedding-related code has been removed
Then the file app/src/server/graph/embeddings.ts does not exist
And no TypeScript file imports from "graph/embeddings"
And no file references createEmbeddingVector or cosineSimilarity
```

**Implementation notes**:
- This is a codebase-level assertion, not a runtime test
- Implemented as a grep/glob check in the test file
- `@property` tag: this is a universal invariant ("no file ever imports X")
- DELIVER wave may implement as a static analysis check rather than runtime test

---

## Scenario 5.5: Entity creation does not generate embeddings

```gherkin
Given the Osabio server is running without embedding configuration
When a new task "Test task for post-migration verification" is created in workspace "Acme Corp"
Then the task is persisted successfully
And the task record has no embedding field
And no external embedding API call was made
```

**Implementation notes**:
- Create a task through whatever endpoint is most direct (chat extraction or direct DB seed)
- Query the task record and assert `embedding` field is absent
- Regression test: proves the creation pipeline has no residual embedding generation
