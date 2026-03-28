<!-- markdownlint-disable MD024 -->

# User Stories: Agent Management

## US-01: View Agent Registry

### Problem

Elena Vasquez is a workspace admin at Acme Manufacturing who manages 12 autonomous agents across supply chain operations. She finds it impossible to see what agents exist in her workspace because there is no dedicated agents page -- she must query the database directly or ask a developer.

### Who

- Workspace Admin | Web dashboard | Needs fleet-level visibility across all agent runtimes

### Solution

An agents page that lists all agents in the workspace, grouped by runtime type (brain, sandbox, external), with appropriate actions per runtime.

### Domain Examples

#### 1: Full registry view -- Elena sees all 12 agents grouped by type

Elena navigates to the Agents page for workspace "Acme Manufacturing". She sees 6 brain agents (Architect, Observer, PM Agent, Chat Agent, Strategist, Design Partner) in a read-only section, 3 sandbox agents (QC Inspector, Code Reviewer, Demand Forecaster) with spawn/edit actions, and 3 external agents (Compliance Bot, Partner ERP, Freight Tracker) with edit actions.

#### 2: Single-runtime workspace -- Rafael sees brain agents plus his custom external agent

Rafael's workspace "Quality Control Lab" has 6 brain agents and 1 external agent "Compliance Bot". The sandbox section shows an empty state with guidance to create one.

#### 3: Brand new workspace -- no custom agents yet

A new workspace "Greenfield Corp" shows only the 6 brain agents. Sandbox and external sections display helpful empty states with "Create Agent" calls to action.

### UAT Scenarios (BDD)

#### Scenario: Registry displays agents grouped by runtime

Given Elena Vasquez navigates to the Agents page for "Acme Manufacturing"
And the workspace has 6 brain, 3 sandbox, and 3 external agents
When the page loads
Then she sees 12 agent cards grouped into three sections
And brain agents show "View" action only
And sandbox agents show "Spawn" and "Edit" actions
And external agents show "Edit" action

#### Scenario: Empty workspace shows guidance

Given workspace "Greenfield Corp" has no custom agents
When Rafael Oliveira navigates to the Agents page
Then brain agents are displayed as system-provided
And sandbox section shows "No sandbox agents yet" with a create action
And external section shows "No external agents yet" with a create action

#### Scenario: Page shows agent count and runtime badges

Given Elena Vasquez navigates to the Agents page
When the page loads
Then the page header shows "Agents (12)"
And each card displays a runtime badge (brain/sandbox/external)

### Acceptance Criteria

- [ ] Agents page accessible via navigation bar
- [ ] Agents grouped by runtime type in separate sections
- [ ] Brain agents display "View" action only (no edit/delete/spawn)
- [ ] Sandbox agents display "Spawn" and "Edit" actions
- [ ] External agents display "Edit" action
- [ ] Empty states with create guidance shown when no custom agents exist
- [ ] Page header shows total agent count

### Outcome KPIs

- **Who**: Workspace admins
- **Does what**: View agent registry instead of querying database directly
- **By how much**: 100% of agent visibility tasks handled through UI (from 0%)
- **Measured by**: Agent page visits vs. direct DB queries
- **Baseline**: No UI for agent visibility (all DB queries)

### Technical Notes

- Agent list requires graph traversal: workspace <- member_of <- identity <- identity_agent -> agent
- Depends on schema migration adding `runtime` field to agent table
- Brain agents identified by runtime="brain", not by hardcoded agent_type enum

---

## US-02: Create External Agent with Authority Scopes

### Problem

Rafael Oliveira is a developer at Acme Manufacturing who has built a compliance auditing agent using the Vercel AI SDK. He finds it frustrating that registering it with Brain requires direct database manipulation -- creating agent records, identity records, edges, and authority scopes manually via SurrealQL.

### Who

- Developer | Web dashboard | Needs to register pre-existing agents with governed authority

### Solution

A creation form that registers an external agent with name, description, and authority scope configuration, executing a 5-step transactional creation and generating a proxy token.

### Domain Examples

#### 1: Happy path -- Rafael creates Compliance Bot

Rafael clicks "Create Agent", selects "External Agent", enters name "Compliance Bot" and description "Automated compliance auditor scanning transactions for regulatory violations". He sets create_observation to "auto", create_decision to "propose", and confirm_decision to "blocked". The system creates all records transactionally and displays a proxy token "brp_a1b2c3..." that he copies for his agent's configuration.

#### 2: Minimal configuration -- Rafael registers with just a name

Rafael creates an external agent named "Quick Scanner" with no description. Authority scopes default to "propose" for all actions. The system creates the records and generates a proxy token.

#### 3: Duplicate name rejected -- Rafael tries to reuse an existing name

Rafael enters "Compliance Bot" as the name, but this agent already exists in the workspace. The form shows an inline error: "An agent named 'Compliance Bot' already exists in this workspace."

