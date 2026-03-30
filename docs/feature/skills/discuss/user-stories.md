<!-- markdownlint-disable MD024 -->

## US-01: Skill Schema and CRUD API

### Problem

Marcus is a workspace admin who wants to register domain expertise for his agents. He finds it impossible to do so because no skill entity exists in the system -- there is no table, no API, and no way to create, read, update, or delete skills.

### Who

- Workspace admin | Creating and managing skill catalog | Needs programmatic access to skill CRUD for both UI and future automation

### Solution

Skill table with lifecycle fields, source reference, and CRUD API endpoints following the learning system pattern.

### Domain Examples

#### 1: Create security audit skill from GitHub

Marcus creates a skill named "security-audit" with version "1.0", source type "github", repository "acme-corp/agent-skills", ref "v1.0", subpath "skills/security-audit". The skill is created with status "draft" and created_by pointing to Marcus's identity. Three skill_requires edges are created for tools read_file, search_codebase, and check_dependencies.

#### 2: List active workspace skills

Marcus requests all skills for workspace "Acme Corp" with status filter "active". The API returns 4 skills: security-audit v1.2, code-review v2.0, api-design v1.1, and database-migration v1.0. Each includes name, description, version, status, source, created_at, and created_by.

#### 3: Create skill with duplicate name rejected

Marcus tries to create a skill named "security-audit" but one already exists in the workspace. The API returns a 409 Conflict with message "A skill named 'security-audit' already exists in this workspace."

### UAT Scenarios (BDD)

#### Scenario: Create skill with source reference and required tools

Given Marcus is authenticated as workspace admin for "Acme Corp"
When he creates a skill with name "security-audit", version "1.0", source type "github", source "acme-corp/agent-skills", ref "v1.0", subpath "skills/security-audit", and required tools ["read_file", "search_codebase", "check_dependencies"]
Then the skill is created with status "draft" and created_by set to Marcus's identity
And 3 skill_requires edges link the skill to the specified tools

#### Scenario: List skills with status filter

Given the workspace has 2 active skills and 1 draft skill
When Marcus requests skills with status "active"
Then 2 skills are returned
And each includes name, description, version, status, source, and created_at

#### Scenario: Reject duplicate skill name

Given the workspace has a skill named "security-audit"
When Marcus creates a skill with name "security-audit"
Then the API returns 409 with message "A skill named 'security-audit' already exists in this workspace"

#### Scenario: Update skill metadata

Given the skill "security-audit" exists with version "1.0"
When Marcus updates it with version "1.1" and a new description
Then the skill reflects the new version and description
And updated_at is set to the current timestamp

#### Scenario: Delete skill with no agent assignments

Given the skill "legacy-migration" exists with 0 possesses edges
When Marcus deletes it
Then the skill and its skill_requires edges are removed

### Acceptance Criteria

- [ ] Skill CRUD endpoints: POST, GET (list + detail), PUT, DELETE
- [ ] Skills are workspace-scoped (workspace field required)
- [ ] Skill name is unique within a workspace
- [ ] Skills created with status "draft" by default
- [ ] skill_requires edges created/updated with skill
- [ ] Status filter on list endpoint (active, draft, deprecated, all)
- [ ] Delete removes skill and its skill_requires edges

### Outcome KPIs

- **Who**: Workspace admins
- **Does what**: Create skills via API without errors
- **By how much**: 100% of CRUD operations succeed for valid input
- **Measured by**: API response codes in acceptance tests
- **Baseline**: No skill API exists

### Technical Notes

- Schema migration required: skill table, skill_requires relation, possesses relation, skill_supersedes relation, skill_evidence relation, governs_skill relation
- Follow learning system CRUD pattern (see learning/ routes and queries)
- Source field is a nested object: { type, source, ref?, subpath?, skills? }
- No null values -- use optional fields (option<string> in schema, omitted in API)

---

## US-02: Skill Library UI — List and Detail

### Problem

Marcus is a workspace admin who has created skills via the API but has no way to browse, filter, or inspect them in the UI. He finds it frustrating to manage a growing skill catalog without a visual interface.

### Who

