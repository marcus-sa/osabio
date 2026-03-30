# Definition of Ready Validation: Skills Feature (#177)

## US-01: Skill Schema and CRUD API

| DoR Item | Status | Evidence |
|----------|--------|---------|
| Problem statement clear | PASS | "No skill entity exists -- no table, no API, no way to create/read/update/delete" |
| User/persona identified | PASS | Workspace admin (Marcus), manages skill catalog |
| 3+ domain examples | PASS | 3 examples: GitHub skill creation, list with filter, duplicate rejection |
| UAT scenarios (3-7) | PASS | 5 scenarios: create, list, reject duplicate, update, delete |
| AC derived from UAT | PASS | 7 AC items mapped from scenarios |
| Right-sized | PASS | 1-2 days: schema migration + CRUD routes following learning pattern |
| Technical notes | PASS | Schema migration details, learning system pattern reference |
| Dependencies tracked | PASS | No dependencies (foundation story) |
| Outcome KPIs defined | PASS | KPI linked to API success rate |

### DoR Status: PASSED

---

## US-02: Skill Library UI -- List and Detail

| DoR Item | Status | Evidence |
|----------|--------|---------|
| Problem statement clear | PASS | "No way to browse, filter, or inspect skills in the UI" |
| User/persona identified | PASS | Workspace admin browsing skill catalog |
| 3+ domain examples | PASS | 3 examples: browse 4 skills, filter active, view detail with governance |
| UAT scenarios (3-7) | PASS | 4 scenarios: browse, filter, detail, empty state |
| AC derived from UAT | PASS | 6 AC items |
| Right-sized | PASS | 1-2 days: list page + detail page following existing patterns |
| Technical notes | PASS | Learning library pattern, TanStack Router, agent count query |
| Dependencies tracked | PASS | Depends on US-01 (CRUD API) |
| Outcome KPIs defined | PASS | KPI-5: UI adoption rate |

### DoR Status: PASSED

---

## US-03: Skill Lifecycle Management

| DoR Item | Status | Evidence |
|----------|--------|---------|
| Problem statement clear | PASS | "Cannot activate or deprecate skills -- no lifecycle control" |
| User/persona identified | PASS | Workspace admin governing skill availability |
| 3+ domain examples | PASS | 3 examples: activate draft, deprecate with agents, deprecate without agents |
| UAT scenarios (3-7) | PASS | 4 scenarios: activate, deprecate with warning, deprecate without, edit |
| AC derived from UAT | PASS | 5 AC items |
| Right-sized | PASS | 1 day: lifecycle transitions + confirmation dialog |
| Technical notes | PASS | Learning system pattern, possesses edges preserved on deprecation |
| Dependencies tracked | PASS | Depends on US-01, US-02 |
| Outcome KPIs defined | PASS | Zero accidental deprecations |

### DoR Status: PASSED

---

## US-04: 3-Step Wizard -- Step 1 (Config)

| DoR Item | Status | Evidence |
|----------|--------|---------|
| Problem statement clear | PASS | "Runtime screen wastes a step -- cannot accommodate skill/tool steps" |
| User/persona identified | PASS | Workspace admin creating new agents |
| 3+ domain examples | PASS | 3 examples: sandbox config, external config, name collision |
| UAT scenarios (3-7) | PASS | 4 scenarios: sandbox, external, name validation, back navigation |
| AC derived from UAT | PASS | 5 AC items |
| Right-sized | PASS | 1-2 days: consolidate existing 2-step into 1-step + wizard frame |
| Technical notes | PASS | Replaces agent-create-page.tsx, reuses AuthorityScopeForm |
| Dependencies tracked | PASS | No dependencies (replaces existing code) |
| Outcome KPIs defined | PASS | >90% Step 1 completion without errors |

### DoR Status: PASSED

---

## US-05: 3-Step Wizard -- Step 2 (Skills Assignment)

| DoR Item | Status | Evidence |
|----------|--------|---------|
| Problem statement clear | PASS | "No way to assign domain expertise during creation" |
| User/persona identified | PASS | Workspace admin equipping agent at creation time |
| 3+ domain examples | PASS | 3 examples: assign 2 skills, skip, no skills available |
| UAT scenarios (3-7) | PASS | 5 scenarios: assign, skip, empty, external agent, back navigation |
| AC derived from UAT | PASS | 7 AC items |
| Right-sized | PASS | 1-2 days: checklist component + wizard step integration |
| Technical notes | PASS | API endpoint, React state, no pagination needed |
| Dependencies tracked | PASS | Depends on US-01 (skills API), US-04 (wizard frame) |
| Outcome KPIs defined | PASS | KPI-1: >70% agents with >= 1 skill |

### DoR Status: PASSED

---

## US-06: 3-Step Wizard -- Step 3 (Tools Review)