#### 4: Transaction failure -- system rolls back cleanly

Rafael submits the creation form, but the identity creation step fails due to a transient database error. No agent record, identity, or edges are left behind. The error message suggests retrying.

### UAT Scenarios (BDD)

#### Scenario: Create external agent successfully

Given Rafael Oliveira clicks "Create Agent" on the Agents page for "Acme Manufacturing"
And selects "External Agent" runtime
When he enters name "Compliance Bot" and description "Automated compliance auditor"
And sets authority scope create_observation to "auto"
And sets authority scope create_decision to "propose"
And sets authority scope confirm_decision to "blocked"
And clicks "Create Agent"
Then an agent record is created with name "Compliance Bot" and runtime "external"
And an identity record is created with type "agent" and name "Compliance Bot"
And an identity_agent edge links the identity to the agent
And a member_of edge links the identity to workspace "Acme Manufacturing"
And authorized_to edges are created for each configured scope
And a proxy token prefixed "brp_" is displayed once with a copy button

#### Scenario: Duplicate name shows inline error

Given workspace "Acme Manufacturing" has an agent named "Compliance Bot"
When Rafael enters "Compliance Bot" as the agent name
Then an inline error appears: "An agent named 'Compliance Bot' already exists"
And the "Create Agent" button remains disabled

#### Scenario: Transaction failure rolls back all records

Given Rafael has configured external agent "Compliance Bot"
When he clicks "Create Agent"
And the identity creation fails
Then no agent record exists for "Compliance Bot"
And no orphaned edges exist
And an error explains the failure with a retry option

#### Scenario: Authority scopes default to safe permissions

Given Rafael opens the external agent creation form
When authority scopes are displayed
Then all actions default to "propose"
And no action defaults to "auto"

### Acceptance Criteria

- [ ] External agent creation executes 5-step transaction atomically
- [ ] Proxy token generated and displayed once with copy button
- [ ] Warning that token cannot be retrieved after dialog close
- [ ] Duplicate agent name produces inline validation error
- [ ] Transaction failure leaves no partial records
- [ ] Authority scopes default to "propose" for all actions
- [ ] Connection instructions displayed in confirmation dialog

### Outcome KPIs

- **Who**: Developers building custom agents
- **Does what**: Register external agents through UI instead of database manipulation
- **By how much**: Agent registration time reduced from ~15 minutes (manual DB) to under 2 minutes
- **Measured by**: Time from "Create Agent" click to proxy token copied
- **Baseline**: ~15 minutes via manual SurrealQL

### Technical Notes

- Transaction must be atomic: all 5 steps succeed or all roll back
- Proxy token format: "brp_" prefix, raw value in X-Brain-Auth header (no Bearer prefix)
- Token stored as SHA-256 hash in proxy_token table
- Authority scope list populated from existing authority_scope table records

---

## US-03: View Agent Detail Page

### Problem

Elena Vasquez is a workspace admin who needs to understand what a specific agent is configured to do -- its authority scopes, runtime configuration, and operational history. She finds it opaque because this information is scattered across database tables and not surfaced in any UI.

### Who

- Workspace Admin | Web dashboard | Needs per-agent configuration and operational visibility

### Solution

An agent detail page showing configuration, authority scopes, and session history appropriate to the agent's runtime type.

### Domain Examples

#### 1: Sandbox agent detail -- Elena views QC Inspector

Elena clicks on "QC Inspector" from the registry. She sees: name, description, runtime "sandbox", model "claude-sonnet-4-20250514", sandbox config (coding agents, env vars, and image if cloud provider), 5 authority scopes listed as action-permission pairs, and a session list grouped by status.

#### 2: External agent detail -- Rafael views Compliance Bot

Rafael views "Compliance Bot". He sees: name, description, runtime "external", 4 authority scopes, connection status "Online (last seen 3m ago)", and recent session history.

#### 3: Brain agent detail -- Elena views Observer (read-only)

Elena views the brain agent "Observer". She sees name, description, authority scopes (from seed data), but no edit/delete/spawn actions. A note explains these are system-managed.

### UAT Scenarios (BDD)

#### Scenario: View sandbox agent detail

Given Elena Vasquez clicks on "QC Inspector" in the agent registry
When the detail page loads
Then she sees the agent name "QC Inspector" and description
And runtime badge "sandbox"
And configuration showing coding agents, model, environment variables, and image/snapshot if cloud provider
And 5 authority scopes as action-permission pairs
And a session list grouped by active, idle, and completed

#### Scenario: View brain agent as read-only

Given Elena Vasquez clicks on "Observer" in the agent registry
When the detail page loads
Then she sees the agent name and description
And authority scopes from seed data
And no "Edit", "Delete", or "Spawn" actions
And a note: "This agent is managed by the system"

#### Scenario: Back navigation returns to registry