- Workspace admin | Managing workspace skill catalog | Needs a browsable, filterable view of all skills

### Solution

Skill Library page with card-based list, status filter, and detail page showing full skill metadata, required tools, assigned agents, and governance info.

### Domain Examples

#### 1: Browse library with 4 skills

Marcus navigates to the Skill Library. He sees 4 cards: "security-audit v1.2 (active, 3 agents)", "code-review v2.0 (active, 5 agents)", "api-design v1.1 (active, 1 agent)", and "legacy-migration v0.9 (draft, 0 agents)". Each card shows source type icon (github or git).

#### 2: Filter to active skills only

Marcus selects the "Active" filter. The list shows 3 skills, hiding the draft "legacy-migration".

#### 3: View skill detail with governance

Marcus clicks "security-audit". The detail page shows: description, source (GitHub: acme-corp/agent-skills @ v1.2, subpath: skills/security-audit), required tools (read_file, search_codebase, check_dependencies), agents using it (security-auditor, compliance-checker, pen-tester), and governed by policy "Security Tool Access" (active).

### UAT Scenarios (BDD)

#### Scenario: Browse skill library

Given the workspace "Acme Corp" has 4 skills (2 active, 1 draft, 1 deprecated)
When Marcus navigates to the Skill Library
Then he sees 4 skill cards
And each card shows name, version, status badge, description excerpt, source type icon, and agent count

#### Scenario: Filter by status

Given the library shows 4 skills
When Marcus selects "Active" filter
Then only 2 active skills are displayed

#### Scenario: View skill detail page

Given the skill "security-audit" v1.2 is active, assigned to 3 agents, governed by "Security Tool Access"
When Marcus clicks on "security-audit"
Then the detail page shows source info, required tools, assigned agents with names, and governing policy

#### Scenario: Empty skill library

Given the workspace has no skills
When Marcus navigates to the Skill Library
Then an empty state reads "No skills yet. Skills give your agents domain expertise."
And a "Create Skill" button is prominently shown

### Acceptance Criteria

- [ ] Skill Library page accessible from main navigation
- [ ] Card list with name, version, status, description, source type, agent count
- [ ] Status filter (all, active, draft, deprecated)
- [ ] Skill detail page with full metadata, required tools, agents, governance
- [ ] Empty state with guidance and create action
- [ ] Agent count derived from possesses edge count

### Outcome KPIs

- **Who**: Workspace admins
- **Does what**: Browse and inspect skills without using the API directly
- **By how much**: 100% of skill metadata visible in UI
- **Measured by**: UI renders all fields returned by skill API
- **Baseline**: No skill UI exists

### Technical Notes

- Follow existing page patterns (learning library, policy management)
- TanStack Router for navigation
- Skill detail page: /workspaces/:id/skills/:skillId
- Agent count query: SELECT count() FROM possesses WHERE out = $skill

---

## US-03: Skill Lifecycle Management

### Problem

Marcus is a workspace admin who created skills as drafts but cannot activate them for agent use, and cannot deprecate skills that are outdated. He finds it risky to have no lifecycle control over expertise that agents rely on.

### Who

- Workspace admin | Governing skill availability | Needs to control when skills become available and when they are retired

### Solution

Skill lifecycle transitions: draft -> active (makes skill available for assignment), active -> deprecated (removes from wizard and future sessions). Deprecation warns about affected agents.

### Domain Examples

#### 1: Activate a draft skill

Marcus has a draft skill "compliance-check" v1.0. He reviews it, confirms the source reference is correct, and clicks "Activate". The skill status changes to "active" and it now appears in the agent creation wizard Step 2.

#### 2: Deprecate a skill assigned to 3 agents

Marcus clicks "Deprecate" on "security-audit" which is assigned to agents security-auditor, compliance-checker, and pen-tester. A confirmation dialog lists the 3 affected agents and warns that the skill will be excluded from their future sessions. Marcus confirms.

#### 3: Deprecate a skill with no agents

Marcus deprecates "legacy-migration" which has 0 agents. No confirmation dialog is shown -- the skill is deprecated immediately.

### UAT Scenarios (BDD)

