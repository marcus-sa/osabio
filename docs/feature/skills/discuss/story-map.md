# Story Map: Skills Feature (#177)

## User: Marcus (Workspace Admin)
## Goal: Equip agents with governed domain expertise so they perform specialized work from their first session

## Backbone

| Create Skills | Browse Skills | Assign Skills (Wizard) | Review Tools (Wizard) | Create Agent | Session Uses Skills | Govern Skills |
|---------------|---------------|------------------------|----------------------|--------------|---------------------|---------------|
| Schema migration | List skills with filter | Skill checklist (Step 2) | Skill-derived tools (Step 3) | Atomic creation with possesses + can_use | setSkillsConfig integration | governs_skill relation |
| Skill CRUD API | Skill detail page | External agent skip path | Additional tools selection | Wizard state preservation | MCP tool gating | Policy evaluation at tool-call |
| Required tools (skill_requires) | Empty state | Empty skills state | Skip additional tools | Success confirmation | | Skill detail shows governance |
| Skill lifecycle (activate/deprecate) | Agent count per skill | Back navigation preserves state | Tool provenance labels ("via skill X") | Deprecated skill guard | | |
| Edit skill | Status filter | | Total effective tools summary | | | |
| Deprecate with agent warning | | | | | | |
| Skill name uniqueness | | | | | | |

---

### Walking Skeleton

The thinnest end-to-end slice that connects all activities:

1. **Create Skills**: Schema migration + Skill CRUD API (create with source ref and required tools)
2. **Browse Skills**: List skills (no filter, no detail page)
3. **Assign Skills**: Skill checklist in wizard Step 2 (happy path only)
4. **Review Tools**: Skill-derived tools display in Step 3 (read-only section only)
5. **Create Agent**: Atomic creation with possesses edges
6. **Session Uses Skills**: setSkillsConfig passes source refs to sandbox agent
7. **Govern Skills**: governs_skill relation stored (policy evaluation deferred to R1)

This skeleton delivers: admin creates a skill, assigns it to a new agent, and the agent's session receives the skill source reference. Minimal UI, no lifecycle management, no error paths.

### Release 1: Governed Skill Library

Adds the management and governance layer on top of the skeleton:

- **Create Skills**: Skill lifecycle (activate/deprecate), edit skill, required tools management, skill name uniqueness
- **Browse Skills**: Status filter, skill detail page, agent count per skill, empty state
- **Assign Skills**: External agent skip path, empty skills state, back navigation preserves state
- **Review Tools**: Additional tools selection, "via skill X" provenance labels, total effective tools summary, skip additional tools
- **Create Agent**: Wizard state preservation (back/forward), success confirmation with summary, deprecated skill guard
- **Govern Skills**: Policy evaluation at tool-call time, skill detail shows governance info

### Release 2: Runtime Integration (Post-MVP)

- **Session Uses Skills**: MCP tool gating (tools/list filtering based on skill_requires)
- **Create Skills**: Deprecate with agent warning dialog
- **Browse Skills**: Version history display

## Scope Assessment: PASS -- 10 stories (see below), 3 bounded contexts (skill CRUD, agent wizard, session lifecycle), estimated 8-10 days

The feature is right-sized for a single delivery cycle with two release slices. The walking skeleton can ship in 4-5 days; Release 1 adds 4-5 days.