Given Elena is viewing the detail page for "QC Inspector"
When she clicks "Back to Agents"
Then she returns to the Agents page with her previous filter state preserved

### Acceptance Criteria

- [ ] Detail page shows agent name, description, runtime badge
- [ ] Sandbox agents show sandbox configuration fields
- [ ] Authority scopes displayed as action-permission pairs for all runtimes
- [ ] Brain agent detail is read-only with explanatory note
- [ ] Back navigation preserves filter state

### Outcome KPIs

- **Who**: Workspace admins and developers
- **Does what**: Review agent configuration without querying database
- **By how much**: Configuration review time under 10 seconds (from minutes of DB queries)
- **Measured by**: Time on agent detail page; DB query reduction
- **Baseline**: All configuration review requires DB access

### Technical Notes

- Agent detail fetches agent record + identity graph + authorized_to edges + agent_session records in a single batched query
- Session list query: agent_session WHERE agent matches (field migration required from string to record ID)

---

## US-04: Delete Agent with Confirmation

### Problem

Elena Vasquez is a workspace admin who needs to remove decommissioned agents from her workspace. She finds it risky because deleting an agent requires removing multiple linked records (agent, identity, edges, scopes) and she needs to know if active sessions will be affected.

### Who

- Workspace Admin | Web dashboard | Needs safe, complete agent removal

### Solution

A delete flow with confirmation dialog that shows what will be removed and warns about active sessions.

### Domain Examples

#### 1: Clean delete -- Elena removes Partner ERP with no active sessions

Elena clicks "Delete" on "Partner ERP". The confirmation dialog shows: agent record, identity, identity_agent edge, member_of edge, 3 authorized_to edges will be removed. She types "Partner ERP" to confirm. All records are deleted atomically.

#### 2: Delete with active sessions -- Elena removes QC Inspector

Elena clicks "Delete" on "QC Inspector" which has 2 active sessions for "Batch #2847 QC" and "Batch #2846 QC". The dialog warns about session termination, lists affected sessions, and requires extra confirmation.

#### 3: Cannot delete brain agents -- Observer has no delete action

Elena views the brain agent "Observer". No "Delete" action exists. Brain agents are system-managed and cannot be removed through the UI.

### UAT Scenarios (BDD)

#### Scenario: Delete agent without active sessions

Given Elena Vasquez clicks "Delete" on external agent "Partner ERP"
And the agent has no active sessions
When the confirmation dialog appears
Then it lists: agent record, identity, 3 edges will be removed
When she types "Partner ERP" and clicks "Delete Agent"
Then all records are removed atomically
And "Partner ERP" no longer appears in the registry

#### Scenario: Delete agent with active sessions warns

Given Elena Vasquez clicks "Delete" on sandbox agent "QC Inspector"
And the agent has 2 active sessions
When the confirmation dialog appears
Then it warns: "2 active sessions will be terminated"
And lists the sessions with their tasks
When she types "QC Inspector" and clicks "Delete Agent and Terminate Sessions"
Then sessions are terminated with status "aborted"
And all agent records are removed

#### Scenario: Brain agent has no delete action

Given Elena views brain agent "Observer" detail page
Then no "Delete" action is available

### Acceptance Criteria

- [ ] Delete requires typing agent name to confirm (destructive action safety)
- [ ] Confirmation dialog lists all records that will be removed
- [ ] Active sessions warned about and terminated on confirmation
- [ ] Deletion removes: agent, identity, identity_agent, member_of, authorized_to edges
- [ ] Brain agents have no delete action
- [ ] Historical session records preserved for audit

### Outcome KPIs

- **Who**: Workspace admins
- **Does what**: Decommission agents through UI instead of manual DB cleanup
- **By how much**: Decommission time under 30 seconds (from 10+ minutes of manual queries)
- **Measured by**: Delete confirmation to registry refresh
- **Baseline**: Manual multi-table DB cleanup

### Technical Notes

- Deletion must be transactional: all records removed or none
- Historical agent_session records should be preserved (orphaned but queryable for audit)
- Terminated sessions get orchestrator_status = "aborted"

---

## US-05: Create Sandbox Agent with Configuration

### Problem

Elena Vasquez is a workspace admin who wants to deploy an automated demand forecasting agent that runs in a sandboxed environment. She finds it impossible to do this through the UI because sandbox agent creation requires both agent registration (like external agents) and runtime configuration (coding agents, environment variables, and provider-specific settings) that currently requires developer intervention.

### Who

- Workspace Admin | Web dashboard | Needs to deploy sandbox agents with runtime config

### Solution

A sandbox agent creation form that extends the external agent flow with sandbox-specific configuration fields (coding agents, environment variables, and provider-conditional fields like image and snapshot for cloud providers).

### Domain Examples

#### 1: Full configuration -- Elena creates Demand Forecaster