#### Scenario: Activate draft skill

Given the skill "compliance-check" has status "draft"
When Marcus clicks "Activate"
Then the status changes to "active"
And the skill appears in agent creation wizard Step 2

#### Scenario: Deprecate skill with affected agents

Given the skill "security-audit" is active and assigned to agents "security-auditor", "compliance-checker", "pen-tester"
When Marcus clicks "Deprecate"
Then a confirmation dialog lists 3 affected agents by name
When Marcus confirms
Then the status changes to "deprecated"
And the skill no longer appears in the agent creation wizard

#### Scenario: Deprecate skill with no agents skips confirmation

Given the skill "legacy-migration" is active with 0 possesses edges
When Marcus clicks "Deprecate"
Then the status changes to "deprecated" immediately without confirmation

#### Scenario: Edit skill updates metadata

Given the skill "security-audit" exists with version "1.0"
When Marcus edits it with version "1.1" and updated description
Then the skill reflects new version and description
And updated_at is set

### Acceptance Criteria

- [ ] Activate: draft -> active transition available on detail page
- [ ] Deprecate: active -> deprecated with agent impact warning
- [ ] Deprecation confirmation dialog shows affected agent names when count > 0
- [ ] Deprecated skills excluded from wizard Step 2 and setSkillsConfig
- [ ] Edit updates metadata fields and updated_at timestamp

### Outcome KPIs

- **Who**: Workspace admins
- **Does what**: Manage skill lifecycle confidently (activate, deprecate, edit)
- **By how much**: Zero accidental deprecations (confirmation dialog prevents)
- **Measured by**: Deprecation always preceded by confirmation when agents affected
- **Baseline**: No lifecycle management exists

### Technical Notes

- Lifecycle follows learning system pattern (draft -> active -> deprecated)
- Deprecation does NOT delete possesses edges (historical record preserved)
- Affected agents query: SELECT in.name FROM possesses WHERE out = $skill

---

## US-04: 3-Step Agent Creation Wizard — Step 1 (Config)

### Problem

Marcus is a workspace admin who currently uses a 2-step wizard (runtime selection + form). The runtime screen is a separate step with two large cards, which wastes a step that could be a radio group. He finds the current flow reasonable but it cannot accommodate skill and tool assignment steps without feeling too long.

### Who

- Workspace admin | Creating new agents | Needs a consolidated first step that combines runtime selection with agent config

### Solution

Merge current Step 1 (runtime cards) and Step 2 (form) into a single Config step with runtime as a radio group at the top, followed by name, description, model, authority scopes, and conditional sandbox config.

### Domain Examples

#### 1: Configure sandbox agent

Marcus selects "Sandbox" runtime, enters name "security-auditor", description "Performs security audits", selects model "claude-sonnet-4-20250514", sets authority scopes, enters sandbox config (coding agent, env vars). He clicks "Next" to proceed to Step 2.

#### 2: Configure external agent

Marcus selects "External" runtime, enters name "ci-scanner", selects model. Sandbox config fields are hidden. He clicks "Next".

#### 3: Name collision detected

Marcus enters "security-auditor" but an agent with that name already exists. An inline error appears when the field loses focus: "An agent named 'security-auditor' already exists." The "Next" button remains disabled.

### UAT Scenarios (BDD)

#### Scenario: Sandbox agent config with all fields

Given Marcus is on Step 1 of Create Agent
When he selects "Sandbox" runtime
And enters name "security-auditor" and description
And selects model and configures authority scopes
Then sandbox config fields (coding agents, env vars) are visible
And the "Next" button is enabled

#### Scenario: External agent hides sandbox fields

Given Marcus is on Step 1
When he selects "External" runtime
Then sandbox config fields are hidden

#### Scenario: Name uniqueness validated on blur

Given an agent named "security-auditor" exists
When Marcus enters "security-auditor" and tabs away
Then inline error "An agent named 'security-auditor' already exists" appears
And "Next" is disabled

#### Scenario: Step 1 state preserved on back navigation

Given Marcus completed Step 1 with name "security-auditor" and Sandbox runtime
And navigated to Step 2 then clicked "Back"
Then all Step 1 fields retain their values

