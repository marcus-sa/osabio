# Dynamic Behavior Definitions — Evolution Record

## Feature Summary

Enables non-technical admins to define behavioral standards as data, score agent telemetry against them via LLM or deterministic pipelines, and enforce via existing policy gate and observer loops.

## Delivery Timeline

- **DISCUSS + DESIGN + DISTILL**: 2026-03-13
- **DELIVER start**: 2026-03-14
- **DELIVER complete**: 2026-03-14

## Steps Executed

| Step | Name | Status | Key Deliverable |
|------|------|--------|-----------------|
| 01-01 | Schema migration and type definitions | PASS | behavior_definition table, migration 0037, TypeScript types |
| 01-02 | Definition CRUD queries | PASS | create/get/list/update queries with status transition validation |
| 01-03 | Definition HTTP routes and walking skeleton | PASS | 4 CRUD endpoints, extended createBehavior(), walking skeleton green |
| 02-01 | Definition matcher | PASS | Pure function matching active definitions by telemetry_type |
| 02-02 | LLM scorer and scorer dispatcher | PASS | generateObject scoring, mode-based routing, SCORER_MODEL config |
| 02-03 | Scoring HTTP endpoint | PASS | POST /behaviors/score endpoint with full pipeline |
| 03-01 | Authorizer integration verification | PASS | Zero production code changes, 6 tests verified |
| 03-02 | Observer integration with definition context | PASS | Definition-enriched learning proposals, dynamic workspace trends |

## Test Results

- **Acceptance tests**: 41 pass, 9 skip, 0 fail
- **Unit tests**: 6 pass (definition-matcher)
- **Total assertions**: 122

## Architecture Decisions

1. **Extend behavior/ module** (not a new module) — definitions are tightly coupled to behaviors
2. **Pure definition-matcher** — zero IO, composable in pipeline
3. **Scorer dispatcher pattern** — routes by scoring_mode to deterministic or LLM scorer
4. **LLM scorer uses generateObject** — structured Zod schema output, 30s timeout
5. **SCORER_MODEL env var** — falls back to EXTRACTION_MODEL for cost efficiency
6. **Authorizer works unchanged** — enrichBehaviorScores + resolveDotPath already support dynamic metrics
7. **Observer enriched minimally** — definition goal context added to learning proposals

## Files Modified

### New Files
- `schema/migrations/0037_behavior_definition.surql`
- `app/src/server/behavior/definition-types.ts`
- `app/src/server/behavior/definition-matcher.ts`
- `app/src/server/behavior/llm-scorer.ts`
- `app/src/server/behavior/scorer-dispatcher.ts`
- `tests/unit/behavior/definition-matcher.test.ts`

### Modified Files
- `schema/surreal-schema.surql`
- `app/src/server/behavior/queries.ts`
- `app/src/server/behavior/behavior-route.ts`
- `app/src/server/runtime/config.ts`
- `app/src/server/runtime/types.ts`
- `app/src/server/runtime/dependencies.ts`
- `app/src/server/runtime/start-server.ts`

## API Surface Added

| Method | Path | Purpose |
|--------|------|---------|
| POST | /api/workspaces/:ws/behavior-definitions | Create definition |
| GET | /api/workspaces/:ws/behavior-definitions | List definitions |
| GET | /api/workspaces/:ws/behavior-definitions/:id | Get definition |
| PUT | /api/workspaces/:ws/behavior-definitions/:id | Update definition |
| POST | /api/workspaces/:ws/behaviors/score | Score telemetry |

## Review Outcomes

- **Roadmap review**: APPROVED after 1 revision (frontend scoped out)
- **Adversarial review**: APPROVED with 2 LOW recommendations
- **Refactoring pass**: 6 files improved, key fix: wired scorerModel into ServerDependencies

## Scope Boundaries

- Backend only — Frontend (Behavior Library UI) is a separate roadmap
- No data migration needed (new tables only)
- No backwards compatibility concerns (new feature)