Elena selects "Sandbox Agent", enters name "Demand Forecaster", description "Predicts supply chain demand using historical batch data", model "claude-sonnet-4-20250514". Her workspace uses the Daytona provider, so she sets image to "rivetdev/sandbox-agent:0.4.2-full". She selects coding agent "Claude", adds env var FORECAST_HORIZON="90" and DATA_SOURCE="s3://acme-demand/batches". She configures authority scopes and clicks Create.

#### 2: Minimal sandbox config -- Elena uses workspace defaults

Elena creates sandbox agent "Quick Tester" with just a name. Her workspace uses the local provider, so no image or snapshot fields appear. Coding agents default to none, no env vars. Authority scopes default to "propose".

#### 3: No sandbox provider -- Elena blocked at form entry

Elena selects "Sandbox Agent" but workspace "Beta Corp" has no sandbox provider configured. The form shows a warning linking to Settings and disables sandbox config fields.

### UAT Scenarios (BDD)

#### Scenario: Create sandbox agent with full configuration

Given Elena Vasquez selects "Sandbox Agent" on the creation dialog
And workspace "Acme Manufacturing" has sandbox provider "daytona" configured
When she enters name "Demand Forecaster"
And enters description "Predicts supply chain demand"
And selects model "claude-sonnet-4-20250514"
And the form shows image and snapshot fields (cloud provider)
And sets image "rivetdev/sandbox-agent:0.4.2-full"
And selects coding agent "Claude"
And adds env var FORECAST_HORIZON = "90"
And configures authority scopes
And clicks "Create Agent"
Then an agent record is created with runtime "sandbox" and sandbox_config populated
And the confirmation shows the created agent with sandbox config summary

#### Scenario: Sandbox provider not configured blocks creation

Given workspace "Beta Corp" has no sandbox provider configured
When Elena selects "Sandbox Agent" runtime
Then a warning explains the provider must be configured first
And a link to Settings is provided
And sandbox configuration fields are disabled

#### Scenario: Minimal sandbox agent uses defaults

Given Elena enters only name "Quick Tester" for a sandbox agent
And the workspace uses sandbox provider "local"
When she clicks "Create Agent"
Then the agent is created with runtime "sandbox"
And no image or snapshot fields are stored in sandbox_config
And authority scopes default to "propose"

### Acceptance Criteria

- [ ] Sandbox creation form shows provider-appropriate fields
- [ ] All providers: coding agents, env vars, model
- [ ] Cloud providers only (e2b, daytona, docker): image and snapshot fields shown
- [ ] Local provider: image and snapshot fields hidden
- [ ] Workspace without sandbox provider configured shows warning and blocks creation
- [ ] Environment variables support add/remove key-value pairs
- [ ] Coding agents displayed as checkboxes (Claude, Codex, Aider)
- [ ] Sandbox config stored on agent record as sandbox_config object

### Outcome KPIs

- **Who**: Workspace admins
- **Does what**: Deploy sandbox agents through UI instead of code changes
- **By how much**: Sandbox agent setup time under 5 minutes (from hours of developer involvement)
- **Measured by**: Time from creation start to first spawned session
- **Baseline**: Requires developer to write config and deploy

### Technical Notes

- Sandbox config fields: env_vars (object), agents (array of strings); cloud providers add image (string), snapshot (string), template (string)
- Workspace sandbox_provider must be validated before allowing sandbox agent creation
- Provider config is workspace-level (settings.sandbox_provider), not per-agent
- Depends on US-02 (shares creation form infrastructure and authority scope component)

---

## US-06: Filter Agents by Runtime Type

### Problem

Elena Vasquez is a workspace admin managing 12+ agents across three runtime types. She finds it time-consuming to scan the full registry when she only wants to see her sandbox agents to check their session status.

### Who

- Workspace Admin | Web dashboard | Needs quick focus on specific runtime type

### Solution

Filter tabs at the top of the agents page that show counts per runtime and filter the card grid.

### Domain Examples

#### 1: Filter to sandbox -- Elena checks sandbox agents only

Elena clicks "Sandbox (3)" tab. Only 3 sandbox agent cards are displayed. The tab is highlighted as active.

#### 2: Return to all -- Elena clears filter

Elena clicks "All (12)" tab to see the complete registry again.

#### 3: Empty filter -- no external agents yet

Elena clicks "External (0)" tab. The section shows an empty state with guidance to create one.

### UAT Scenarios (BDD)

#### Scenario: Filter to sandbox agents

Given Elena views the Agents page with 6 brain, 3 sandbox, 3 external agents
When she clicks the "Sandbox (3)" filter tab
Then only 3 sandbox agent cards are displayed
And the tab is highlighted as active

#### Scenario: Filter shows empty state

Given a workspace with 6 brain agents and no external agents
When Elena clicks the "External (0)" filter tab
Then an empty state is displayed with create guidance

#### Scenario: All tab shows complete registry