### Acceptance Criteria

- [ ] Runtime is a radio group (Sandbox / External), not a separate step
- [ ] Sandbox config fields shown conditionally when Sandbox selected
- [ ] Agent name uniqueness validated on blur (API call)
- [ ] "Next" button enabled only when required fields are filled and valid
- [ ] Step 1 state preserved when navigating back from later steps

### Outcome KPIs

- **Who**: Workspace admins
- **Does what**: Complete Step 1 without confusion about what goes where
- **By how much**: >90% complete Step 1 without errors on first attempt
- **Measured by**: Step 1 -> Step 2 navigation rate without backtracking
- **Baseline**: Current 2-step wizard (baseline: measure before replacing)

### Technical Notes

- Replaces current agent-create-page.tsx 2-step flow with 3-step flow
- Step 1 consolidates current RuntimeSelectionStep + AgentFormStep
- Existing AuthorityScopeForm component reused as-is
- Name check uses existing agent/check-name API endpoint

---

## US-05: 3-Step Wizard — Step 2 (Skills Assignment)

### Problem

Marcus is a workspace admin creating a new agent who has no way to assign domain expertise during creation. He finds it inefficient to create agents as blank slates and then manually configure expertise afterward.

### Who

- Workspace admin | Equipping agent with skills at creation time | Needs a checklist of active workspace skills to assign

### Solution

Step 2 of the wizard shows a checklist of active workspace skills. Each item shows name, version, description, and source type. Marcus checks skills to assign. Count badge updates. Step is skippable.

### Domain Examples

#### 1: Assign 2 skills for security agent

Marcus sees 4 active skills. He checks "security-audit" and "code-review". The count badge shows "2 skills selected". He clicks "Next" to proceed to Step 3.

#### 2: Skip skills for a general-purpose agent

Marcus is creating a general coding agent that does not need specific expertise. He clicks "Skip" on Step 2 and proceeds to Step 3 with zero skills.

#### 3: No skills available in workspace

Marcus reaches Step 2 but the workspace has no active skills. An empty state reads "No skills in this workspace yet. Create skills in the Skill Library." with a link. "Skip" is the primary action.

### UAT Scenarios (BDD)

#### Scenario: Assign skills from checklist

Given Marcus is on Step 2 for sandbox agent "security-auditor"
And the workspace has 4 active skills
When he checks "security-audit" and "code-review"
Then the count badge shows "2 skills selected"
And "Next" is enabled

#### Scenario: Skip skills

Given Marcus is on Step 2
When he clicks "Skip"
Then he advances to Step 3 with 0 skills selected

#### Scenario: Empty skills state

Given the workspace has no active skills
When Marcus reaches Step 2
Then an empty state is displayed with a link to the Skill Library
And "Skip" is the primary action

#### Scenario: External agent sees skip-friendly messaging

Given Marcus selected "External" runtime in Step 1
When he reaches Step 2
Then a muted banner reads "Skills are only used by sandbox agents"
And "Skip" is the primary action

#### Scenario: Back to Step 2 preserves selections

Given Marcus selected "security-audit" and "code-review" in Step 2
And navigated to Step 3 then clicked "Back"
Then "security-audit" and "code-review" are still checked

### Acceptance Criteria

- [ ] Step 2 shows only active workspace skills as a checklist
- [ ] Each skill card: name, version, description, source type icon
- [ ] Count badge updates on check/uncheck
- [ ] "Skip" advances to Step 3 with zero skills
- [ ] Empty state when no active skills with link to Skill Library
- [ ] External agent runtime shows skip-friendly messaging
- [ ] Selections preserved on back navigation from Step 3

### Outcome KPIs

- **Who**: Workspace admins creating sandbox agents
- **Does what**: Assign at least 1 skill during agent creation
- **By how much**: >70% of sandbox agents created with >= 1 skill
- **Measured by**: possesses edge count per agent at creation time
- **Baseline**: 0% (no skill assignment exists)

### Technical Notes

- Fetches active skills: GET /api/workspaces/:id/skills?status=active
- Selected skills stored in wizard state (React state / Zustand)
- No pagination needed for MVP (<20 skills per workspace)
- skill_requires edges are NOT created here -- they exist on the skill record

