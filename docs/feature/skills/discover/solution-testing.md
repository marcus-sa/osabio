# Solution Testing: Skills Feature (#177)

## Solution Concept: 3-Step Agent Creation Wizard

### Step 1: Agent Config (Replaces current Step 1 + Step 2)

Consolidates runtime selection and agent details into a single step:
- Runtime selection (sandbox / external) -- currently step 1
- Name, description, model -- currently step 2
- Authority scopes -- currently step 2
- Sandbox config (coding_agents, env_vars, image) -- conditionally shown for sandbox runtime

**Key change**: What is currently two screens becomes one. The runtime "cards" become a radio-group selector at the top of the form, not a separate decision screen.

### Step 2: Skills Setup (New)

- Shows all active workspace skills as a checklist
- Each skill card shows: name, description, version, source type icon (github/git)
- Checkbox to assign (`possesses` relation)
- "No skills" is a valid state -- skip button always available
- For external agents: step is shown but with a note that skills are only used by sandbox agents
- Count badge on step indicator showing assigned skills

### Step 3: Tools Setup (New)

- Two sections:
  - **Skill-derived tools** (read-only): Lists tools granted via assigned skills (`skill_requires` edges). Each shows the source skill name. Visual indicator that these are automatic grants.
  - **Additional tools** (editable): Manual tool selection from workspace `mcp_tool` catalog. These become direct `can_use` edges.