Given Elena has filtered to sandbox agents
When she clicks "All (12)"
Then all 12 agent cards appear grouped by runtime

### Acceptance Criteria

- [ ] Filter tabs show count per runtime type
- [ ] Selecting a tab filters the card grid to that runtime only
- [ ] "All" tab shows complete registry grouped by runtime
- [ ] Empty filter state shows guidance to create agents
- [ ] Filter state preserved on back navigation from detail page

### Outcome KPIs

- **Who**: Workspace admins
- **Does what**: Find relevant agents in under 2 seconds (from scanning full list)
- **By how much**: Time to locate agent reduced by 80%
- **Measured by**: Time from page load to agent card click
- **Baseline**: Linear scan of full agent list

### Technical Notes

- Client-side filtering (no API call needed, full list already loaded)
- Tab counts derived from agent.runtime field in the loaded list

---

## US-07: Spawn Sandbox Session from Agent Detail

### Problem

Elena Vasquez is a workspace admin who needs to start a new sandbox agent session for a quality control batch inspection. She finds it disconnected because spawning a session requires navigating to the orchestrator or using the chat interface -- there is no way to spawn from the agent's own page.

### Who

- Workspace Admin | Web dashboard | Needs to start agent work directly from agent context

### Solution

A "Spawn Session" button on the sandbox agent detail page that triggers the existing orchestrator spawn flow.

### Domain Examples

#### 1: Spawn for task -- Elena starts QC Inspector on Batch #2848

Elena clicks "Spawn Session" on the QC Inspector detail page. She optionally selects a task "Batch #2848 QC" to scope the session. The orchestrator spawns a sandbox session and the session appears in the active list.

#### 2: Spawn without task -- Elena starts a general session

Elena clicks "Spawn Session" without selecting a task. The session starts with general agent instructions.

#### 3: Spawn fails -- sandbox provider error

Elena clicks "Spawn Session" but the Daytona provider is unreachable. An error message appears with the provider error and a retry option.

### UAT Scenarios (BDD)

#### Scenario: Spawn session from agent detail

Given Elena Vasquez is on the detail page for sandbox agent "QC Inspector"
When she clicks "Spawn Session"
And optionally selects task "Batch #2848 QC"
Then the orchestrator spawns a new sandbox session
And the session appears in the active session list with status "spawning"
And the status transitions to "active" when the sandbox is ready

#### Scenario: Spawn fails with provider error

Given Elena clicks "Spawn Session" for "QC Inspector"
And the sandbox provider "daytona" is unreachable
Then an error message explains the spawn failure
And suggests checking the provider configuration
And a "Retry" button is available

#### Scenario: Spawn not available for external agents

Given Rafael views the detail page for external agent "Compliance Bot"
Then no "Spawn Session" action is available

### Acceptance Criteria

- [ ] "Spawn Session" button visible only on sandbox agent detail pages
- [ ] Optional task selection scopes the session
- [ ] New session appears in active list with "spawning" status
- [ ] Spawn failure shows actionable error message
- [ ] External and brain agents do not show spawn action

### Outcome KPIs

- **Who**: Workspace admins
- **Does what**: Spawn sessions from agent context instead of navigating to orchestrator
- **By how much**: Session start time under 10 seconds (from 30+ seconds via orchestrator navigation)
- **Measured by**: Time from spawn click to session active
- **Baseline**: Navigate to orchestrator, select agent, configure, spawn

### Technical Notes

- Reuses existing orchestrator spawn endpoint (POST /api/workspaces/:ws/orchestrator/sessions)
- Sandbox config passed from agent record to spawn request
- Session record references agent via updated agent_session.agent field
- Depends on US-05 (sandbox agent must exist) and US-08 (session list to show result)

---

## US-08: View Session List on Agent Detail

### Problem

Elena Vasquez is a workspace admin monitoring autonomous agents during a production quality control run. She finds it difficult to track which agents are actively working, which are waiting for feedback, and which have completed because session information is only available through the orchestrator view, not the agent's own page.

### Who

- Workspace Admin | Web dashboard | Needs per-agent session visibility

### Solution

A session list on the agent detail page, grouped by status (active, idle, completed/error), showing relevant details and actions per status.

### Domain Examples

#### 1: Mixed session states -- Elena monitors QC Inspector

Elena views QC Inspector's detail page. She sees: 2 active sessions (Batch #2847 and #2846, with last event timestamps), 1 idle session (awaiting review feedback, with resume action), and 3 completed sessions from the past 7 days.

#### 2: No sessions yet -- newly created agent

Elena views newly created "Demand Forecaster". The session list shows an empty state: "No sessions yet. Spawn one to get started."

#### 3: Error session -- Elena sees what went wrong

Session #42 shows status "error" with message "Sandbox timeout after 30 minutes". The timestamp and duration are visible.

### UAT Scenarios (BDD)