---

## US-06: 3-Step Wizard — Step 3 (Tools Review)

### Problem

Marcus is a workspace admin who assigned skills in Step 2 but does not know which tools those skills automatically grant. He finds it opaque when agents have tool access he did not explicitly configure.

### Who

- Workspace admin | Reviewing and configuring agent toolset | Needs transparency about skill-derived tool grants and ability to add extra tools

### Solution

Step 3 shows two sections: (1) Skill-derived tools (read-only, shows "via skill X" labels), (2) Additional tools (editable checklist of workspace tools not covered by skills). Summary shows total effective tools.

### Domain Examples

#### 1: Review skill-derived tools with provenance

Marcus selected "security-audit" and "code-review" in Step 2. Step 3 shows skill-derived tools: read_file (via security-audit), search_codebase (via security-audit, code-review), check_dependencies (via security-audit), run_linter (via code-review). These are displayed as read-only.

#### 2: Add extra tools manually

Marcus also wants this agent to post comments on PRs. In the "Additional tools" section, he checks "post_comment" and "create_branch". The summary shows "6 total tools (4 from skills + 2 additional)".

#### 3: No skills selected — only additional tools

Marcus skipped Step 2 (no skills). Step 3 shows no skill-derived section. Only the "Additional tools" section is visible.

### UAT Scenarios (BDD)

#### Scenario: Skill-derived tools displayed with source labels

Given Marcus selected "security-audit" and "code-review" in Step 2
When he arrives at Step 3
Then the skill-derived section shows 4 tools with "via" labels indicating source skill
And the section is read-only

#### Scenario: Select additional tools

Given Marcus is on Step 3 with 4 skill-derived tools
And the workspace has tools "create_branch, merge_pr, post_comment, deploy_staging" not covered by skills
When he checks "create_branch" and "post_comment"
Then the summary shows "6 total tools (4 from skills + 2 additional)"

#### Scenario: Skip additional tools

Given Marcus is on Step 3
When he clicks "Skip"
Then agent creation proceeds with only skill-derived tools

#### Scenario: No skills selected shows only additional tools

Given Marcus skipped Step 2 (no skills selected)
When he arrives at Step 3
Then no skill-derived section is displayed
And only the additional tools checklist is shown

#### Scenario: Shared tool not double-counted

Given skill "security-audit" requires "search_codebase" and skill "code-review" also requires "search_codebase"
When Marcus views Step 3
Then "search_codebase" appears once in skill-derived section with label "via security-audit, code-review"

### Acceptance Criteria

- [ ] Skill-derived tools section: read-only, shows "via skill X" labels
- [ ] Tools shared by multiple skills listed once with all source skill names
- [ ] Additional tools section: editable checklist excluding skill-derived tools
- [ ] Total effective tools summary (N from skills + M additional)
- [ ] Skip advances to creation with only skill-derived tools (no additional)
- [ ] No skill-derived section when zero skills selected

### Outcome KPIs

- **Who**: Workspace admins
- **Does what**: Correctly explain why an agent has specific tools (comprehension test)
- **By how much**: >80% comprehension of implicit tool grants
- **Measured by**: Prototype user testing (H3 hypothesis)
- **Baseline**: No tool provenance information exists

### Technical Notes

- Skill-derived tools resolved via: selected_skills -> skill_requires -> mcp_tool
- Resolution can be client-side (skills already fetched with tool edges) or via API
- Additional tools: GET /api/workspaces/:id/tools minus skill-derived tools
- "Create Agent" button replaces "Next" on Step 3

---

## US-07: Atomic Agent Creation with Skills and Tools

### Problem

Marcus is a workspace admin completing the 3-step wizard who needs the agent to be created with all its relations (identity, skills, tools, authority) in a single atomic transaction. He would find it confusing if the agent existed but its skills or tools were missing due to a partial failure.

### Who

- Workspace admin | Completing agent creation | Needs atomic creation guaranteeing all-or-nothing

### Solution

