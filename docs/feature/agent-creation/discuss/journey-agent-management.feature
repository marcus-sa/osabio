Feature: Agent Management
  As a workspace administrator or developer using Brain,
  I want to view, create, configure, and monitor agents
  so that I can extend my organization's autonomous capabilities
  with proper governance boundaries.

  Background:
    Given a workspace "Acme Manufacturing" with sandbox provider "daytona" configured
    And the workspace has 6 brain agents, 2 sandbox agents, and 1 external agent

  # ----- Step 1: View Agent Registry -----

  Scenario: View agent registry with runtime grouping
    Given Elena Vasquez is a workspace admin for "Acme Manufacturing"
    When she navigates to the Agents page
    Then she sees 9 agent cards grouped into "Brain", "Sandbox", and "External" sections
    And each card displays the agent name, description, and runtime badge
    And filter tabs show counts: "All (9)", "Brain (6)", "Sandbox (2)", "External (1)"

  Scenario: Brain agents show view-only actions
    Given Elena Vasquez views the Agents page
    When she looks at the brain agent "Observer"
    Then only a "View" action is available
    And no "Edit", "Delete", or "Spawn" actions appear
    And a lock icon indicates the agent is system-managed

  Scenario: Sandbox agent cards show session indicators
    Given Elena Vasquez views the Agents page
    And sandbox agent "QC Inspector" has 2 active sessions and 1 idle session
    When the page loads
    Then the "QC Inspector" card shows "2 active" status indicator
    And the card displays "Spawn", "Edit" actions

  Scenario: Filter agents by runtime type
    Given Elena Vasquez views the Agents page with 9 agents
    When she clicks the "Sandbox" filter tab
    Then only 2 sandbox agent cards are displayed
    And the "Sandbox (2)" tab is highlighted as active

  Scenario: Empty state for no agents
    Given a new workspace "Greenfield Corp" with no custom agents
    When Rafael Oliveira navigates to the Agents page
    Then brain agents are displayed as system-provided
    And the sandbox section shows "No sandbox agents yet. Create your first one to automate workflows."
    And the external section shows "No external agents yet. Register one to connect existing tools."
    And each empty section includes a "Create Agent" call to action

  # ----- Step 2: Select Runtime Type -----

  Scenario: Runtime selection presents two options
    Given Elena Vasquez clicks "Create Agent" on the Agents page
    When the creation dialog opens
    Then she sees two selectable cards: "Sandbox Agent" and "External Agent"
    And each card includes a description and "Best for" examples
    And a note explains that brain agents are system-managed

  Scenario: Continue after runtime selection
    Given Elena Vasquez has the creation dialog open
    When she selects "Sandbox Agent"
    And clicks "Continue"
    Then the form advances to show sandbox-specific configuration fields

  # ----- Step 3: Configure Sandbox Agent -----

  Scenario: Configure sandbox agent with all fields
    Given Elena Vasquez is configuring a new sandbox agent
    When she enters name "Demand Forecaster"
    And enters description "Predicts supply chain demand using historical batch data"
    And selects model "claude-sonnet-4-20250514"
    And the form shows image field (cloud provider "daytona")
    And enters image "rivetdev/sandbox-agent:0.4.2-full"
    And selects coding agents "Claude" and "Codex"
    And adds environment variable FORECAST_HORIZON = "90"
    And sets authority scope create_observation to "auto"
    And sets authority scope create_decision to "propose"
    And sets authority scope confirm_decision to "blocked"
    Then the "Create Agent" button is enabled
    And all entered values are visible for review

  Scenario: Sandbox agent with minimal configuration
    Given Elena Vasquez is configuring a new sandbox agent
    When she enters only the required field: name "Quick Bot"
    Then the form hides image and snapshot fields (local provider)
    And uses workspace defaults for model
    And authority scopes default to "propose" for all actions
    And the "Create Agent" button is enabled

  Scenario: Sandbox provider not configured blocks creation
    Given a workspace "Beta Corp" with no sandbox provider configured
    When Rafael Oliveira selects "Sandbox Agent" in the creation dialog
    Then a warning explains that no sandbox provider is configured
    And suggests navigating to Settings to configure one
    And the sandbox configuration fields are disabled

  # ----- Step 4: Configure External Agent -----

  Scenario: Configure external agent
    Given Rafael Oliveira is configuring a new external agent
    When he enters name "Compliance Bot"
    And enters description "Automated compliance auditor scanning transactions for regulatory violations"
    And sets authority scope create_observation to "auto"
    And sets authority scope create_decision to "propose"
    And sets authority scope create_task to "blocked"
    And sets authority scope confirm_decision to "blocked"
    Then the "Create Agent" button is enabled

  # ----- Step 5: Agent Creation Transaction -----

  Scenario: Successful sandbox agent creation
    Given Elena Vasquez has configured sandbox agent "Demand Forecaster" with 5 authority scopes
    When she clicks "Create Agent"
    Then the system creates an agent record with name "Demand Forecaster" and runtime "sandbox"
    And creates an identity record with type "agent" and name "Demand Forecaster"
    And creates an identity_agent edge linking identity to agent
    And creates a member_of edge linking identity to workspace "Acme Manufacturing"
    And creates 5 authorized_to edges matching the configured scopes
    And the confirmation dialog shows a summary of all created records
    And the "Go to Agent" button navigates to the agent detail page

  Scenario: Successful external agent creation with proxy token
    Given Rafael Oliveira has configured external agent "Compliance Bot" with 4 authority scopes
    When he clicks "Create Agent"
    Then the system creates agent and identity records
    And generates a proxy token with prefix "brp_"
    And the confirmation dialog displays the token
    And a "Copy to Clipboard" button is available next to the token
    And a warning states the token cannot be retrieved after closing
    And connection instructions show BRAIN_SERVER_URL, BRAIN_AUTH_TOKEN, and BRAIN_WORKSPACE_ID

  Scenario: Creation fails and rolls back
    Given Elena Vasquez has configured sandbox agent "Demand Forecaster"
    When she clicks "Create Agent"
    And the transaction fails during identity creation
    Then no agent record exists in the database
    And no orphaned identity or edge records exist
    And an error message explains the failure
    And a "Try Again" button is available

  # ----- Step 6: Agent Name Validation -----

  Scenario: Duplicate agent name rejected
    Given workspace "Acme Manufacturing" already has an agent named "QC Inspector"
    When Elena Vasquez enters name "QC Inspector" in the creation form
    Then an inline validation error appears: "An agent named 'QC Inspector' already exists in this workspace."
    And the "Create Agent" button remains disabled

  Scenario: Empty agent name rejected
    Given Elena Vasquez is configuring a new agent
    When she leaves the name field empty
    Then the name field shows a validation error: "Agent name is required"
    And the "Create Agent" button remains disabled

  # ----- Step 7: Agent Detail and Session Monitoring -----

  Scenario: View sandbox agent detail with active sessions
    Given Elena Vasquez navigates to the detail page for "QC Inspector"
    And the agent has sessions:
      | id  | status    | task               | started    | last_event |
      | #47 | active    | Batch #2847 QC     | 12m ago    | 2m ago     |
      | #46 | active    | Batch #2846 QC     | 45m ago    | 5m ago     |
      | #45 | idle      | Awaiting feedback  | 1h ago     | 20m ago    |
      | #44 | completed | Batch #2845 QC     | 3h ago     | 2h ago     |
    When the page loads
    Then she sees the agent configuration (coding agents, model, env vars, and image/snapshot if cloud provider)
    And authority scopes are displayed as action-permission pairs
    And sessions are grouped: 2 active, 1 idle, 1 completed
    And active sessions show task name and last event timestamp
    And idle session #45 shows "Resume" and "Send Feedback" actions

  Scenario: View external agent connection status
    Given Rafael Oliveira navigates to the detail page for "Compliance Bot"
    And the agent's last proxy request was 3 minutes ago
    When the page loads
    Then the connection status shows "Online" with last seen timestamp
    And recent sessions are listed with outcome summaries

  Scenario: View brain agent detail (read-only)
    Given Elena Vasquez navigates to the detail page for brain agent "Observer"
    When the page loads
    Then she sees the agent name, description, and authority scopes
    And no "Edit", "Delete", or "Spawn" actions are available
    And a note explains that brain agents are configured by the system

  # ----- Step 8: Edit Agent -----

  Scenario: Edit sandbox agent configuration
    Given Elena Vasquez clicks "Edit" on sandbox agent "QC Inspector"
    When she changes the model to "claude-sonnet-4-20250514"
    And adds a new environment variable QC_STRICT_MODE = "true"
    And changes authority scope create_decision from "propose" to "auto"
    And clicks "Save Changes"
    Then the agent record is updated with the new model
    And the sandbox_config.env_vars includes QC_STRICT_MODE
    And the authorized_to edge for create_decision reflects the new permission
    And the agent detail page shows the updated configuration

  Scenario: Edit external agent authority scopes
    Given Rafael Oliveira clicks "Edit" on external agent "Compliance Bot"
    When he changes authority scope create_task from "blocked" to "propose"
    And clicks "Save Changes"
    Then the authorized_to edge for create_task is updated
    And the next proxy request from Compliance Bot reflects the new authority

  # ----- Step 9: Delete Agent -----

  Scenario: Delete agent without active sessions
    Given Elena Vasquez clicks "Delete" on external agent "Partner ERP"
    And the agent has no active sessions
    When the confirmation dialog appears
    Then it lists what will be removed: agent record, identity, edges
    And she must type "Partner ERP" to confirm
    When she types the name and clicks "Delete Agent"
    Then the agent, identity, identity_agent edge, member_of edge, and authorized_to edges are removed
    And the agent no longer appears in the registry

  Scenario: Delete agent with active sessions requires extra confirmation
    Given Elena Vasquez clicks "Delete" on sandbox agent "QC Inspector"
    And the agent has 2 active sessions for tasks "Batch #2847 QC" and "Batch #2846 QC"
    When the confirmation dialog appears
    Then it warns: "This agent has 2 active sessions that will be terminated"
    And lists the affected sessions with their tasks
    And requires typing the agent name to confirm
    When she types "QC Inspector" and clicks "Delete Agent and Terminate Sessions"
    Then active sessions are terminated with status "aborted"
    And all agent records and edges are removed

  # ----- Step 10: Keyboard Accessibility -----

  Scenario: Navigate agents page with keyboard
    Given Elena Vasquez navigates with keyboard only
    When she tabs through the Agents page
    Then all filter tabs, agent cards, and action buttons are reachable
    And focus indicators are visible on each interactive element
    And pressing Enter on an agent card opens its detail page

  # ----- Step 11: Authority Scope Defaults -----

  @property
  Scenario: Authority scopes default to safe permissions
    Given any user creates a new agent (sandbox or external)
    When authority scopes are displayed in the creation form
    Then all actions default to "propose" (agent suggests, human approves)
    And no action defaults to "auto" (unattended)
    And the user must explicitly set any action to "auto"