| DoR Item | Status | Evidence |
|----------|--------|---------|
| Problem statement clear | PASS | "Does not know which tools skills automatically grant -- opaque access" |
| User/persona identified | PASS | Workspace admin reviewing agent toolset |
| 3+ domain examples | PASS | 3 examples: skill-derived with provenance, add extra tools, no skills selected |
| UAT scenarios (3-7) | PASS | 5 scenarios: skill-derived display, additional, skip, no skills, shared tool |
| AC derived from UAT | PASS | 6 AC items |
| Right-sized | PASS | 1-2 days: two-section display + tool resolution logic |
| Technical notes | PASS | skill_requires resolution, workspace tools API |
| Dependencies tracked | PASS | Depends on US-01 (skill_requires edges), US-05 (Step 2 selections) |
| Outcome KPIs defined | PASS | KPI-3: >80% tool grant comprehension |

### DoR Status: PASSED

---

## US-07: Atomic Agent Creation with Skills and Tools

| DoR Item | Status | Evidence |
|----------|--------|---------|
| Problem statement clear | PASS | "Partial failure would leave agent without skills/tools -- confusing" |
| User/persona identified | PASS | Workspace admin completing creation |
| 3+ domain examples | PASS | 3 examples: full creation, no skills/tools, deprecated skill guard |
| UAT scenarios (3-7) | PASS | 4 scenarios: atomic creation, no skills, deprecated guard, confirmation |
| AC derived from UAT | PASS | 5 AC items |
| Right-sized | PASS | 1-2 days: extend existing createAgentTransaction |
| Technical notes | PASS | RELATE syntax, status validation query, depends on US-01/05/06 |
| Dependencies tracked | PASS | Depends on US-01, US-05, US-06 |
| Outcome KPIs defined | PASS | 100% of creations have all relations present |

### DoR Status: PASSED

---

## US-08: Session Lifecycle -- setSkillsConfig Integration

| DoR Item | Status | Evidence |
|----------|--------|---------|
| Problem statement clear | PASS | "Session has no access to skills -- lifecycle does not pass source refs" |
| User/persona identified | PASS | Agent starting session (admin indirect beneficiary) |
| 3+ domain examples | PASS | 3 examples: 2 skills passed, no skills, deprecated excluded |
| UAT scenarios (3-7) | PASS | 3 scenarios: active skills passed, no skills skipped, deprecated excluded |
| AC derived from UAT | PASS | 5 AC items |
| Right-sized | PASS | 1 day: adapter extension + session lifecycle integration |
| Technical notes | PASS | Research doc section 4-5, adapter interface, mock adapter |
| Dependencies tracked | PASS | Depends on US-01 (schema), US-07 (possesses edges) |
| Outcome KPIs defined | PASS | KPI-4: 100% active skills available in session |

### DoR Status: PASSED

---

## US-09: Skill Library UI -- Create Skill Form

| DoR Item | Status | Evidence |
|----------|--------|---------|
| Problem statement clear | PASS | "No UI form to create skills -- must use API directly" |
| User/persona identified | PASS | Workspace admin adding skills to catalog |
| 3+ domain examples | PASS | 3 examples: GitHub source, Git source, validation error |
| UAT scenarios (3-7) | PASS | 3 scenarios: GitHub, Git, validation |
| AC derived from UAT | PASS | 7 AC items |
| Right-sized | PASS | 1-2 days: form component with source type toggle |
| Technical notes | PASS | Policy creation form pattern, tools API, POST endpoint |
| Dependencies tracked | PASS | Depends on US-01, US-02 |
| Outcome KPIs defined | PASS | KPI-5: >90% skills created via UI |

### DoR Status: PASSED

---

## US-10: Policy Governance for Skills

| DoR Item | Status | Evidence |
|----------|--------|---------|
| Problem statement clear | PASS | "No way to enforce policies on skill usage -- no governance oversight" |
| User/persona identified | PASS | Workspace admin governing agent expertise |
| 3+ domain examples | PASS | 3 examples: detail page shows policy, relation created, tool call evaluated |
| UAT scenarios (3-7) | PASS | 3 scenarios: detail page, relation, tool call evaluation |
| AC derived from UAT | PASS | 4 AC items |
| Right-sized | PASS | 1-2 days: schema relation + Authorizer extension + detail page section |
| Technical notes | PASS | governs_skill relation, Authorizer pattern, skill_requires traversal |
| Dependencies tracked | PASS | Depends on US-01, US-02 |
| Outcome KPIs defined | PASS | KPI-6: 100% of governed tool calls evaluated |

### DoR Status: PASSED

---

## Summary

| Story | DoR Status |
|-------|-----------|
| US-01: Skill Schema and CRUD API | PASSED |
| US-02: Skill Library UI -- List and Detail | PASSED |
| US-03: Skill Lifecycle Management | PASSED |
| US-04: 3-Step Wizard -- Step 1 (Config) | PASSED |
| US-05: 3-Step Wizard -- Step 2 (Skills Assignment) | PASSED |
| US-06: 3-Step Wizard -- Step 3 (Tools Review) | PASSED |
| US-07: Atomic Agent Creation with Skills and Tools | PASSED |
| US-08: Session Lifecycle -- setSkillsConfig Integration | PASSED |
| US-09: Skill Library UI -- Create Skill Form | PASSED |
| US-10: Policy Governance for Skills | PASSED |

All 10 stories pass the 9-item Definition of Ready gate. Ready for handoff to DESIGN wave.