Extend the existing createAgentTransaction to include possesses edges (skills) and can_use edges (additional tools) alongside agent record, identity, member_of, authorized_to, and proxy token.

### Domain Examples

#### 1: Create agent with 2 skills and 2 additional tools

Marcus clicks "Create Agent" after configuring: name "security-auditor", runtime "sandbox", skills [security-audit, code-review], additional tools [create_branch, post_comment]. The transaction creates: agent record, identity, member_of edge, 11 authorized_to edges, 2 possesses edges, 2 can_use edges. Success confirmation shows all counts.

#### 2: Create agent with no skills and no tools

Marcus skipped Steps 2 and 3. The transaction creates: agent record, identity, member_of edge, authorized_to edges. Zero possesses and can_use edges. Success confirmation shows Skills: 0, Tools: 0.

#### 3: Skill deprecated between Step 2 and creation

Marcus selected "security-audit" in Step 2, but it was deprecated while he was on Step 3. When he clicks "Create Agent", the transaction validates all selected skills are active. It returns an error: "Skill 'security-audit' was deprecated. Go back to update your selection." The agent is not created.

### UAT Scenarios (BDD)

#### Scenario: Atomic creation with skills and tools

Given Marcus completed the wizard with name "security-auditor", 2 skills, 2 additional tools
When he clicks "Create Agent"
Then the agent is created atomically with identity, member_of, authorized_to, 2 possesses, and 2 can_use edges
And success confirmation shows Runtime: Sandbox, Skills: 2, Tools: 6

#### Scenario: Creation with no skills or tools

Given Marcus skipped Steps 2 and 3
When he clicks "Create Agent"
Then the agent is created with zero possesses and zero can_use edges

#### Scenario: Deprecated skill blocks creation

Given Marcus selected skill "security-audit" which was deprecated after Step 2
When he clicks "Create Agent"
Then an error reads "Skill 'security-audit' was deprecated. Go back to update your selection."
And the agent is not created

#### Scenario: Success confirmation displays summary

Given Marcus created an agent with 2 skills and 2 additional tools
Then the success confirmation shows:
  | field   | value                              |
  | Runtime | Sandbox                            |
  | Skills  | 2 (security-audit, code-review)    |
  | Tools   | 6 (4 skill-derived + 2 additional) |

### Acceptance Criteria

- [ ] Transaction includes possesses edges for selected skills
- [ ] Transaction includes can_use edges for additional tools
- [ ] Transaction validates all selected skills are still active
- [ ] Failure rolls back entire transaction (no partial state)
- [ ] Success confirmation shows runtime, skill count, tool count

### Outcome KPIs

- **Who**: Workspace admins
- **Does what**: Create agents with skills in a single action
- **By how much**: 100% of successful creations have all relations present
- **Measured by**: Post-creation query: agent has correct possesses + can_use edge counts
- **Baseline**: Agent creation has no possesses edges

### Technical Notes

- Extends existing createAgentTransaction in agent-queries.ts
- Add possesses edges: RELATE $identity->possesses->$skill SET granted_at = time::now()
- Add can_use edges: RELATE $identity->can_use->$tool
- Skill status validation query: SELECT status FROM $skills WHERE status != "active"
- Depends on: US-01 (schema), US-05 (Step 2), US-06 (Step 3)

---

## US-08: Session Lifecycle — setSkillsConfig Integration

### Problem

Marcus created an agent with skills assigned, but when the agent starts a session, it has no access to those skills. The session lifecycle does not pass skill source references to the sandbox agent SDK.

### Who

- Workspace admin (indirect) | Agent starting a session | Skills must be available to the sandbox agent at session start

### Solution

Extend the session lifecycle to resolve the agent's active skills (via possesses edges) and call adapter.setSkillsConfig with the source references before session creation.

### Domain Examples

#### 1: Session starts with 2 skills

Agent "security-auditor" has skills security-audit (github: acme-corp/agent-skills @ v1.2, subpath: skills/security-audit) and code-review (github: acme-corp/agent-skills @ v2.0, subpath: skills/code-review). When a session starts, setSkillsConfig is called with both source references. The sandbox agent resolves and loads them.

