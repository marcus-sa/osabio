Feature: Tool Registry UI
  As a workspace admin or member
  I want a web UI to browse tools, manage providers, connect accounts, and grant access
  So that I can govern the workspace's integration toolset without CLI or raw API calls

  # Jobs: J1 (Provider Registration), J2 (Account Connection)
  # Platform: Web (React + shadcn/ui)

  # --- Navigation and Empty State ---

  Scenario: Empty state guides admin to first action
    Given Priya Sharma is a workspace admin for "Acme Engineering"
    And no credential providers or tools exist in the workspace
    When Priya navigates to the Tool Registry page
    Then the page displays "No tools registered yet"
    And a call-to-action button "Add Provider" is visible
    And the Tool Registry appears in the workspace sidebar navigation

  # --- Tool Browsing (AC-11a) ---

  Scenario: Browse tools grouped by toolkit
    Given the workspace has 4 github tools and 2 slack tools
    When Priya opens the Tools tab
    Then tools are grouped under "github" (4 tools) and "slack" (2 tools)
    And each tool row shows name, description, risk_level badge, status, grant count, and provider name

  Scenario: Filter tools by risk level
    Given the workspace has tools at risk levels low, medium, and high
    When Priya selects risk_level filter "high"
    Then only tools with risk_level "high" are displayed
    And the group headers update to reflect filtered counts

  Scenario: Filter tools by status
    Given the workspace has 5 active tools and 1 disabled tool
    When Priya selects status filter "disabled"
    Then only the disabled tool is displayed

  Scenario: Search tools by name
    Given the workspace has 8 tools across 3 toolkits
    When Priya types "create" in the search field
    Then only tools whose name or description contains "create" are shown

  # --- Provider Management (AC-11b) ---

  Scenario: Register OAuth2 credential provider
    Given Priya clicks "Add Provider" on the Providers tab
    When she selects auth_method "oauth2"
    Then the form shows fields: name, display_name, authorization_url, token_url, client_id, client_secret, scopes
    When she enters name "github", display_name "GitHub", and valid OAuth2 details
    And clicks "Create Provider"
    Then a credential_provider "github" appears in the provider list
    And client_secret is never shown in the response

  Scenario: Register API key credential provider
    Given Priya clicks "Add Provider" on the Providers tab
    When she selects auth_method "api_key"
    Then the form shows only: name, display_name
    And OAuth-specific fields (authorization_url, token_url, client_id, client_secret, scopes) are hidden
    When she enters name "internal-api" and display_name "Internal API"
    And clicks "Create Provider"
    Then a credential_provider "internal-api" appears in the provider list

  Scenario: Duplicate provider name rejected
    Given credential_provider "github" already exists in the workspace
    When Priya attempts to create another provider named "github"
    Then an inline error shows "A provider named 'github' already exists"
    And the form is not submitted

  # --- Account Connection: OAuth2 (AC-11c) ---

  Scenario: Connect account via OAuth2
    Given credential_provider "github" with auth_method "oauth2" exists
    And Carlos Mendez has not connected his GitHub account
    When Carlos clicks "Connect" on the GitHub provider
    Then a confirmation dialog shows the requested scopes (repo, read:org)
    And explains that credentials will be stored securely
    When Carlos clicks "Continue to GitHub"
    Then the browser redirects to GitHub's authorization URL
    And on successful callback, the Providers tab shows GitHub as "Connected"

  Scenario: OAuth2 consent denied
    Given Carlos clicks "Connect" on the GitHub provider
    And is redirected to GitHub's authorization URL
    When Carlos denies consent at GitHub
    Then the browser returns to the Providers tab
    And a toast notification shows "Connection cancelled"
    And no connected_account record is created

  # --- Account Connection: Static (AC-11d) ---

  Scenario: Connect account via API key
    Given credential_provider "internal-api" with auth_method "api_key" exists
    When Carlos clicks "Connect" on Internal API
    Then a credential entry form appears with an API key field
    And a note explains the key will be encrypted and stored securely
    When Carlos enters his API key and clicks "Connect"
    Then the Providers tab shows Internal API as "Connected"

  Scenario: Connect account via basic auth
    Given credential_provider "legacy-service" with auth_method "basic" exists
    When Carlos clicks "Connect" on Legacy Service
    Then a form appears with username and password fields
    When Carlos enters credentials and clicks "Connect"
    Then the Providers tab shows Legacy Service as "Connected"

  # --- Tool Access Management (AC-11e) ---

  Scenario: Grant tool access to identity
    Given mcp_tool "github.create_issue" exists in the workspace
    When Priya opens the Access tab and selects "github.create_issue"
    And assigns access to identity "coding-agent-1" with max_calls_per_hour 20
    And clicks "Grant Access"
    Then a can_use edge is created
    And the tool's grant count increments by 1 in the Tools tab

  Scenario: View effective toolset for identity
    Given identity "coding-agent-1" has 2 direct grants and 1 skill-derived tool
    When Priya views the effective toolset for "coding-agent-1"
    Then all 3 tools are listed
    And each shows its source ("direct" or skill name)
    And rate limits are displayed where configured

  Scenario: Duplicate grant prevented
    Given identity "coding-agent-1" already has access to "github.create_issue"
    When Priya attempts to grant the same tool again
    Then a toast shows "This identity already has access to this tool"
    And no duplicate edge is created

  # --- Connected Accounts Dashboard (AC-11f) ---

  Scenario: View connected accounts
    Given Carlos has connected accounts: GitHub (active), Slack (active), Internal API (expired)
    When Carlos opens the Accounts tab
    Then all 3 accounts are listed with provider name, status badge, and connected_at date
    And active accounts show a "Revoke" button
    And the expired account shows a "Reconnect" button

  Scenario: Revoke connected account
    Given Carlos has an active connected account for GitHub
    When Carlos clicks "Revoke" on GitHub
    Then a confirmation dialog warns: "This will permanently delete your stored credentials"
    When Carlos confirms by clicking "Revoke Access"
    Then the GitHub account status changes to "revoked"
    And subsequent agent tool calls for GitHub tools return "account disconnected" error
    And all credential fields are permanently deleted

  Scenario: Reconnect expired account
    Given Carlos has an expired connected account for Legacy Service
    When Carlos clicks "Reconnect" on Legacy Service
    Then the appropriate connection form appears (based on auth_method)
    And after successful reconnection, the account status changes to "active"

  # --- MCP Server Discovery (AC-11g) ---

  Scenario: Discover tools from MCP server
    Given Priya enters an MCP server URL on the Providers tab
    When she clicks "Connect Server"
    And Brain calls tools/list and discovers 5 tools
    Then a review screen shows the 5 discovered tools
    And each shows name, description, and suggested risk_level
    And checkboxes allow selecting which tools to import

  Scenario: Import selected tools from discovery
    Given 5 tools were discovered from an MCP server
    When Priya checks 3 of them and clicks "Import Selected"
    Then 3 mcp_tool records are created in the workspace
    And the Tools tab shows the newly imported tools

  # --- Error States ---

  Scenario: Network error during provider creation
    Given Priya is filling out the Add Provider form
    When a network error occurs during submission
    Then an error toast shows "Could not create provider. Check your connection and try again."
    And the form data is preserved (not cleared)

  Scenario: Keyboard accessibility
    Given Carlos navigates the Tool Registry with keyboard only
    When he tabs through the interface
    Then all interactive elements (tabs, buttons, form fields, dialogs) are reachable
    And focus indicators are visible on every focused element