#### Scenario: View grouped session list

Given Elena is on the detail page for "QC Inspector"
And the agent has 2 active, 1 idle, and 3 completed sessions
When the page loads
Then sessions are grouped into "Active", "Idle", and "Completed" sections
And active sessions show task name and last event timestamp
And idle sessions show "Resume" and "Send Feedback" actions
And completed sessions show duration and outcome

#### Scenario: Empty session list for new agent

Given Elena views newly created sandbox agent "Demand Forecaster"
When the page loads
Then the session list shows "No sessions yet. Spawn one to get started."

#### Scenario: Error session displays failure details

Given Elena views "QC Inspector" with an error session
When she looks at session #42
Then she sees status "error", message "Sandbox timeout", and timestamp

### Acceptance Criteria

- [ ] Sessions grouped by status: active, idle, completed/error
- [ ] Active sessions show task name and last event timestamp
- [ ] Idle sessions show resume and feedback actions
- [ ] Error sessions display error message
- [ ] Completed sessions show duration
- [ ] Empty state with guidance when no sessions exist

### Outcome KPIs

- **Who**: Workspace admins
- **Does what**: Monitor agent sessions from agent context instead of orchestrator
- **By how much**: Session status check time under 5 seconds per agent
- **Measured by**: Time on agent detail page session section
- **Baseline**: Navigate to orchestrator, filter by agent

### Technical Notes

- Queries agent_session table filtered by agent identifier
- Reuses existing orchestrator_status enum for grouping
- Session list refreshes on interval or SSE for active sessions
- Depends on agent_session.agent field migration from string to agent record reference

---

## US-09: Edit Agent Configuration and Authority Scopes

### Problem

Elena Vasquez is a workspace admin who needs to adjust the authority scopes for her QC Inspector agent after discovering it needs create_decision set to "auto" for efficient batch processing. She finds it impossible because there is no way to modify agent configuration or authority after creation without direct database manipulation.

### Who

- Workspace Admin | Web dashboard | Needs to adjust agent config post-creation

### Solution

An edit form accessible from the agent detail page that allows modifying agent details, sandbox configuration, and authority scopes.

### Domain Examples

#### 1: Edit authority scope -- Elena promotes QC Inspector

Elena opens the edit form for "QC Inspector", changes create_decision from "propose" to "auto", and saves. The authorized_to edge is updated and the detail page reflects the change.

#### 2: Add environment variable -- Elena adds strict mode

Elena edits "QC Inspector", adds env var QC_STRICT_MODE="true". Next spawned session will include the new variable.

#### 3: Edit external agent name -- Rafael renames Compliance Bot

Rafael edits "Compliance Bot" to "Compliance Auditor v2". Both the agent record name and identity name are updated.

### UAT Scenarios (BDD)

#### Scenario: Edit authority scope

Given Elena opens the edit form for sandbox agent "QC Inspector"
When she changes create_decision from "propose" to "auto"
And clicks "Save Changes"
Then the authorized_to edge for create_decision is updated
And the agent detail page shows create_decision as "auto"

#### Scenario: Edit sandbox configuration

Given Elena opens the edit form for "QC Inspector"
When she adds environment variable QC_STRICT_MODE = "true"
And clicks "Save Changes"
Then sandbox_config.env_vars includes QC_STRICT_MODE
And existing sessions are not affected
And the next spawned session includes QC_STRICT_MODE

#### Scenario: Edit agent name syncs identity

Given Rafael opens the edit form for "Compliance Bot"
When he changes the name to "Compliance Auditor v2"
And clicks "Save Changes"
Then agent.name is updated to "Compliance Auditor v2"
And the linked identity.name is also updated
And the registry card shows the new name

#### Scenario: Cannot edit brain agent

Given Elena views brain agent "Observer"
Then no "Edit" action is available

### Acceptance Criteria

- [ ] Edit form pre-populated with current values
- [ ] Authority scope changes update authorized_to edges
- [ ] Agent name change syncs to identity record
- [ ] Sandbox config changes apply to next spawned session (not active ones)
- [ ] Brain agents cannot be edited
- [ ] Save provides confirmation feedback

### Outcome KPIs

- **Who**: Workspace admins and developers
- **Does what**: Adjust agent configuration through UI instead of DB manipulation
- **By how much**: Configuration change time under 1 minute (from 10+ minutes)
- **Measured by**: Time from edit click to save confirmation
- **Baseline**: Direct SurrealQL queries

### Technical Notes

- Authority scope edit: delete old authorized_to edges, create new ones (transactional)
- Name change requires updating both agent.name and identity.name
- Active sessions continue with existing authority until restarted
- Depends on US-02/US-05 (creation infrastructure) and US-03 (detail page)

---

## US-10: Resume or Send Feedback to Idle Sessions

### Problem