#### 2: Session starts with no skills

Agent "general-coder" has no skills. setSkillsConfig is not called. Session starts normally with no skill sources.

#### 3: One of two skills is deprecated

Agent "security-auditor" has skills security-audit (active) and legacy-scan (deprecated). setSkillsConfig is called with only the active skill (security-audit). The deprecated skill is excluded.

### UAT Scenarios (BDD)

#### Scenario: Pass active skill sources to sandbox agent

Given agent "security-auditor" possesses skills "security-audit" (active) and "code-review" (active)
When a session is assigned to the agent
Then adapter.setSkillsConfig is called with 2 source references
And each source contains type, source, ref, and subpath from the skill record

#### Scenario: Skip setSkillsConfig when no skills

Given agent "general-coder" has no skills
When a session is assigned
Then adapter.setSkillsConfig is not called

#### Scenario: Exclude deprecated skills from session

Given agent "security-auditor" possesses "security-audit" (active) and "legacy-scan" (deprecated)
When a session is assigned
Then adapter.setSkillsConfig is called with only "security-audit" source reference

### Acceptance Criteria

- [ ] Session lifecycle resolves agent's active skills via possesses + status=active
- [ ] adapter.setSkillsConfig called with source references before session creation
- [ ] Deprecated skills excluded from setSkillsConfig call
- [ ] setSkillsConfig not called when agent has zero active skills
- [ ] Adapter interface extended with setSkillsConfig and deleteSkillsConfig

### Outcome KPIs

- **Who**: Sandbox agents with skills assigned
- **Does what**: Receive skill source references at session start
- **By how much**: 100% of active possessed skills available in session
- **Measured by**: Acceptance test verifying setSkillsConfig call arguments
- **Baseline**: No skills passed to sessions

### Technical Notes

- Extend SandboxAgentAdapter with setSkillsConfig (see research doc section 4)
- Query: SELECT out.* FROM possesses WHERE in = $identity AND out.status = "active"
- Called in session-lifecycle.ts before adapter.createSession()
- Mock adapter stores configs in a Map for testing
- Depends on: US-01 (schema), US-07 (possesses edges created)

---

## US-09: Skill Library UI — Create Skill Form

### Problem

Marcus is a workspace admin who wants to add new skills to the library but has no UI form to do so. He finds it inconvenient to use the API directly for every skill creation.

### Who

- Workspace admin | Adding skills to workspace catalog | Needs a form to create skills with source references and required tools

### Solution

Create Skill form accessible from the Skill Library page. Fields: name, description, version, source type (GitHub/Git radio), repository/URL, ref, subpath, and required tools checklist from workspace mcp_tool catalog.

### Domain Examples

#### 1: Create GitHub-sourced skill

Marcus clicks "Create Skill", enters name "api-design", description "REST and GraphQL API design following OpenAPI standards", version "1.0", selects GitHub source type, enters repo "acme-corp/agent-skills", ref "v1.1", subpath "skills/api-design". He checks required tools "read_file" and "write_file". Clicks Create. Skill appears in library as draft.

#### 2: Create Git-sourced skill from internal repo

Marcus selects Git source type, enters URL "https://internal.example.com/skills.git", ref "main", subpath "skills/database-migration". No required tools selected. Skill created with 0 skill_requires edges.

#### 3: Form validation rejects missing required fields

Marcus tries to submit without filling in name. The form shows inline errors on required fields (name, description, version, source).

### UAT Scenarios (BDD)

#### Scenario: Create skill from GitHub source

Given Marcus clicks "Create Skill" in the Skill Library
When he fills in name "api-design", description, version "1.0"
And selects GitHub source, repo "acme-corp/agent-skills", ref "v1.1", subpath "skills/api-design"
And checks tools "read_file" and "write_file"
And clicks "Create Skill"
Then the skill appears in the library with status "draft"
And 2 skill_requires edges are created

#### Scenario: Create skill from git source

Given Marcus clicks "Create Skill"
When he selects Git source and enters URL, ref, subpath
And fills in name, description, version
And clicks "Create Skill"
Then the skill is created with source type "git"

#### Scenario: Required field validation

