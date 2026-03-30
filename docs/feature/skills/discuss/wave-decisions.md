# DISCUSS Decisions -- skills

## Key Decisions

- [D6] 10 user stories organized into Walking Skeleton (7 stories) + Release 1 (3 stories): Walking skeleton delivers end-to-end flow from skill creation to session setup. Release 1 adds lifecycle, full library UI, and governance enforcement.
- [D7] Wizard Steps 2 and 3 are separate stories (US-05, US-06) rather than one combined story: each step has distinct user outcomes (skill assignment vs tool review) and can be independently tested and demonstrated.
- [D8] Atomic creation (US-07) is a separate story from wizard UI: backend transaction logic is independent of frontend step components and needs its own acceptance tests.
- [D9] Session lifecycle integration (US-08) is in the Walking Skeleton: this is the riskiest assumption (setSkillsConfig works end-to-end) and must be validated early.
- [D10] Policy governance (US-10) is split: governs_skill relation storage is in Walking Skeleton, policy evaluation at tool-call time is in Release 1.
- [D11] Skill Library UI split into list/detail (US-02) and create form (US-09): allows the list page to ship with API-created skills while the form follows.
- [D12] No MCP tool gating in Walking Skeleton: deferred to Release 2. Agents can use skills without MCP-level filtering in the first release -- governance comes online incrementally.
- [D13] North Star KPI is "Agents with skills assigned" (>50% of sandbox agents): this is the single metric that indicates the feature delivers its core value.

## Inherited from DISCOVER

- [D1] 3-step wizard (Config > Skills > Tools) -- mirrors conceptual layers
- [D2] Minimal checklist for skill assignment in Step 2
- [D3] Two-section tool display in Step 3 (skill-derived read-only + manual selection)
- [D4] Steps 2 and 3 are skippable
- [D5] Runtime selection consolidated into Step 1 as radio group

## Constraints Carried Forward

- Skills CRUD follows learning system pattern (lifecycle, governance, JIT loading)
- Source-reference architecture only -- Brain stores metadata + source pointer
- LLM-driven activation -- Brain controls availability, not activation
- Agent creation transaction must remain atomic
- No local skill sources in MVP -- only github and git
- No null values -- omit optional fields
- Functional paradigm (TypeScript)

## Story Dependencies

```
US-01 (Schema + CRUD)
  |
  +-- US-02 (Library UI: List + Detail)
  |     +-- US-03 (Lifecycle Management)
  |     +-- US-09 (Create Skill Form)
  |     +-- US-10 (Policy Governance)
  |
  +-- US-04 (Wizard Step 1: Config)
  |     +-- US-05 (Wizard Step 2: Skills) --- depends on US-01
  |           +-- US-06 (Wizard Step 3: Tools) --- depends on US-01 (skill_requires)
  |                 +-- US-07 (Atomic Creation) --- depends on US-05, US-06
  |
  +-- US-08 (Session Lifecycle) --- depends on US-07 (possesses edges)
```

## Delivery Order (Suggested)

### Walking Skeleton (4-5 days)

1. US-01: Schema migration + CRUD API
2. US-04: Wizard Step 1 (Config consolidation)
3. US-05: Wizard Step 2 (Skills checklist)
4. US-06: Wizard Step 3 (Tools review)
5. US-07: Atomic agent creation with possesses + can_use
6. US-08: Session lifecycle setSkillsConfig
7. US-10 (partial): governs_skill relation in schema

### Release 1 (4-5 days)

8. US-02: Skill Library UI (list, filter, detail, empty states)
9. US-09: Create Skill form
10. US-03: Lifecycle management (activate, deprecate, edit)
11. US-10 (complete): Policy evaluation at tool-call time

## Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| setSkillsConfig SDK integration fails | Low | High | Research doc confirms API exists; walking skeleton validates early |
| 3-step wizard increases agent creation abandonment | Medium | Medium | Steps 2+3 are skippable; measure completion rate vs baseline |
| Implicit tool grants confuse admins (H3) | Medium | Medium | "via skill X" labels; prototype validation recommended |
| Skill checklist doesn't scale beyond 20 skills | Low | Low | Checklist is MVP-appropriate; searchable catalog deferred |

## Handoff Package for DESIGN Wave

- Journey artifacts: 2 visual journeys (agent creation, skill library) + 2 YAML schemas + 2 Gherkin feature files
- Story map with walking skeleton and release slices
- 10 user stories with BDD acceptance criteria (all DoR PASSED)
- Shared artifacts registry with 10 tracked artifacts and 5 integration checkpoints
- Outcome KPIs with measurement plan
- Research document: skills-sandbox-agent-integration.md (SDK integration details)
- DISCOVER artifacts: opportunity tree, solution testing, lean canvas
