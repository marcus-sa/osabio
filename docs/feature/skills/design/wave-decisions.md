# DESIGN Decisions -- skills

## Key Decisions

- [D14] Extend `createAgentTransaction` with `possesses` + `can_use` edges in same atomic transaction, not post-creation steps: atomicity is a hard requirement from US-07 (see: adr-001)
- [D15] Source-reference architecture: Osabio stores metadata + source pointer, never file content. Sandbox Agent SDK resolves files at session time via `setSkillsConfig` (see: adr-002)
- [D16] New `skill/` module follows learning system pattern (route handler factory + query functions with DI + separated types): maximizes recognizability and minimizes learning curve (see: adr-003)
- [D17] Schema migration 0084: `skill` table + 5 relation tables (`skill_requires`, `possesses`, `skill_supersedes`, `skill_evidence`, `governs_skill`). Non-UNIQUE index on workspace+name due to SurrealDB v3.0.4 UNIQUE index bug.
- [D18] Wizard state management uses React `useState` at `AgentCreatePage` level with props drilling to step components: no external state library needed for <20 skills and 3 steps.
- [D19] `SandboxAgentAdapter` port extended with `setSkillsConfig` and `deleteSkillsConfig` methods following existing `setMcpConfig` pattern. Mock adapter stores configs in a Map for test assertions.
- [D20] Skill name uniqueness enforced at application layer (pre-validation query in route handler) rather than DB-level UNIQUE constraint: works around SurrealDB v3.0.4 UNIQUE index bug while maintaining the same behavior.
- [D21] Skill lifecycle transitions are explicit endpoint calls (`POST .../activate`, `POST .../deprecate`) rather than generic status field updates: matches learning system's action-based pattern and prevents invalid transitions.
- [D22] Skill-derived tools resolved client-side in Step 3: skills already fetched with tool edges in Step 2, so client can compute the union without an additional API call. Reduces latency and network requests.
- [D23] Policy governance at tool-call time traverses: `mcp_tool <- skill_requires <- skill <- governs_skill <- policy`. This is additive to existing policy evaluation -- not a replacement.

## Inherited from DISCUSS

- [D6] 10 user stories: Walking Skeleton (7) + Release 1 (3)
- [D7] Wizard Steps 2 and 3 are separate stories
- [D8] Atomic creation is a separate story from wizard UI
- [D9] Session lifecycle integration in Walking Skeleton (risk validation)
- [D10] Policy governance split: relation in WS, evaluation in R1
- [D11] Skill Library UI split into list/detail and create form
- [D12] No MCP tool gating in Walking Skeleton
- [D13] North Star KPI: >50% of sandbox agents with skills assigned

## Inherited from DISCOVER

- [D1] 3-step wizard (Config > Skills > Tools)
- [D2] Minimal checklist for skill assignment in Step 2
- [D3] Two-section tool display in Step 3
- [D4] Steps 2 and 3 are skippable
- [D5] Runtime selection consolidated into Step 1

## Architecture Artifacts

- `docs/feature/skills/design/architecture.md` -- Full architecture document with C4 diagrams
- `docs/feature/skills/design/adr-001-extend-agent-creation-transaction.md` -- Atomic transaction extension
- `docs/feature/skills/design/adr-002-source-reference-architecture.md` -- Source-reference storage
- `docs/feature/skills/design/adr-003-skill-module-structure.md` -- Module structure pattern

## Integration Points

| Integration | Owner | Risk |
|-------------|-------|------|
| `createAgentTransaction` extension | agents/agent-queries.ts | LOW -- additive SQL statements in existing transaction |
| `SandboxAgentAdapter.setSkillsConfig` | orchestrator/sandbox-adapter.ts | MEDIUM -- new SDK method, needs mock for tests |
| Session lifecycle (`resolveActiveSkills`) | orchestrator/session-lifecycle.ts | MEDIUM -- new query + conditional SDK call |
| Policy gate (`governs_skill` traversal) | policy/policy-gate.ts | LOW -- additive graph traversal |
| Agent creation route (new body fields) | agents/agent-route.ts | LOW -- additive input validation |
| Route registration | runtime/start-server.ts | LOW -- follows existing pattern |

## Quality Gates

- [x] Requirements traced to components (architecture.md Section 5)
- [x] Component boundaries with clear responsibilities (Section 5)
- [x] Technology choices in ADRs with alternatives (ADR-001, ADR-002, ADR-003)
- [x] Quality attributes addressed: maintainability, testability, time-to-market, auditability (Section 10)
- [x] Dependency-inversion compliance: adapter port for SDK, DI for queries (Section 5)
- [x] C4 diagrams: L1, L2, L3 in Mermaid (Sections 2, 3, 4)
- [x] Integration patterns specified (Sections 7, 8)
- [x] OSS preference validated: no new dependencies (Section 9)
- [x] AC behavioral, not implementation-coupled (user stories from DISCUSS)
- [x] External integrations annotated: Sandbox Agent SDK (Section 13)
- [x] Architectural enforcement: existing conventions + code review (Section 11)

## Handoff to Acceptance Designer (DISTILL Wave)

### Architecture Document

`docs/feature/skills/design/architecture.md` -- C4 diagrams, component boundaries, data model, API design, integration patterns.

### ADRs

- ADR-001: Extend agent creation transaction
- ADR-002: Source-reference architecture
- ADR-003: Skill module follows learning system pattern

### Key Technical Decisions for AC Writing

1. Skill name uniqueness is application-layer enforced (pre-validation query)
2. Skill lifecycle: draft -> active -> deprecated (explicit endpoints, not generic PUT)
3. Agent creation validates skill status at creation time (rejects deprecated skills)
4. Session lifecycle excludes deprecated skills from `setSkillsConfig`
5. `possesses` edges preserved on deprecation (historical record)
6. Skill-derived tools resolved client-side via skill_requires edges

### External Integration Annotation

Contract tests recommended for Sandbox Agent SDK `setSkillsConfig` -- consumer-driven contracts (e.g., Pact-JS) to detect breaking changes in the SDK before production. Key contract: `SkillsConfig` shape with `sources: SkillSource[]`.

### Development Paradigm

Functional (TypeScript). No classes. Query functions with dependency injection. Route handler factories.