Given Marcus is on the Create Skill form
When he clicks "Create Skill" without filling in the name
Then inline error "Name is required" appears on the name field
And the skill is not created

### Acceptance Criteria

- [ ] Create Skill form accessible from Skill Library page
- [ ] Fields: name, description, version, source type, repo/URL, ref, subpath
- [ ] Source type toggle (GitHub / Git) changes field labels appropriately
- [ ] Required tools checklist from workspace mcp_tool catalog
- [ ] Inline validation for required fields
- [ ] Created skill defaults to "draft" status
- [ ] Redirect to Skill Library on success

### Outcome KPIs

- **Who**: Workspace admins
- **Does what**: Create skills through the UI instead of the API
- **By how much**: >90% of skills created via UI (vs raw API)
- **Measured by**: Creation source tracking (UI vs API)
- **Baseline**: 0% UI creation (no form exists)

### Technical Notes

- Form component follows existing patterns (e.g., policy creation form)
- Source type determines field labels: "Repository" (GitHub) vs "URL" (Git)
- Required tools list: GET /api/workspaces/:id/tools (mcp_tool catalog)
- POST /api/workspaces/:id/skills on submit
- Depends on: US-01 (CRUD API), US-02 (Library page)

---

## US-10: Policy Governance for Skills

### Problem

Marcus is a workspace admin who assigned skills to agents but has no way to enforce policies on skill usage. He finds it concerning that any agent with a skill can use its tools without governance oversight.

### Who

- Workspace admin | Governing agent expertise | Needs policy enforcement on skill-derived tool access

### Solution

governs_skill relation linking policies to skills. Skill detail page shows governing policies. At tool-call time, the Authorizer checks if the tool's source skill has a governing policy and evaluates it.

### Domain Examples

#### 1: Skill detail shows governing policy

Marcus views the "security-audit" skill detail page. The "Governed By" section shows "Security Tool Access (active)". Clicking the policy name navigates to the policy detail page.

#### 2: governs_skill relation created

Marcus links the policy "Security Tool Access" to skill "security-audit" via the governs_skill relation. The relation is stored in the graph.

#### 3: Tool call evaluated against skill policy

Agent "security-auditor" calls tool "check_dependencies" which came from skill "security-audit". The Authorizer resolves the source skill, finds governing policy "Security Tool Access", and evaluates the intent against it.

### UAT Scenarios (BDD)

#### Scenario: Skill detail page shows governance

Given skill "security-audit" is governed by policy "Security Tool Access"
When Marcus views the skill detail page
Then the "Governed By" section shows "Security Tool Access (active)"
And the policy name is a link to the policy detail page

#### Scenario: governs_skill relation stored

Given policy "Security Tool Access" exists and skill "security-audit" exists
When the governs_skill relation is created
Then the relation links the policy to the skill in the graph

#### Scenario: Tool call evaluated against governing policy

Given agent "security-auditor" possesses skill "security-audit"
And skill "security-audit" is governed by policy "Security Tool Access"
When the agent calls tool "check_dependencies" (from skill "security-audit")
Then the Authorizer evaluates the intent against "Security Tool Access"

### Acceptance Criteria

- [ ] governs_skill relation table in schema
- [ ] Skill detail page shows governing policies with links
- [ ] Authorizer resolves source skill for tool calls via skill_requires edges
- [ ] Policy evaluation at tool-call time for skill-derived tools

### Outcome KPIs

- **Who**: Workspace admins
- **Does what**: Enforce policies on skill-derived tool usage
- **By how much**: 100% of skill-derived tool calls pass through policy evaluation when a governing policy exists
- **Measured by**: Authorizer logs showing policy evaluation for skill-governed tools
- **Baseline**: No governance on skill-derived tools

### Technical Notes

- governs_skill is TYPE RELATION IN policy OUT skill (schema already drafted in #177)
- Authorizer extension: tool -> skill_requires <- skill -> governs_skill -> policy
- Skill detail page query: SELECT in.* FROM governs_skill WHERE out = $skill
- Policy evaluation follows existing Authorizer pattern
- Depends on: US-01 (schema), US-02 (detail page)
