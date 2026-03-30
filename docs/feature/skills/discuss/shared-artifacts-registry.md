# Shared Artifacts Registry: Skills Feature

## Artifacts

### agent_name

- **Source of truth**: Step 1 name input field (agent creation wizard)
- **Consumers**: Step 2 heading ("Assign Skills to ${agent_name}"), Step 3 heading ("Tools for ${agent_name}"), Success confirmation, Agent list page, Agent detail page
- **Owner**: Agent creation wizard (frontend state)
- **Integration risk**: LOW -- single form state, no cross-system propagation until creation
- **Validation**: Name displayed in step 2/3 headings must match step 1 input value

### runtime

- **Source of truth**: Step 1 runtime radio selection
- **Consumers**: Step 1 conditional sandbox config visibility, Step 2 external-agent banner, Step 3 skill-derived section visibility, Agent creation transaction, Success confirmation
- **Owner**: Agent creation wizard (frontend state)
- **Integration risk**: MEDIUM -- runtime drives conditional UI in multiple steps
- **Validation**: When runtime = "external", skill-derived tools section in Step 3 is hidden and Steps 2/3 show skip-friendly messaging

### selected_skills

- **Source of truth**: Step 2 skill checklist state (array of skill record IDs)
- **Consumers**: Step 3 skill-derived tools resolution (skill -> skill_requires -> mcp_tool), Agent creation transaction (possesses edges), Success confirmation
- **Owner**: Agent creation wizard (frontend state)
- **Integration risk**: HIGH -- drives both UI (step 3 tool display) and backend (possesses edges)
- **Validation**: Selected skills in Step 2 must produce matching skill-derived tools in Step 3. At creation time, all selected skills must still have status=active.

### skill_derived_tools

- **Source of truth**: Resolved from selected_skills via skill_requires edges (backend query or frontend cache)
- **Consumers**: Step 3 skill-derived tools section (read-only display with "via skill X" labels), Total effective tools count
- **Owner**: Backend (graph traversal: possesses -> skill -> skill_requires -> mcp_tool)
- **Integration risk**: HIGH -- must stay in sync with selected_skills. Stale cache could show wrong tools.
- **Validation**: When a skill is unchecked in Step 2 and user returns to Step 3, its tools must disappear from skill-derived section.

### additional_tools

- **Source of truth**: Step 3 additional tools checklist state (array of mcp_tool record IDs)
- **Consumers**: Agent creation transaction (can_use edges), Success confirmation, Total effective tools count
- **Owner**: Agent creation wizard (frontend state)
- **Integration risk**: LOW -- direct user selection, single consumer
- **Validation**: Additional tools checklist excludes tools already in skill_derived_tools to prevent double-counting

### workspace_skills_list

- **Source of truth**: GET /api/workspaces/:id/skills (backend, SurrealDB query)
- **Consumers**: Skill Library page (full list with all statuses), Agent creation Step 2 (filtered to status=active only)
- **Owner**: Skill CRUD API
- **Integration risk**: MEDIUM -- same data source but different filters in different contexts
- **Validation**: Agent creation Step 2 shows only active skills. Skill Library shows all statuses with filter.

### skill_status

- **Source of truth**: skill.status field in SurrealDB (draft | active | deprecated)
- **Consumers**: Skill Library status badge, Agent creation Step 2 visibility (only active), Session lifecycle setSkillsConfig (only active skills materialized), Skill detail page actions (Activate/Deprecate buttons)
- **Owner**: Skill lifecycle API endpoints
- **Integration risk**: HIGH -- status drives visibility across multiple systems (UI, session setup, wizard)
- **Validation**: Draft skills never appear in wizard. Deprecated skills never appear in wizard. Only active skills are passed to setSkillsConfig.

### skill_source

- **Source of truth**: skill.source object in SurrealDB (type, source, ref, subpath, skills)
- **Consumers**: Skill detail page display, Session lifecycle setSkillsConfig call (passed directly to sandbox agent SDK), Skill Library card source type icon
- **Owner**: Skill CRUD API
- **Integration risk**: HIGH -- source reference is passed directly to sandbox agent SDK at session time. Invalid source = agent cannot load skill.
- **Validation**: Source reference must be structurally valid at creation time. Sandbox agent resolves at session time.

### affected_agents

- **Source of truth**: SELECT in FROM possesses WHERE out = $skill (backend query)
- **Consumers**: Deprecation confirmation dialog (lists agent names)
- **Owner**: Graph query (possesses relation)
- **Integration risk**: LOW -- informational, not transactional
- **Validation**: Agent count on skill card matches count shown in deprecation dialog

### governs_skill_policy

- **Source of truth**: governs_skill relation in SurrealDB (policy -> skill)
- **Consumers**: Skill detail page "Governed By" section, Tool-call-time policy evaluation in Authorizer
- **Owner**: Policy system
- **Integration risk**: MEDIUM -- governance affects runtime tool-call authorization
- **Validation**: Policy shown on skill detail page must match policy evaluated at tool-call time

## Integration Checkpoints

### Checkpoint 1: Wizard State Preservation

Steps 1-3 share frontend state. Navigating back must preserve all selections. Navigating forward must carry forward.

- Step 1 -> Step 2: agent_name and runtime flow forward
- Step 2 -> Step 3: selected_skills drive skill_derived_tools resolution
- Step 3 -> Step 2 (back): selected_skills preserved
- Step 2 -> Step 1 (back): all Step 1 fields preserved

### Checkpoint 2: Skill-to-Tool Resolution

selected_skills in Step 2 must correctly resolve to skill_derived_tools in Step 3 via skill_requires edges. This is the core integration point between the two new wizard steps.

### Checkpoint 3: Atomic Agent Creation

The creation transaction must include: agent record + identity + member_of + authorized_to + possesses edges + can_use edges + proxy token (external). All or nothing.

### Checkpoint 4: Status Consistency

skill_status drives visibility in: Skill Library (all), Agent wizard Step 2 (active only), Session lifecycle (active only). Changes to status must propagate to all consumers.

### Checkpoint 5: Session Lifecycle Integration

skill_source references from active possessed skills must be passed to setSkillsConfig before session creation. This is the bridge between the governance graph and the sandbox agent runtime.
