# Acceptance Criteria: Remove Embeddings from Brain Knowledge Graph

## Traceability Matrix

| Story | Job Story | Phase | AC Count | Scenarios |
|-------|-----------|-------|----------|-----------|
| US-EMB-001 | JS1: Find Relevant Entities by Intent | 1 | 7 | 5 |
| US-EMB-002 | JS3: Detect Duplicate or Previously Dismissed Learnings | 1 | 8 | 4 |
| US-EMB-003 | JS4: Align Intents with Strategic Objectives | 1 | 8 | 4 |
| US-EMB-004 | JS2: Inject Relevant Context into Coding Agent Sessions | 2 | 7 | 3 |
| US-EMB-005 | All (infrastructure supporting JS1-JS4) | 3 | 8 | 4 |

## Cross-Cutting Acceptance Criteria

These criteria apply across ALL stories:

- [ ] **CC-01**: No code path calls `createEmbeddingVector` after Phase 1+2 completion
- [ ] **CC-02**: No `EMBEDDING_MODEL` or `EMBEDDING_DIMENSION` environment variables required after Phase 3
- [ ] **CC-03**: All acceptance tests pass without an embedding model configured (after their respective phase)
- [ ] **CC-04**: CI test suite execution time decreases (no 60s embedding timeout risk)
- [ ] **CC-05**: `surreal-schema.surql` contains zero HNSW index definitions after Phase 3

## Non-Functional Requirements

### Performance
- BM25 search latency: < 200ms for workspace-scoped search across all entity types (current: 1-60s with embedding)
- Proxy context injection: no additional latency from external API call (current: 1-60s embedding generation)
- Entity write latency: reduced after Phase 3 (no HNSW index update on every write)

### Reliability
- Zero embedding-timeout-related CI failures after Phase 1
- Zero external API dependency for search, collision detection, and alignment
- Proxy context injection works when embedding API is unavailable (currently fails silently)

### Observability
- Context injection span attributes continue to report: `decisionsCount`, `learningsCount`, `observationsCount`, `tokensEstimated`
- Search tool reports `search.result_count` span attribute
- Alignment reports classification and evidence in span attributes

## Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| BM25 misses semantically related entities with no shared vocabulary | Medium | Low | Domain vocabulary in structured knowledge graphs is consistent. Stemmer handles morphological variants. |
| Proxy context quality degrades without semantic ranking | Low | Medium | Recency + project proximity are strong signals for coding context. Instrument and compare before/after. |
| Graph alignment misses free-form intents | Low | Low | BM25 fallback covers unresolved intents. Intent resolution handles most cases. |
| BM25 threshold calibration for collision detection | Medium | Low | Calibrate via acceptance tests with known duplicate/non-duplicate pairs. |
| Observation clustering breaks without embeddings (Phase 3) | High | Medium | Must replace or remove clustering before dropping embedding fields. Could use text similarity or topic modeling. |

## Migration Order Constraints

```
US-EMB-001 (search)  ----+
US-EMB-002 (collision) --+--> US-EMB-004 (proxy) --> US-EMB-005 (cleanup)
US-EMB-003 (alignment) --+
```

- Phase 1 stories (001, 002, 003) can execute in parallel
- US-EMB-004 depends on US-EMB-001 (BM25 pattern proven)
- US-EMB-005 depends on ALL previous stories