Elena Vasquez is a workspace admin whose sandbox agent "QC Inspector" has been idle for 20 minutes waiting for human review of a quality anomaly. She finds it disruptive to leave the agent context and navigate to the orchestrator to send feedback or resume the session.

### Who

- Workspace Admin | Web dashboard | Needs to respond to idle agents in context

### Solution

Resume and feedback actions directly on idle session rows in the agent detail session list.

### Domain Examples

#### 1: Send feedback -- Elena approves anomaly classification

Session #45 is idle with message "Awaiting review: anomaly detected in batch #2845". Elena clicks "Send Feedback", types "Approved -- escalate to production hold", and sends. The session resumes.

#### 2: Resume without feedback -- Elena resumes a paused session

Session #45 is idle. Elena clicks "Resume" to continue the session without additional instructions.

#### 3: No idle sessions -- no actions shown

QC Inspector has 2 active and 3 completed sessions but none idle. No resume/feedback actions appear.

### UAT Scenarios (BDD)

#### Scenario: Send feedback to idle session

Given Elena views "QC Inspector" detail page
And session #45 is idle with message "Awaiting review: anomaly detected in batch #2845"
When she clicks "Send Feedback" on session #45
And enters "Approved -- escalate to production hold"
And clicks "Send"
Then the feedback is delivered to the session
And the session status transitions from "idle" to "active"

#### Scenario: Resume idle session without feedback

Given session #45 is idle
When Elena clicks "Resume" on session #45
Then the session resumes without additional instructions
And status transitions to "active"

#### Scenario: Only idle sessions show feedback actions

Given "QC Inspector" has active sessions but no idle sessions
Then no "Resume" or "Send Feedback" actions appear in the session list

### Acceptance Criteria

- [ ] "Resume" and "Send Feedback" actions on idle session rows only
- [ ] Feedback text input with send confirmation
- [ ] Session status updates from "idle" to "active" after resume/feedback
- [ ] Active and completed sessions have no resume/feedback actions

### Outcome KPIs

- **Who**: Workspace admins
- **Does what**: Respond to idle agents from agent context instead of orchestrator
- **By how much**: Idle session response time under 15 seconds (from 45+ seconds)
- **Measured by**: Time from idle notification to feedback sent
- **Baseline**: Navigate to orchestrator, find session, send feedback

### Technical Notes

- Reuses existing orchestrator feedback endpoint
- Session list should auto-refresh or use SSE to reflect status change
- Depends on US-08 (session list must exist)

---

## US-11: View External Agent Connection Status

### Problem

Rafael Oliveira is a developer whose external agent "Compliance Bot" connects to Brain via the LLM proxy. He finds it opaque whether the agent is actually connected and actively working because there is no visibility into proxy session activity from the agents page.

### Who

- Developer | Web dashboard | Needs connection health visibility for external agents

### Solution

Connection status indicator on external agent detail pages based on most recent proxy request timestamp.

### Domain Examples

#### 1: Online agent -- last request 3 minutes ago

Rafael views "Compliance Bot" detail page. Status shows "Online" with "Last seen 3 minutes ago".

#### 2: Offline agent -- no recent requests

Rafael views "Partner ERP" detail page. Status shows "Offline" with "Last seen 2 days ago".

#### 3: Never connected -- new agent with no proxy requests

Rafael views newly created "Quick Scanner". Status shows "Never connected" with setup instructions.

### UAT Scenarios (BDD)

#### Scenario: Online external agent

Given Rafael views external agent "Compliance Bot"
And the agent's last proxy request was 3 minutes ago
When the detail page loads
Then connection status shows "Online" with "Last seen 3 minutes ago"

#### Scenario: Offline external agent

Given Rafael views external agent "Partner ERP"
And the agent's last proxy request was 2 days ago
Then connection status shows "Offline" with "Last seen 2 days ago"

#### Scenario: Never connected agent

Given Rafael views newly created external agent "Quick Scanner"
And no proxy requests have been made with this agent's token
Then connection status shows "Never connected"
And setup instructions are displayed

### Acceptance Criteria

- [ ] Connection status visible on external agent detail pages only
- [ ] Online/Offline/Never connected states based on last proxy request
- [ ] Last seen timestamp displayed
- [ ] Never connected state shows setup guidance

### Outcome KPIs

- **Who**: Developers managing external agents
- **Does what**: Verify agent connectivity without checking proxy logs
- **By how much**: Connection status check in under 3 seconds (from minutes of log inspection)
- **Measured by**: Connection status accuracy vs proxy logs
- **Baseline**: Check proxy server logs manually

### Technical Notes

- Connection status derived from proxy_session or trace records for the agent's identity
- Online threshold: last request within 5 minutes (configurable)
- Depends on US-03 (detail page)

---

## US-12: Delete Agent with Active Session Warning

### Problem

Elena Vasquez is a workspace admin decommissioning a sandbox agent that still has active sessions running quality checks. She finds it risky to delete the agent because she is unsure what happens to in-progress work and session records.

