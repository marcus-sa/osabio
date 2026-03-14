# Evolution: Objective-Behavior Nodes

**Date:** 2026-03-14
**Branch:** `marcus-sa/objective-behavior-nodes`
**Commits:** 12 (10 feature + 1 refactor + 1 fix)

## Summary

Added objective and behavior node types to the Brain knowledge graph. Objectives represent strategic goals with success criteria and target dates. Behavior records capture per-session agent telemetry (e.g., TDD adherence, security-first compliance) as append-only scored records. Together they enable intent-objective alignment (cosine similarity), behavior-based policy enforcement (score thresholds as policy predicates), coherence auditing (orphaned decisions, stale objectives), and a learning loop that proposes learnings from behavior trend analysis.

## Architecture Overview

Two new server modules following existing patterns:

- **`app/src/server/objective/`** -- Schema, CRUD queries, HTTP routes, alignment evaluator, progress computation
- **`app/src/server/behavior/`** -- Schema, CRUD queries, HTTP routes, pure scorer, pure trend analysis

Key design principles applied:
- Pure functions for scoring and trend analysis (zero IO imports)
- Append-only behavior records (no UPDATE, each session produces a new record)
- Context enrichment for policy enforcement (behavior scores injected before policy gate, no policy schema changes)
- Two-step KNN pattern for HNSW+workspace filter (SurrealDB v3.0 workaround)
- Graph traversal for progress computation (no denormalized counters)

## Implementation Timeline

| Phase | Step | Name | Duration |
|-------|------|------|----------|
| 01: Graph Layer Foundation | 01-01 | Objective schema + CRUD queries | ~3 min |
| | 01-02 | Behavior telemetry collection + scorer | ~1 min |
| | 01-03 | Objective + behavior HTTP routes | ~4 min |
| 02: Alignment and Policy | 02-01 | Intent-objective alignment evaluator | ~5 min |
| | 02-02 | Behavior-based policy enforcement | ~3 min |
| 03: Visibility and Auditing | 03-01 | Objective progress visibility | ~2 min |
| | 03-02 | Coherence auditor scans | ~5 min |
| | 03-03 | Behavior trend computation | ~5 min |
| 04: Learning Loop | 04-01 | Behavior learning bridge | ~5 min |
| | 04-02 | Graph UI visualization | ~3 min |

All 10 steps passed all DES integrity phases (PREPARE, RED_ACCEPTANCE, RED_UNIT, GREEN, COMMIT). Unit test phases were skipped where appropriate (CRUD queries, route handlers, graph traversal) with documented justification.

## Quality Gates Passed

- **DES integrity verification**: All 10 steps verified
- **Adversarial review**: 2 legitimate issues found and resolved
- **Refactoring pass**: L1-L4 applied, net -39 lines
- **Mutation testing**: Disabled per rigor config (appropriate for feature scope)

## Review Findings and Resolutions

| Finding | Severity | Resolution |
|---------|----------|------------|
| Scorer accepts out-of-range telemetry values without validation | High | Added runtime validation to scorer with discriminated union type guards |
| Expiration query uses string comparison for dates | Medium | Switched to `time::now()` server-side comparison in SurrealQL |

Both issues addressed in commit `4ffc0bc3`.

## New Schema

| Migration | Purpose |
|-----------|---------|
| `0032_objective_table.surql` | Objective table, has_objective relation, supports relation |
| `0033_behavior_table.surql` | Behavior table, exhibits relation, learning_evidence OUT extension |
| `0034_objective_fulltext.surql` | Fulltext search index on objective title (BM25) |
| `0035_intent_embedding.surql` | HNSW index on intent embedding for alignment KNN |
| `0036_objective_behavior_graph_functions.surql` | Graph query functions for visualization |

## Files Added/Modified

**New files (19):**
- `app/src/server/objective/queries.ts` -- Objective CRUD queries
- `app/src/server/objective/objective-route.ts` -- Objective HTTP routes + progress
- `app/src/server/objective/alignment.ts` -- Pure cosine alignment evaluator
- `app/src/server/behavior/queries.ts` -- Behavior CRUD queries + latest score lookup
- `app/src/server/behavior/behavior-route.ts` -- Behavior HTTP routes
- `app/src/server/behavior/scorer.ts` -- Pure metric scorer with validation
- `app/src/server/behavior/trends.ts` -- Pure trend analysis (drift, improvement, flat-line)
- `schema/migrations/0032-0036` -- 5 migration files
- `tests/acceptance/objective-behavior/` -- 7 acceptance test suites + test kit
- `tests/unit/alignment.test.ts`, `behavior-scorer.test.ts`, `behavior-trends.test.ts`, `graph-theme.test.ts`, `graph-transform.test.ts` -- 5 unit test files

**Modified files (11):**
- `schema/surreal-schema.surql` -- Added objective, behavior, supports, exhibits, has_objective, learning_evidence definitions
- `app/src/server/intent/authorizer.ts` -- Alignment step after policy gate
- `app/src/server/policy/types.ts` -- behavior_scores field on IntentEvaluationContext
- `app/src/server/observer/graph-scan.ts` -- Coherence auditor scans + behavior learning bridge
- `app/src/server/observer/learning-diagnosis.ts` -- Rate-limited learning proposals from behavior trends
- `app/src/server/graph/queries.ts` -- Objective/behavior nodes in graph query
- `app/src/server/graph/transform.ts` -- Node type mapping for visualization
- `app/src/client/components/graph/graph-theme.ts` -- Colors/shapes for new node types
- `app/src/server/runtime/start-server.ts` -- Route registration

## Metrics

| Metric | Value |
|--------|-------|
| Lines added | ~3,773 |
| Lines removed | ~416 |
| Net lines | ~3,357 |
| Files created | 19 |
| Files modified | 11 |
| Acceptance tests | 42 |
| Unit tests | 73 |
| Total tests | 115 |
| Migrations | 5 |
| Commits | 12 |

## Lessons Learned

1. **Scorer validation matters at the boundary.** The adversarial review correctly identified that the pure scorer accepted any numeric value without range validation. Even with `ASSERT score >= 0 AND score <= 1` at the DB layer, validating at the application layer prevents wasted DB round-trips and gives better error messages.

2. **Date comparison in SurrealQL.** String comparison for ISO dates works in most cases but is fragile. Using `time::now()` for server-side date comparison is more reliable and avoids timezone edge cases.

3. **Context enrichment over schema extension.** Adding behavior scores to the policy evaluation context (rather than extending the policy schema) was the right call. The existing `RulePredicate` with dot-path resolution handled `behavior_scores.tdd_adherence` without any schema changes to the policy table.

4. **Two-step KNN pattern is load-bearing.** The SurrealDB v3.0 bug where HNSW + B-tree indexes conflict in the same WHERE clause is non-obvious. The two-step pattern (KNN in LET, then filter) is essential for any table that has both an HNSW index and a regular index on a filtered field.
