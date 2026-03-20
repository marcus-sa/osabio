# Test Scenarios: Remove Embeddings

## Overview

| Story | Walking Skeletons | Happy Path | Error/Edge | Total | Error % |
|-------|-------------------|------------|------------|-------|---------|
| US-EMB-001: Chat Agent BM25 Search | 1 | 3 | 3 | 7 | 43% |
| US-EMB-002: Learning Collision Detection | 1 | 2 | 4 | 7 | 57% |
| US-EMB-003: Graph-Based Alignment | 1 | 2 | 3 | 6 | 50% |
| US-EMB-004: Proxy Context Injection | 1 | 2 | 3 | 6 | 50% |
| US-EMB-005: Drop Embedding Infrastructure | 0 | 2 | 3 | 5 | 60% |
| **Cross-Cutting Regression** | 0 | 0 | 3 | 3 | 100% |
| **Total** | **3** | **11** | **19** | **34** | **56%** |

Error/edge ratio: 56% (exceeds 40% target).

## Migration Phase Mapping

### Phase 1 (US-EMB-001, 002, 003) -- 20 scenarios
Can execute in parallel. No ordering dependency between stories.

### Phase 2 (US-EMB-004) -- 6 scenarios
Depends on Phase 1 completion (BM25 pattern proven in chat agent).

### Phase 3 (US-EMB-005) -- 5 scenarios + 3 cross-cutting
Depends on all Phase 1 + Phase 2 stories passing.

## Driving Ports by Story

| Story | Driving Port | Port Type |
|-------|-------------|-----------|
| US-EMB-001 | `search_entities` chat tool | Tool execution |
| US-EMB-002 | `POST /api/workspaces/:wsId/learnings` | HTTP endpoint |
| US-EMB-003 | Alignment evaluator + SurrealDB graph queries | Internal port + DB |
| US-EMB-004 | `POST /proxy/llm/anthropic/v1/messages` | HTTP endpoint |
| US-EMB-005 | Server startup + SurrealDB schema queries | Runtime + DB |

## Test Infrastructure Requirements

### New Test Kit: `tests/acceptance/remove-embeddings/remove-embeddings-test-kit.ts`

Extends `acceptance-test-kit.ts` with helpers:

- `createTestWorkspaceWithEntities(surreal, suffix, entities)` -- seeds workspace with BM25-indexed entities
- `searchViaChatTool(surreal, workspaceRecord, query, opts)` -- invokes the BM25 search path directly
- `createProjectWithObjective(surreal, workspaceId, projectName, objectiveTitle)` -- seeds project + objective + graph edges
- `createTaskInProject(surreal, workspaceId, projectId, taskTitle)` -- seeds task + belongs_to edge
- `assertNoEmbeddingApiCall()` -- verifies no embedding generation occurred (via span attributes or missing embedding fields)

### Config Override

Tests should use `configOverrides` to remove embedding requirements from `ServerConfig` where applicable,
confirming the system operates without embedding configuration after each phase.

### Shared Fixtures

Reuse `createWorkspaceDirectly`, `createDecisionDirectly`, `createObservationDirectly`,
`createIntentDirectly` from `tests/acceptance/shared-fixtures.ts`.

## Scenario Index

### US-EMB-001: Chat Agent BM25 Entity Search

| # | Type | Scenario | Tag |
|---|------|----------|-----|
| 1.1 | Skeleton | Chat agent finds entities by keyword via BM25 | @walking_skeleton |
| 1.2 | Happy | BM25 stemmer matches word variations | |
| 1.3 | Happy | Search filters results by entity kind | |
| 1.4 | Happy | Project-scoped search excludes other projects | |
| 1.5 | Error | Search returns empty results without error | |
| 1.6 | Edge | Search with special characters does not cause errors | |
| 1.7 | Edge | Search results include neighbor enrichment | |

### US-EMB-002: Learning Collision Detection via BM25

| # | Type | Scenario | Tag |
|---|------|----------|-----|
| 2.1 | Skeleton | Dismissed learning blocks re-suggestion via BM25 | @walking_skeleton |
| 2.2 | Happy | Active learning coverage prevents duplicate proposal | |
| 2.3 | Happy | Genuinely different learning passes collision detection | |
| 2.4 | Error | Collision detection respects workspace boundaries | |
| 2.5 | Error | Learning proposal with empty text is rejected | |
| 2.6 | Edge | BM25 index on learning.text returns scored results | |
| 2.7 | Edge | Learning without embedding field is accepted and persisted | |

### US-EMB-003: Graph-Based Objective-Intent Alignment

| # | Type | Scenario | Tag |
|---|------|----------|-----|
| 3.1 | Skeleton | Graph traversal finds alignment via task-project-objective path | @walking_skeleton |
| 3.2 | Happy | Graph traversal finds alignment via direct project-objective path | |
| 3.3 | Happy | BM25 fallback matches free-form intent to objective | |
| 3.4 | Error | No alignment found creates warning observation | |
| 3.5 | Error | Intent with no task or project resolution falls back to BM25 | |
| 3.6 | Edge | Multiple objectives linked to same project returns best match | |

### US-EMB-004: Proxy Context Injection Without Embeddings

| # | Type | Scenario | Tag |
|---|------|----------|-----|
| 4.1 | Skeleton | Proxy injects workspace decisions ranked by BM25 relevance and recency | @walking_skeleton |
| 4.2 | Happy | Recent changes classified by time instead of similarity | |
| 4.3 | Happy | Cross-project context included with lower ranking | |
| 4.4 | Error | No matching context results in clean pass-through | |
| 4.5 | Error | Context injection works without embedding API configured | |
| 4.6 | Edge | Token budget selection unchanged after migration | |

### US-EMB-005: Drop Embedding Infrastructure

| # | Type | Scenario | Tag |
|---|------|----------|-----|
| 5.1 | Happy | Server starts without embedding configuration | |
| 5.2 | Happy | All HNSW indexes removed after migration | |
| 5.3 | Error | Schema has no embedding field definitions | |
| 5.4 | Error | No file imports from graph/embeddings module | |
| 5.5 | Error | Entity creation does not generate embeddings | |

### Cross-Cutting Regression

| # | Type | Scenario | Tag |
|---|------|----------|-----|
| CC.1 | Regression | No code path calls createEmbeddingVector after Phase 1+2 | @property |
| CC.2 | Regression | All acceptance tests pass without EMBEDDING_MODEL env var | |
| CC.3 | Regression | Entity write latency has no HNSW index overhead after Phase 3 | |