- Summary showing total effective toolset (union of both)
- For external agents: only shows "Additional tools" section (skills don't apply)

### Navigation

- Step indicators at top (1 of 3, 2 of 3, 3 of 3)
- Back button on each step
- Skip on steps 2 and 3 (equivalent to "no skills" / "no additional tools")
- Create button only on step 3

## Hypotheses

### H1: 3-Step Wizard Comprehension

```
We believe consolidating runtime + config into step 1 and adding skills (step 2) and tools (step 3)
for workspace admins will reduce agent setup confusion.
We will know this is TRUE when admins complete the wizard without backtracking to earlier steps >80% of the time.
We will know this is FALSE when admins frequently skip steps 2+3 or abandon the wizard mid-flow.
```

**Test method**: Prototype walkthrough with 3-5 scenarios (create a security audit agent, create a plain coding agent, create an external agent). Measure task completion and backtracking.

### H2: Skill Assignment During Creation is Natural

```
We believe admins will assign skills during agent creation rather than deferring to post-creation.
We will know this is TRUE when >70% of agents created via the wizard have at least 1 skill assigned.
We will know this is FALSE when >50% of agents are created with 0 skills and skills are added later.
```

**Test method**: Track skill assignment rate in wizard vs post-creation edits over first 30 days.

### H3: Skill-Derived Tool Grants are Understandable

```
We believe showing "via skill X" on tool grants will make implicit tool grants intuitive.
We will know this is TRUE when admins can correctly explain why an agent has a specific tool >80% of the time.
We will know this is FALSE when admins are confused about why certain tools appear in the tools step.
```

**Test method**: Prototype test -- after assigning 2 skills in step 2, ask admin to predict which tools will appear in step 3. Measure accuracy.

### H4: External Agents and the Skills Steps

```
We believe external agent creators will understand that skills steps are optional/irrelevant for their use case.
We will know this is TRUE when external agent creation time is not significantly longer than today's 2-step flow.
We will know this is FALSE when external agent creators express confusion about why skills/tools steps exist.
```

**Test method**: Compare external agent creation time between current 2-step and proposed 3-step. Acceptable if <20% increase.

### H5: Checklist Scales for Realistic Skill Counts

```
We believe a simple checklist UI works for up to 20 skills.
We will know this is TRUE when admins can find and assign the right skills in <30 seconds with 15 skills.
We will know this is FALSE when admins resort to scrolling/searching behavior suggesting they need filtering.
```

**Test method**: Prototype with 5, 10, 15, and 20 skill items. Measure time to assign 2-3 specific skills.

## Prototype Specification

### Scope

Interactive prototype of the 3-step wizard flow covering:
1. Step 1: Consolidated config form (runtime radio, name, description, model, scopes, sandbox config)
2. Step 2: Skill checklist with 10 sample skills
3. Step 3: Two-section tool display (skill-derived read-only, additional manual)
4. Step navigation (indicators, back, skip, create)

### Key Interactions to Test

| Interaction | What we learn |
|-------------|--------------|
| Runtime selection changes step 2/3 behavior | Does conditional content confuse? |
| Assigning a skill in step 2, seeing its tools in step 3 | Is the causal link clear? |
| Skipping step 2 entirely | Is "no skills" a comfortable choice? |
| Going back from step 3 to step 2 | Does state preservation work as expected? |
| Creating an external agent | Is the wizard flow acceptable or too heavy? |

### Test Scenarios

| # | Scenario | Expected Steps | Key Validation |
|---|----------|---------------|----------------|
| T1 | Create sandbox agent with 2 skills | 1 > 2 (select 2) > 3 (review) > Create | Full happy path, skill-derived tools visible |
| T2 | Create sandbox agent with no skills | 1 > 2 (skip) > 3 (manual tools only) > Create | Skip flow is smooth |
| T3 | Create external agent | 1 > 2 (skip, note about sandbox-only) > 3 (manual tools) > Create | External path is not annoying |
| T4 | Create agent, realize wrong skill, go back | 1 > 2 > 3 > Back to 2 > fix > 3 > Create | State preserved on backtrack |
| T5 | Create agent with skill that requires 3 tools | 1 > 2 (select 1 skill) > 3 (3 tools auto-shown) > Create | Implicit grants are visible and understandable |

## Feasibility Assessment

| Component | Feasibility | Notes |
|-----------|-------------|-------|
| 3-step wizard UI (React) | High | Existing pattern in codebase, React state machine |
| Skill CRUD backend (SurrealDB) | High | Schema defined in #177, follows learning system pattern |
| `possesses` relation creation during wizard | High | Same pattern as `authorized_to` in current `createAgentTransaction` |
| `skill_requires` edge resolution for step 3 | High | Graph traversal, similar to existing queries |
| `setSkillsConfig` adapter extension | High | Research doc confirms API surface exists |
| Skill import from GitHub/skills.sh | Medium | Requires HTTP fetch + SKILL.md parsing, deferred to post-MVP. No local source type — delegated. |
| Policy governance (`governs_skill`) | Medium | Follows policy system pattern, extends existing Authorizer evaluation |

## MVP Scope Recommendation

### MVP (Ship First)

1. **Skill CRUD API**: Create, read, update, delete skills in workspace (same pattern as learnings)
2. **3-step wizard**: Config > Skills checklist > Tools review + Create
3. **`possesses` relation**: Assigned during wizard, stored in agent creation transaction
4. **Skill-derived tool display**: Read-only view of `skill_requires` tools in step 3
5. **`setSkillsConfig` integration**: Pass source references to sandbox agent at session setup
6. **Policy governance**: `governs_skill` relation + policy evaluation at tool-call time (extends existing Authorizer)
7. **Skill library UI**: Browse, filter, view skill details (name, description, version, source, required tools, status)
8. **Agent creation step wizard**: 3-step flow (Config > Skills > Tools) replacing current 2-step form, with step indicators, back/skip navigation, and state preservation

### Post-MVP (Defer)

- Skill import from skills.sh / GitHub (tracked in existing research)
- Brain-authored skills with inline content (#200)
- Skill activation telemetry (`skill_evidence` edges)
- Observer-proposed skill updates (tracked in follow-up issue)
- Skill recommendation based on agent description
- Searchable skill catalog (upgrade from checklist when >20 skills)

## Gate G3 Evaluation

| Criterion | Status | Evidence |
|-----------|--------|---------|
| Solution concept defined | PASS | 3-step wizard with clear step responsibilities |
| 5 hypotheses with test methods | PASS | H1-H5 defined with success/failure criteria |
| Task completion estimate >80% | PASS (projected) | Similar to existing wizard, adds 2 optional steps |
| Usability approach defined | PASS | Prototype spec with 5 test scenarios |
| Core flow identified | PASS | T1 (create sandbox agent with skills) is the critical path |
| Feasibility assessed | PASS | All MVP components rated High feasibility |

**Gate G3: PROCEED to Phase 4 (Market Viability)**

### Recommended Next Action

Build a clickable prototype of the 3-step wizard and walk through scenarios T1-T5 before writing code. The highest-risk hypothesis is H1 (will the 3-step flow feel natural vs the current 2-step flow?). This can be tested with a static HTML/CSS mockup in under a day.
