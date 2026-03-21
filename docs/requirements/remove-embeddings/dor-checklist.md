# Definition of Ready Validation: Remove Embeddings

## US-EMB-001: Chat Agent BM25 Entity Search

| DoR Item | Status | Evidence/Issue |
|----------|--------|----------------|
| Problem statement clear | PASS | "Chat agent calls external embedding API (60s timeout), loads 120+ candidates into memory, computes cosine in-process" -- domain language, measurable pain |
| User/persona identified | PASS | Chat agent handling user queries about workspace entities |
| 3+ domain examples | PASS | 4 examples: Maria Santos auth decisions, Carlos Rivera stemmed search, Priya Sharma empty results, Tomoko Nakamura project-scoped |
| UAT scenarios (3-7) | PASS | 5 scenarios: BM25 results, stemming, kind filter, empty results, project scope |
| AC derived from UAT | PASS | 7 AC items covering BM25 usage, no embedding calls, filtering, sorting |
| Right-sized | PASS | ~2 days: replace one function, update tool description, remove embedding deps from ChatToolDeps |
| Technical notes | PASS | BM25 query pattern, @N@ limitation, existing indexes from migration 0002 |
| Dependencies tracked | PASS | BM25 indexes from migration 0002 (already exist) |

**DoR Status**: PASSED

---

## US-EMB-002: Learning Collision Detection via BM25

| DoR Item | Status | Evidence/Issue |
|----------|--------|----------------|
| Problem statement clear | PASS | "Two-step KNN + brute-force fallback, cross-form 0.50 threshold barely above random" -- measurable, domain language |
| User/persona identified | PASS | Observer agent proposing learnings from pattern analysis |
| 3+ domain examples | PASS | 3 examples: dismissed blocking, new learning passing, cluster coverage |
| UAT scenarios (3-7) | PASS | 4 scenarios: dismissed block, active coverage, new passes, cluster coverage |
| AC derived from UAT | PASS | 8 AC items covering BM25 replacement, no embedding calls, no brute-force, new index |
| Right-sized | PASS | ~2 days: replace detector.ts functions, add migration, update learning-diagnosis.ts callers |
| Technical notes | PASS | New migration, BM25 threshold calibration, @N@ limitation, observation clustering note |
| Dependencies tracked | PASS | New migration for learning.text BM25 index. Observation clustering deferred to Phase 3 |

**DoR Status**: PASSED

---

## US-EMB-003: Graph-Based Objective-Intent Alignment

| DoR Item | Status | Evidence/Issue |
|----------|--------|----------------|
| Problem statement clear | PASS | "Cosine between intent/objective embeddings produces unreliable results when vocabulary differs; graph path is deterministic" |
| User/persona identified | PASS | Authorizer evaluating intents for strategic alignment |
| 3+ domain examples | PASS | 3 examples: task-level graph path, free-form BM25 fallback, no alignment warning |
| UAT scenarios (3-7) | PASS | 4 scenarios: task path, project path, BM25 fallback, no alignment warning |
| AC derived from UAT | PASS | 8 AC items covering graph traversal, BM25 fallback, classification contract, ADR |
| Right-sized | PASS | ~2 days: replace alignment-adapter.ts, add BM25 fallback, write ADR superseding 032 |
| Technical notes | PASS | Graph query pattern, BM25 index on objective, intent resolution reuse, ADR supersession |
| Dependencies tracked | PASS | Graph edges must be consistently created. New migration for objective BM25 index. ADR-032 superseded |

**DoR Status**: PASSED

---

## US-EMB-004: Proxy Context Injection Without Embeddings

| DoR Item | Status | Evidence/Issue |
|----------|--------|----------------|
| Problem statement clear | PASS | "Every proxy message requires embedding API call (60s timeout), cosine on all candidates in memory, three parallel two-step KNN queries" |
| User/persona identified | PASS | Proxy context injector processing proxied coding agent messages |
| 3+ domain examples | PASS | 3 examples: recent project decision, cross-project BM25, no context found |
| UAT scenarios (3-7) | PASS | 3 scenarios: relevance+recency, time classification, no context |
| AC derived from UAT | PASS | 7 AC items covering BM25 ranking, time classification, no embedding calls, telemetry |
| Right-sized | PASS | ~3 days: replace ranking, classification, recent changes search. Pure functions unaffected |
| Technical notes | PASS | Phase 2 dependency, pure functions preserved, recency weighting, graph proximity |
| Dependencies tracked | PASS | Depends on US-EMB-001 (BM25 pattern proven). BM25 indexes already exist |

**DoR Status**: PASSED

---

## US-EMB-005: Drop Embedding Infrastructure

| DoR Item | Status | Evidence/Issue |
|----------|--------|----------------|
| Problem statement clear | PASS | "17 HNSW indexes, embedding fields on every entity table, dead embeddings.ts module, config clutter" |
| User/persona identified | PASS | Brain platform engineer maintaining codebase after migration |
| 3+ domain examples | PASS | 3 examples: clean schema, server without config, grep zero references |
| UAT scenarios (3-7) | PASS | 4 scenarios: indexes removed, fields removed, server starts, no code references |
| AC derived from UAT | PASS | 8 AC items covering index drops, field removal, module deletion, config cleanup |
| Right-sized | PASS | ~2 days: migration script, delete module, update config, update 26 import sites |
| Technical notes | PASS | Single transaction migration, observation clustering dependency, 26 files to update |
| Dependencies tracked | PASS | Blocked by US-EMB-001 through US-EMB-004. Observation clustering must be addressed |

**DoR Status**: PASSED

---

## Summary

| Story | DoR Status | Phase | Effort | Scenarios |
|-------|------------|-------|--------|-----------|
| US-EMB-001 | PASSED | 1 | ~2 days | 5 |
| US-EMB-002 | PASSED | 1 | ~2 days | 4 |
| US-EMB-003 | PASSED | 1 | ~2 days | 4 |
| US-EMB-004 | PASSED | 2 | ~3 days | 3 |
| US-EMB-005 | PASSED | 3 | ~2 days | 4 |

All 5 stories pass the 8-item DoR hard gate. Total: 20 UAT scenarios across the migration.
