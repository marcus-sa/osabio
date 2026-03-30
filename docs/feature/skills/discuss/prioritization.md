# Prioritization: Skills Feature (#177)

## Release Priority

| Priority | Release | Target Outcome | KPI | Rationale |
|----------|---------|---------------|-----|-----------|
| 1 | Walking Skeleton | End-to-end flow works: skill created -> assigned to agent -> session receives skill | Agent created with >= 1 skill | Validates core assumption: skills can flow from graph to sandbox agent |
| 2 | Release 1: Governed Skill Library | Admins manage skills confidently with lifecycle, governance, and full wizard UX | >50% sandbox agents with skills, >85% wizard completion | Delivers the full user value proposition |
| 3 | Release 2: Runtime Integration | Tool-call-time governance and MCP tool gating | Skill-governed tools pass policy evaluation | Completes the governance story |

## Backlog Suggestions

> **Note**: Stories are task-level placeholders at this stage. Story IDs (US-01) are assigned in Phase 4 (Requirements). Revisit this table after Phase 4.

| Story | Release | Priority | Outcome Link | Dependencies |
|-------|---------|----------|-------------|--------------|
| Schema migration (skill tables + relations) | WS | P1 | Foundation for all stories | None |
| Skill CRUD API (create, read, list, update, delete) | WS | P1 | KPI-1: skill creation rate | Schema migration |
| Skill checklist in wizard Step 2 | WS | P1 | KPI-2: wizard completion rate | Skill CRUD API |
| Skill-derived tools display in wizard Step 3 | WS | P1 | KPI-3: tool grant comprehension | Skill CRUD, skill_requires edges |
| Atomic agent creation with possesses edges | WS | P1 | KPI-2: wizard completion rate | Steps 2 + 3 |
| setSkillsConfig session lifecycle integration | WS | P1 | KPI-4: session skill availability | Skill CRUD, adapter extension |
| governs_skill relation (storage only) | WS | P1 | Foundation for governance | Schema migration |
| Skill lifecycle (activate, deprecate, edit) | R1 | P2 | KPI-1: skill management confidence | Skill CRUD API |
| Skill Library UI (list, filter, detail, empty states) | R1 | P2 | KPI-5: skill discovery rate | Skill CRUD API |
| Wizard polish (state preservation, error paths, external agent flow) | R1 | P2 | KPI-2: wizard completion rate | Walking skeleton wizard |
| MCP tool gating (tools/list filtering) | R2 | P3 | KPI-6: governance enforcement | governs_skill relation |
| Policy evaluation at tool-call time | R2 | P3 | KPI-6: governance enforcement | MCP tool gating |

## Prioritization Rationale

### Walking Skeleton First (Riskiest Assumption)

The riskiest assumption is that the `setSkillsConfig` integration works end-to-end: Brain passes source references through the adapter, and the sandbox agent receives and resolves them. This is the first thing to validate with working code.

### Release 1: Full UX (Highest Value)

The highest-value outcome is admins confidently managing skills and assigning them during agent creation. This is where the Lean Canvas UVP ("governed, versionable domain expertise") becomes real to users.

### Release 2: Runtime Governance (Completes Story)

MCP tool gating and policy enforcement at tool-call time are important for the governance story but do not block the primary user journey. Agents can use skills without MCP-level gating in the skeleton -- governance comes online in R2.