### Who

- Workspace Admin | Web dashboard | Needs safe deletion with session awareness

### Solution

Enhanced delete confirmation that detects active sessions, warns about termination, and lists affected sessions before proceeding.

### Domain Examples

#### 1: Delete with 2 active sessions -- Elena terminates QC Inspector

Elena clicks "Delete" on QC Inspector with 2 active sessions. The dialog warns about termination, lists "Batch #2847 QC" and "Batch #2846 QC", and requires typing the name. Sessions are aborted before records are removed.

#### 2: Delete with mixed sessions -- active plus idle

Elena deletes an agent with 1 active and 1 idle session. Both are listed as affected.

#### 3: Cancel preserves everything

Elena sees the warning about 2 active sessions and decides to cancel. No sessions are terminated, no records deleted.

### UAT Scenarios (BDD)

#### Scenario: Delete with active sessions terminates them

Given Elena clicks "Delete" on "QC Inspector" with 2 active sessions
When the confirmation dialog appears
Then it warns "2 active sessions will be terminated"
And lists sessions: "Batch #2847 QC" (active), "Batch #2846 QC" (active)
When she types "QC Inspector" and confirms
Then sessions are terminated with status "aborted"
And all agent records are removed

#### Scenario: Cancel preserves agent and sessions

Given Elena sees the delete warning for "QC Inspector"
When she clicks "Cancel"
Then no sessions are terminated
And the agent remains in the registry

#### Scenario: No active sessions skips warning

Given Elena deletes external agent "Partner ERP" with no active sessions
Then the confirmation dialog does not mention session termination

### Acceptance Criteria

- [ ] Active/idle sessions detected and listed in delete dialog
- [ ] Warning text includes session count and task names
- [ ] Sessions terminated with "aborted" status before record removal
- [ ] Cancel leaves everything intact
- [ ] No-session deletions skip session warning

### Outcome KPIs

- **Who**: Workspace admins
- **Does what**: Safely decommission agents with full awareness of impact
- **By how much**: Zero accidental session terminations
- **Measured by**: Delete cancellation rate when active sessions present
- **Baseline**: No UI-based deletion available

### Technical Notes

- Extends US-04 with active session detection
- Session termination calls existing orchestrator abort endpoint
- Depends on US-04 (basic delete) and US-08 (session list query)

---

## US-13: Empty States for Agent Sections

### Problem

Rafael Oliveira is a developer in a new workspace who navigates to the Agents page and sees only system brain agents. He finds it confusing that the sandbox and external sections appear blank with no guidance on what they are or how to create agents for them.

### Who

- Developer | Web dashboard | Needs first-use guidance for agent creation

### Solution

Contextual empty states for each runtime section explaining what agents of that type do and providing a clear create call-to-action.

### Domain Examples

#### 1: No sandbox agents -- guidance for automated workflows

The sandbox section shows: "No sandbox agents yet. Sandbox agents run in isolated environments managed by Brain. Create one to automate code review, quality inspection, or research tasks." with a "Create Sandbox Agent" button.

#### 2: No external agents -- guidance for integration

The external section shows: "No external agents yet. External agents are pre-existing tools that connect to Brain via the LLM proxy. Register one to give your custom agents governed autonomy." with a "Create External Agent" button.

#### 3: Both sections empty -- full onboarding context

A brand new workspace shows empty states for both sandbox and external with differentiated guidance.

### UAT Scenarios (BDD)

#### Scenario: Sandbox empty state

Given workspace "Greenfield Corp" has no sandbox agents
When Rafael navigates to the Agents page
Then the sandbox section shows explanatory text about sandbox agents
And includes a "Create Sandbox Agent" button

#### Scenario: External empty state

Given workspace "Greenfield Corp" has no external agents
When Rafael navigates to the Agents page
Then the external section shows explanatory text about external agents
And includes a "Create External Agent" button

#### Scenario: Empty state button starts creation flow

Given Rafael sees the sandbox empty state
When he clicks "Create Sandbox Agent"
Then the creation dialog opens with "Sandbox Agent" pre-selected

### Acceptance Criteria

- [ ] Empty state shown per section when no agents of that runtime exist
- [ ] Explanatory text describes what agents of that type do
- [ ] Call-to-action button starts creation with runtime pre-selected
- [ ] Brain agent section never shows empty state (always has system agents)

### Outcome KPIs

- **Who**: New workspace users
- **Does what**: Create first agent from empty state guidance (vs abandoning page)
- **By how much**: First-agent creation rate above 60% within first workspace week
- **Measured by**: Empty state CTA click rate
- **Baseline**: No guidance, users must discover creation flow independently

### Technical Notes

- Client-side rendering based on agent list count per runtime
- Empty state CTA passes runtime parameter to creation dialog
- Brain section always populated (system agents seeded at workspace creation)
