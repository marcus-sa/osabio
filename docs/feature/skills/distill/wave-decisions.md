# DISTILL Decisions -- skills

## Key Decisions

- [D24] 31 acceptance scenarios organized as 3 walking skeletons + 28 focused scenarios: walking skeletons prove admin can create skills, assign them to agents, and control availability through lifecycle. Focused scenarios cover CRUD, lifecycle, agent creation, toolset resolution, and governance.
- [D25] Error + edge case ratio is 45% (14 of 31 scenarios): exceeds the 40% threshold. Error paths cover: duplicate names, missing fields, deletion of assigned skills, invalid lifecycle transitions, deprecated skill blocking agent creation, nonexistent skill references, and not-found errors.
- [D26] Test kit follows learning-test-kit pattern: `skill-test-kit.ts` extends `acceptance-test-kit.ts` with skill-specific HTTP helpers, DB verification helpers, and test data factories. All helpers use business language.
- [D27] Tests drive through HTTP API endpoints exclusively (hexagonal boundary enforcement): `POST/GET/PUT/DELETE /api/workspaces/:wsId/skills/*` and `POST/GET /api/workspaces/:wsId/agents/*`. SurrealDB direct queries used only for test data setup and outcome verification.
- [D28] First enabled test is WS-1 (walking skeleton: create + activate + list): proves schema, CRUD, and lifecycle transitions work end-to-end before any focused scenarios are enabled.
- [D29] Five test files organized by business capability: walking-skeleton.test.ts, skill-crud.test.ts, skill-lifecycle.test.ts, agent-creation-with-skills.test.ts, policy-governance.test.ts. This mirrors existing patterns (e.g., agent-learnings/ directory structure).
- [D30] Deferred from acceptance tests (matching task scope): UI tests, setSkillsConfig integration (adapter not yet implemented), MCP tool gating, skill import from external registries, brain-authored skills.
- [D31] T-2 (tool deduplication) tagged @property: signals DELIVER wave crafter to implement as property-based test -- "for any combination of skills sharing tools, the effective toolset contains each tool exactly once."
- [D32] Policy governance tests seed governs_skill edges via direct DB (not HTTP): the policy-to-skill linking API endpoint is not yet defined in the DESIGN wave. Tests verify the graph traversal works once the edge exists.

## Inherited from DESIGN

- [D14] Extend `createAgentTransaction` with `possesses` + `can_use` edges atomically
- [D15] Source-reference architecture: metadata + pointer, SDK resolves at session time
- [D16] New `skill/` module follows learning system pattern
- [D17] Schema migration 0084 with non-UNIQUE index on workspace+name
- [D20] Name uniqueness at application layer (pre-validation query)
- [D21] Lifecycle transitions via explicit endpoints (activate, deprecate)
- [D23] Policy governance traversal: mcp_tool <- skill_requires <- skill <- governs_skill <- policy

## Mandate Compliance Evidence

### CM-A: Hexagonal Boundary Enforcement
All test files import only from `skill-test-kit.ts` which wraps HTTP `fetch` calls to API endpoints (driving ports). Zero imports from internal modules (`skill-queries.ts`, `skill-route.ts`, `agent-queries.ts`).

### CM-B: Business Language Purity
Test names and comments use domain terms exclusively:
- "admin creates skill with GitHub source and required tools" (not "POST /api returns 201")
- "deprecated skill is excluded from active skill listing" (not "status filter query works")
- "agent gains tools through possessed skill's required tools" (not "skill_requires JOIN returns rows")

### CM-C: Walking Skeleton + Focused Scenario Counts
- Walking skeletons: 3 (WS-1, WS-2, WS-3)
- Focused scenarios: 28 (C-1 through C-11, L-1 through L-5, A-1 through A-6, T-1 through T-3, G-1 through G-3)
- Ratio: 10% skeletons / 90% focused -- within recommended range

## Handoff to Software Crafter (DELIVER Wave)

### Test Files
- `tests/acceptance/skill/skill-test-kit.ts` -- shared test infrastructure
- `tests/acceptance/skill/walking-skeleton.test.ts` -- 3 walking skeletons (WS-1 enabled, WS-2 + WS-3 skipped)
- `tests/acceptance/skill/skill-crud.test.ts` -- 11 CRUD scenarios (all skipped)
- `tests/acceptance/skill/skill-lifecycle.test.ts` -- 5 lifecycle scenarios (all skipped)
- `tests/acceptance/skill/agent-creation-with-skills.test.ts` -- 9 agent creation + toolset scenarios (all skipped)
- `tests/acceptance/skill/policy-governance.test.ts` -- 3 governance scenarios (all skipped)

### Implementation Sequence
Enable one test at a time. Recommended order documented in `docs/feature/skills/distill/acceptance-scenarios.md`.

### Schema Required
Migration 0084: `skill` table + `skill_requires`, `possesses`, `skill_supersedes`, `skill_evidence`, `governs_skill` relation tables. See architecture.md Section 6.1.

### API Required
Skill CRUD + lifecycle endpoints per architecture.md Section 7. Agent creation route extended with `skill_ids` and `additional_tool_ids` body fields.
