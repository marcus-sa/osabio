<!-- markdownlint-disable MD024 -->

## US-UI-01: Tool Registry Page Shell and Navigation

### Problem
Priya Sharma is a DevOps lead who manages integrations for a 6-person team. She currently has to use raw API calls or curl commands to manage credential providers, tool access, and governance. She finds it tedious to context-switch between the Brain web UI and terminal for routine integration management.

### Who
- Workspace admin | Brain web UI | Needs a dedicated page for integration management

### Solution
A Tool Registry page accessible from the workspace sidebar with tab navigation (Tools, Providers, Accounts, Access) and appropriate empty states.

### Domain Examples
#### 1: First visit with empty workspace
Priya Sharma opens Brain for the first time after the tool registry backend was deployed. She clicks "Tool Registry" in the sidebar. The page shows an empty state: "No tools registered yet. Register a credential provider to start connecting integrations." with an "Add Provider" button.

#### 2: Returning admin with existing tools
Priya returns to the workspace which has 6 tools across GitHub and Slack providers. The Tools tab is active by default showing grouped tool lists. She clicks the Providers tab to check connection statuses.

#### 3: Member sees member-appropriate view
Carlos Mendez, a senior developer, opens the Tool Registry. He sees the Providers tab showing available providers with Connect buttons and the Accounts tab showing his connected accounts. The Access tab is visible but read-only for non-admins.

### UAT Scenarios (BDD)

#### Scenario: Tool Registry appears in sidebar
Given Priya Sharma is authenticated as a workspace admin for "Acme Engineering"
When she views the workspace sidebar
Then "Tool Registry" appears as a navigation item below "Policies"

#### Scenario: Empty state on first visit
Given "Acme Engineering" has no credential providers or mcp_tools
When Priya navigates to /tools
Then the page title reads "Tool Registry"
And an empty state message says "No tools registered yet"
And an "Add Provider" call-to-action button is visible

#### Scenario: Tab navigation renders correctly
Given "Acme Engineering" has 4 tools and 2 providers
When Priya navigates to /tools
Then four tabs are visible: Tools, Providers, Accounts, Access
And the Tools tab is active by default

### Acceptance Criteria
- [ ] Route /tools registered in TanStack Router under authenticated layout
- [ ] Sidebar navigation includes "Tool Registry" entry
- [ ] Four tabs render: Tools, Providers, Accounts, Access
- [ ] Empty state with CTA when no tools/providers exist
- [ ] Page accessible via keyboard navigation

### Outcome KPIs
- **Who**: Workspace admins
- **Does what**: Navigate to Tool Registry without help documentation
- **By how much**: 95% find it on first attempt
- **Measured by**: Sidebar click-through analytics
- **Baseline**: No UI exists (100% API-only)

### Technical Notes
- Follow existing route pattern in `router.tsx` (TanStack Router)
- Follow sidebar pattern in `WorkspaceSidebar.tsx`
- Use shadcn Tabs component for tab navigation
- Empty state follows emotional design pattern (inviting, guiding)

---

## US-UI-02: Browse Tools

### Problem
Priya Sharma manages a workspace with 15+ integration tools across GitHub, Slack, and Linear. She finds it difficult to understand which tools exist, their risk levels, and how many agents have access, because this information is only available via raw database queries.

### Who
- Workspace admin | Brain web UI | Needs overview of all registered tools

### Solution
A tools list view grouped by toolkit with filtering by status and risk_level, search, and per-tool grant counts.

### Domain Examples
#### 1: Browse grouped tools
Priya opens the Tools tab. She sees 4 tools under "github" header, 2 under "slack", and 3 under "linear". Each row shows: github.create_issue | medium | active | 3 grants | github.

#### 2: Filter high-risk tools
Priya selects risk_level "high" from the filter dropdown. Only github.merge_pr and linear.delete_issue appear. She verifies each has governance policies attached.

#### 3: Search for specific tool
Priya types "create" in the search field. github.create_issue, slack.create_channel, and linear.create_issue appear. She clicks github.create_issue to see its detail.

### UAT Scenarios (BDD)

#### Scenario: Tools grouped by toolkit
Given "Acme Engineering" has mcp_tools: github.create_issue, github.list_reviews, slack.post_message, slack.list_channels
When Priya opens the Tools tab
Then tools are grouped under headers "github" (2 tools) and "slack" (2 tools)
And each tool row shows name, risk_level badge, status, grant count, and provider name

#### Scenario: Filter by risk level
Given 5 active tools with risk_levels: 2 low, 2 medium, 1 high
When Priya selects risk_level filter "high"
Then only 1 tool is displayed

#### Scenario: Search tools by name
Given 8 tools exist across 3 toolkits
When Priya types "merge" in the search field
Then only github.merge_pr is displayed

#### Scenario: Empty search results
Given 8 tools exist
When Priya types "nonexistent" in the search field
Then the list shows "No tools match your search"

### Acceptance Criteria
- [ ] Tools fetched from existing backend API and grouped by toolkit field
- [ ] Each tool row displays: name, description (truncated), risk_level badge, status badge, grant count, provider name
- [ ] Dropdown filters for status (active/disabled) and risk_level (low/medium/high)
- [ ] Client-side text search on tool name and description
- [ ] Empty search state with helpful message
- [ ] Risk level badges use color conventions: low=green, medium=amber, high=red

### Outcome KPIs
- **Who**: Workspace admins
- **Does what**: Find a specific tool by name or risk level
- **By how much**: Under 10 seconds (vs 30+ seconds via API query)
- **Measured by**: Time from page load to filter/search action
- **Baseline**: No browsing UI exists

### Technical Notes
- Follow list pattern from learnings-page.tsx (LearningList + LearningFilters)
- Group by toolkit field; collapse/expand groups
- Grant count from subquery: `SELECT count() FROM can_use WHERE out = $parent.id`
- Risk level badge colors: low=green, medium=amber, high=red (shadcn Badge + variant)

---

## US-UI-03: Register Credential Provider

### Problem
Priya Sharma needs to register OAuth2 and API key providers so her team's agents can use GitHub and internal APIs. Currently she must construct POST requests manually with correct JSON payloads, remembering which fields are required for each auth method.

### Who
- Workspace admin | Brain web UI | Needs to register credential providers without API calls

### Solution
An "Add Provider" dialog with a form that adapts its fields based on the selected auth_method.

### Domain Examples
#### 1: Register OAuth2 provider (GitHub)
Priya clicks "Add Provider", selects auth_method "oauth2". The form reveals: name, display_name, authorization_url, token_url, client_id, client_secret, scopes. She fills in GitHub's OAuth app credentials and clicks "Create Provider". The provider appears in the list.

#### 2: Register API key provider (Internal API)
Priya clicks "Add Provider", selects auth_method "api_key". The form shows only: name, display_name. No OAuth fields are visible. She enters "internal-api" and "Internal API", clicks "Create Provider".

#### 3: Duplicate name rejected
Priya tries to register another provider named "github". The form shows inline error: "A provider named 'github' already exists" and the submit button remains disabled.

### UAT Scenarios (BDD)

#### Scenario: Adaptive form for OAuth2
Given Priya clicks "Add Provider"
When she selects auth_method "oauth2"
Then the form displays fields: name, display_name, authorization_url, token_url, client_id, client_secret, scopes
And client_secret field uses password input masking

#### Scenario: Adaptive form for API key
Given Priya clicks "Add Provider"
When she selects auth_method "api_key"
Then the form displays only: name, display_name
And no OAuth-specific fields are visible

#### Scenario: Successful provider creation
Given Priya fills the OAuth2 form with name "github", display_name "GitHub", valid authorization_url, token_url, client_id "Ov23liABC123", client_secret, and scopes "repo,read:org"
When she clicks "Create Provider"
Then the dialog closes
And "GitHub" appears in the provider list
And a success toast confirms "Provider created"

#### Scenario: Duplicate name validation
Given credential_provider "github" exists in the workspace
When Priya enters name "github" in the Add Provider form
Then inline error appears: "A provider named 'github' already exists"
And the "Create Provider" button is disabled

### Acceptance Criteria
- [ ] Dialog form with auth_method selector (oauth2, api_key, bearer, basic)
- [ ] Form fields adapt based on auth_method selection
- [ ] Client_secret field masked as password input
- [ ] Inline validation: required fields, duplicate name check
- [ ] On success: dialog closes, provider list refreshes, success toast
- [ ] On error: form data preserved, error message displayed

### Outcome KPIs
- **Who**: Workspace admins
- **Does what**: Register a credential provider via UI
- **By how much**: Under 2 minutes (vs 5+ minutes constructing API calls)
- **Measured by**: Time from "Add Provider" click to successful creation
- **Baseline**: API-only (manual JSON construction)

### Technical Notes
- Follow dialog pattern from CreatePolicyDialog or CreateDialog in learnings
- POST to existing credential provider registration endpoint
- Client secret never returned in API response (backend enforces)
- Validate authorization_url and token_url as valid URLs on blur

---

## US-UI-04: Connect Account (Static Credentials)

### Problem
Carlos Mendez wants agents to use Internal API tools on his behalf. He currently has no way to securely provide his API key through the UI -- he would need to make raw API calls and handle encryption details himself.

### Who
- Workspace member | Brain web UI | Needs to connect accounts with API key, bearer, or basic auth

### Solution
A Connect dialog per provider that adapts to the auth_method, showing appropriate credential fields with security messaging.

### Domain Examples
#### 1: Connect with API key
Carlos clicks "Connect" on Internal API (auth_method: api_key). A dialog shows one field: API Key (password-masked). He pastes his key, clicks "Connect". The provider status changes to "Connected".

#### 2: Connect with basic auth
Carlos clicks "Connect" on Legacy Service (auth_method: basic). A dialog shows username and password fields. He enters credentials, clicks "Connect". Status shows "Connected".

#### 3: Connect with bearer token
Carlos clicks "Connect" on Monitoring API (auth_method: bearer). A dialog shows one field: Bearer Token (password-masked). He pastes the token, clicks "Connect".

### UAT Scenarios (BDD)

#### Scenario: API key connection form
Given credential_provider "internal-api" with auth_method "api_key" exists
When Carlos clicks "Connect" on Internal API
Then a dialog shows an API Key field (password-masked)
And text explains "Your key will be encrypted and stored securely"

#### Scenario: Basic auth connection form
Given credential_provider "legacy-service" with auth_method "basic" exists
When Carlos clicks "Connect" on Legacy Service
Then a dialog shows username and password fields

#### Scenario: Successful static connection
Given Carlos enters a valid API key for Internal API
When he clicks "Connect"
Then the dialog closes
And Internal API shows status "Connected" in the Providers tab
And a success toast confirms "Account connected"

#### Scenario: Empty credential rejected
Given Carlos opens the Connect dialog for Internal API
When he clicks "Connect" without entering an API key
Then inline validation shows "API key is required"

### Acceptance Criteria
- [ ] Connect dialog adapts to auth_method: api_key (1 field), bearer (1 field), basic (2 fields)
- [ ] Credential fields use password input masking
- [ ] Security messaging: "Your credentials will be encrypted and stored securely"
- [ ] Required field validation prevents empty submission
- [ ] On success: dialog closes, provider status updates, success toast
- [ ] On error: form data preserved, error message displayed

### Outcome KPIs
- **Who**: Workspace members
- **Does what**: Connect an account to a static credential provider
- **By how much**: Under 30 seconds per provider
- **Measured by**: Time from "Connect" click to "Connected" status
- **Baseline**: No UI path exists

### Technical Notes
- POST to existing account connection endpoint
- Credentials encrypted server-side (AES-256-GCM) -- UI sends plaintext over HTTPS
- One active connected_account per identity+provider (backend enforces)

---

## US-UI-05: Grant Tool Access

### Problem
Priya Sharma needs to control which agents can use which integration tools. Without a UI, she must construct RELATE queries or API calls with exact record IDs to create can_use edges, and has no visual way to see who has access to what.

### Who
- Workspace admin | Brain web UI | Needs to grant and view tool access per identity

### Solution
An Access tab showing tools with their current grants, and a Grant dialog with identity picker and optional rate limit.

### Domain Examples
#### 1: Grant access with rate limit
Priya selects github.create_issue on the Access tab, clicks "Grant Access". She picks identity "coding-agent-1" from the dropdown, sets max_calls_per_hour to 20, and clicks "Grant Access". The grant appears in the list.

#### 2: View existing grants
Priya views github.create_issue grants: coding-agent-1 (direct, 20/hr, 2026-03-23), review-agent (direct, unlimited, 2026-03-22), design-agent (skill: code-review, unlimited, 2026-03-21).

#### 3: Duplicate grant prevented
Priya tries to grant coding-agent-1 access to github.create_issue again. A toast shows "This identity already has access to this tool".

### UAT Scenarios (BDD)

#### Scenario: Grant tool access to identity
Given mcp_tool "github.create_issue" exists
When Priya opens the Grant Access dialog for "github.create_issue"
And selects identity "coding-agent-1" and sets max_calls_per_hour to 20
And clicks "Grant Access"
Then a can_use edge is created
And the grant appears in the tool's grant list
And the tool's grant count in the Tools tab increments

#### Scenario: View grants with source labels
Given identity "coding-agent-1" has 2 direct grants and 1 skill-derived tool
When Priya views the grant list for "coding-agent-1"
Then all 3 grants are shown
And direct grants show source "direct"
And skill-derived grants show the skill name

#### Scenario: Duplicate grant rejected
Given "coding-agent-1" already has a can_use edge to "github.create_issue"
When Priya attempts to grant the same tool again
Then a toast shows "This identity already has access to this tool"

### Acceptance Criteria
- [ ] Access tab lists tools with expandable grant rows
- [ ] Grant dialog with identity dropdown and optional max_calls_per_hour field
- [ ] Grant list shows: identity name, source (direct/skill name), rate limit, granted_at
- [ ] Duplicate grant detection with user-friendly message
- [ ] Grant count in Tools tab updates after mutation

### Outcome KPIs
- **Who**: Workspace admins
- **Does what**: Grant tool access to an identity via UI
- **By how much**: Under 30 seconds per grant (vs 2+ minutes via API)
- **Measured by**: Time from opening Grant dialog to confirmation
- **Baseline**: API-only

### Technical Notes
- Identity list from existing workspace identity API
- POST to tool grant endpoint (creates can_use edge)
- Invalidate both Access tab and Tools tab (grant_count) query caches on mutation

---

## US-UI-06: Connect Account (OAuth2 Flow)

### Problem
Carlos Mendez wants agents to create GitHub issues on his behalf, but GitHub requires OAuth2 authorization. He has no way to initiate the OAuth consent flow from the Brain UI -- the redirect URL handling and token exchange require manual API orchestration.

### Who
- Workspace member | Brain web UI | Needs to connect accounts via OAuth2 consent flow

### Solution
A Connect button that shows scope summary, redirects to provider's authorization URL, and handles the callback to store encrypted tokens.

### Domain Examples
#### 1: Successful GitHub OAuth2 connection
Carlos clicks "Connect" on GitHub. A dialog shows requested scopes (repo, read:org) and explains credentials will be stored securely. He clicks "Continue to GitHub", authorizes at GitHub's consent screen, and is redirected back. GitHub now shows "Connected".

#### 2: User denies consent
Carlos clicks "Connect" on Slack, is redirected to Slack's OAuth page, but clicks "Deny". He returns to the Providers tab with a toast: "Connection cancelled". No partial state is created.

#### 3: Token exchange failure
Carlos authorizes at GitHub, but the token exchange fails (e.g., client_secret mismatch). He returns to the Providers tab with an error toast: "Could not complete connection. Please contact your workspace admin." GitHub shows "Not connected".

### UAT Scenarios (BDD)

#### Scenario: OAuth2 pre-redirect confirmation
Given credential_provider "github" with auth_method "oauth2" and scopes "repo,read:org"
When Carlos clicks "Connect" on GitHub
Then a confirmation dialog shows scopes: repo, read:org
And text explains "You will be redirected to GitHub to authorize Brain"

#### Scenario: Successful OAuth2 connection
Given Carlos clicks "Continue to GitHub" in the confirmation dialog
And authorizes Brain at GitHub's consent screen
When GitHub redirects back to Brain's callback URL
Then the Providers tab shows GitHub as "Connected"
And a success toast confirms "GitHub account connected"

#### Scenario: OAuth2 consent denied
Given Carlos is redirected to GitHub's authorization URL
When he denies consent
Then he returns to the Providers tab
And a toast shows "Connection cancelled"
And GitHub remains "Not connected"

#### Scenario: OAuth2 token exchange failure
Given Carlos authorizes at GitHub
When the token exchange fails
Then he returns to the Providers tab
And an error toast shows "Could not complete connection. Please contact your workspace admin."

### Acceptance Criteria
- [ ] Pre-redirect dialog shows provider name, requested scopes, and security explanation
- [ ] "Continue to {provider}" button initiates OAuth2 redirect
- [ ] Callback URL handles success: creates connected_account, redirects to Providers tab
- [ ] Callback URL handles error: shows toast, no partial state
- [ ] Consent denial returns user with "Connection cancelled" message

### Outcome KPIs
- **Who**: Workspace members
- **Does what**: Connect OAuth2 accounts (GitHub, Slack, Linear) via UI
- **By how much**: Under 60 seconds from click to "Connected" status
- **Measured by**: Time from "Connect" click to callback completion
- **Baseline**: No UI path exists

### Technical Notes
- Backend generates authorization URL with state param (CSRF protection)
- Callback route exchanges code for tokens server-side
- Redirect URI must be configured per provider (admin responsibility)
- Handle popup-blocked browsers: consider same-window redirect vs popup

---

## US-UI-07: Connected Accounts Dashboard

### Problem
Carlos Mendez has connected 4 provider accounts over time. He has no visibility into which are still active, which expired, or how to revoke access. He would need to query the database to find his connected_account records.

### Who
- Workspace member | Brain web UI | Needs visibility into connected accounts with revoke/reconnect actions

### Solution
An Accounts tab listing all connected accounts for the current identity with status badges and contextual actions (Revoke for active, Reconnect for expired/revoked).

### Domain Examples
#### 1: View mixed-status accounts
Carlos opens the Accounts tab. He sees: GitHub (active, 2026-03-20), Slack (active, 2026-03-23), Internal API (active, 2026-03-22), Legacy Service (expired, 2026-03-15). Active accounts show "Revoke" buttons, expired shows "Reconnect".

#### 2: Revoke active account
Carlos clicks "Revoke" on GitHub. A confirmation dialog warns: "This will permanently delete your stored credentials. Agents will no longer be able to use GitHub tools on your behalf." He confirms. GitHub status changes to "revoked".

#### 3: Reconnect expired account
Carlos clicks "Reconnect" on Legacy Service (auth_method: basic). The connection form appears with username and password fields. After entering new credentials, the account returns to "active".

### UAT Scenarios (BDD)

#### Scenario: View connected accounts
Given Carlos has connected accounts: GitHub (active), Slack (active), Legacy Service (expired)
When he opens the Accounts tab
Then all 3 accounts are listed
And each shows provider display_name, status badge, and connected_at date
And active accounts show "Revoke" button
And expired account shows "Reconnect" button

#### Scenario: Revoke connected account
Given Carlos has an active GitHub connected account
When he clicks "Revoke" on GitHub
Then a confirmation dialog warns about permanent credential deletion
When he clicks "Revoke Access"
Then GitHub status changes to "revoked" with immediate UI update
And a success toast confirms "GitHub account disconnected"

#### Scenario: Reconnect expired account
Given Carlos has an expired Legacy Service account (auth_method: basic)
When he clicks "Reconnect" on Legacy Service
Then the appropriate connection form appears (username + password)
When he enters new credentials and submits
Then Legacy Service status changes to "active"

#### Scenario: Empty accounts state
Given Carlos has no connected accounts
When he opens the Accounts tab
Then a message shows "No connected accounts. Visit the Providers tab to connect your first account."
And a link navigates to the Providers tab

### Acceptance Criteria
- [ ] Accounts tab lists all connected_account records for current identity
- [ ] Each row shows: provider display_name, status badge (active=green, expired=amber, revoked=red), connected_at
- [ ] Active accounts show "Revoke" action
- [ ] Expired/revoked accounts show "Reconnect" action
- [ ] Revoke shows confirmation dialog with destructive styling
- [ ] Reconnect opens the appropriate connection form (OAuth2 redirect or static form)
- [ ] Empty state with guidance to Providers tab

### Outcome KPIs
- **Who**: Workspace members
- **Does what**: Identify and act on expired/revoked accounts without admin help
- **By how much**: 100% self-service (vs requiring admin DB query)
- **Measured by**: % of revoke/reconnect actions done via UI
- **Baseline**: No visibility into account status

### Technical Notes
- GET existing connected accounts endpoint filtered by current identity
- Revoke calls existing revocation endpoint (hard-deletes credentials)
- Status badge colors: active=green, expired=amber, revoked=red (shadcn Badge)
- Reconnect for OAuth2 initiates same flow as initial connect

---

## US-UI-08: Tool Governance UI

### Problem
Priya Sharma has registered high-risk tools like github.merge_pr but has no way to attach governance policies through the UI. She must construct governs_tool relation edges via raw API calls, and cannot see which tools are governed at a glance.

### Who
- Workspace admin | Brain web UI | Needs to attach governance policies to tools and see governance status

### Solution
A governance attachment dialog accessible from the Tools tab, allowing admins to attach existing policies to tools with conditions and rate limits.

### Domain Examples
#### 1: Attach approval policy to high-risk tool
Priya clicks the governance icon on github.merge_pr in the Tools tab. She selects policy "no-auto-merge", sets condition "requires_human_approval", and optionally sets max_per_day to 5. She clicks "Attach Policy".

#### 2: View governed tools
Priya filters the Tools tab to see tools with governance. github.merge_pr shows a shield icon indicating it has 1 attached policy. She expands it to see: "no-auto-merge (requires_human_approval, max 5/day)".

#### 3: Tool without governance
Priya notices slack.post_message (risk_level: medium) has no governance policies. She attaches a rate-limit-only policy with max_per_day = 100.

### UAT Scenarios (BDD)

#### Scenario: Attach governance policy to tool
Given mcp_tool "github.merge_pr" with risk_level "high" exists
And policy "no-auto-merge" is active in the workspace
When Priya opens the governance dialog for github.merge_pr
And selects policy "no-auto-merge" with condition "requires_human_approval"
And sets max_per_day to 5
And clicks "Attach Policy"
Then a governs_tool edge is created
And github.merge_pr shows a governance indicator in the Tools tab

#### Scenario: View governance details on tool
Given github.merge_pr has policy "no-auto-merge" attached with condition "requires_human_approval"
When Priya expands github.merge_pr in the Tools tab
Then the governance section shows: policy name, condition, and rate limits

#### Scenario: Only active policies available
Given 3 policies exist: "no-auto-merge" (active), "rate-limiter" (active), "old-policy" (deprecated)
When Priya opens the governance dialog
Then only "no-auto-merge" and "rate-limiter" appear in the policy picker

### Acceptance Criteria
- [ ] Governance icon/indicator visible on governed tools in the Tools tab
- [ ] Governance dialog with policy picker (active policies only), condition field, max_calls_per_hour, max_per_day
- [ ] On success: governs_tool edge created, tool indicator updates
- [ ] Governance details visible in expanded tool row
- [ ] Policy picker fetches from existing policies API

### Outcome KPIs
- **Who**: Workspace admins
- **Does what**: Attach governance policies to tools via UI
- **By how much**: Under 60 seconds per policy attachment
- **Measured by**: Time from governance dialog open to confirmation
- **Baseline**: API-only (manual edge creation)

### Technical Notes
- Policy list from existing GET /api/workspaces/:ws/policies (filter status=active)
- POST to tool governance endpoint (creates governs_tool edge)
- Governance indicator: shield icon on tool row when governs_tool edges exist
- Condition field: select from known conditions (requires_human_approval, rate_limit_only)

---

## US-UI-09: MCP Server Connection

### Problem
Priya Sharma needs to connect her workspace to external MCP servers (such as a company-hosted GitHub MCP server at `https://mcp.acme.dev/github`) so that Brain can discover and use the tools those servers expose. Currently, every `mcp_tool` record must be created manually with exact JSON schemas -- a tedious, error-prone process that does not scale when a server exposes 20+ tools.

### Who
- Workspace admin | Brain web UI | Needs to register external MCP server endpoints and trigger tool discovery

### Solution
An "Add MCP Server" dialog in the Tools tab's server section, where the admin enters a URL, selects transport, optionally links a credential provider for authenticated servers, and saves the connection.

### Domain Examples
#### 1: Connect unauthenticated MCP server
Priya clicks "Add MCP Server" in the Tools tab. She enters name "GitHub Tools", URL "https://mcp.acme.dev/github", and leaves transport as "Streamable HTTP" (default). No credential provider is selected because the server requires no authentication. She clicks "Connect". The server appears in the MCP Servers section with status "ok" and 0 tools.

#### 2: Connect authenticated MCP server
Priya clicks "Add MCP Server", enters name "Jira Tools", URL "https://mcp.acme.dev/jira", selects transport "SSE", and links credential provider "jira-api-key" from the dropdown. She clicks "Connect". Brain connects using the decrypted API key from Priya's connected account for that provider.

#### 3: Connection failure with helpful error
Priya enters URL "https://mcp.acme.dev/nonexistent" and clicks "Connect". After a brief spinner, the dialog shows: "Could not connect to MCP server. The server did not respond at this URL. Verify the URL and try again." The server is saved with status "error" and last_error populated.

### UAT Scenarios (BDD)

#### Scenario: Register unauthenticated MCP server
Given Priya is on the Tools tab in "Acme Engineering" workspace
When she clicks "Add MCP Server"
And enters name "GitHub Tools" and URL "https://mcp.acme.dev/github"
And selects transport "Streamable HTTP"
And clicks "Connect"
Then the server is created with status "ok"
And the MCP Servers section shows "GitHub Tools" with 0 tools

#### Scenario: Register authenticated MCP server
Given credential_provider "jira-api-key" exists with auth_method "api_key"
And Priya has a connected account for "jira-api-key"
When she clicks "Add MCP Server"
And enters name "Jira Tools", URL "https://mcp.acme.dev/jira", transport "SSE"
And selects credential provider "jira-api-key"
And clicks "Connect"
Then the server is created
And Brain connected using the decrypted credential from Priya's account

#### Scenario: Connection failure shows actionable error
Given Priya enters URL "https://mcp.acme.dev/nonexistent"
When she clicks "Connect"
Then the dialog shows an error: "Could not connect to MCP server"
And suggests verifying the URL
And the server is saved with status "error"

#### Scenario: Transport auto-detect fallback
Given Priya enters a URL for an MCP server that only supports SSE transport
When she selects "Streamable HTTP" and clicks "Connect"
And the connection fails with a 4xx response
Then Brain automatically retries with SSE transport
And the server is saved with transport "sse" and status "ok"

#### Scenario: Duplicate server name rejected
Given mcp_server "GitHub Tools" exists in the workspace
When Priya enters name "GitHub Tools" in the Add MCP Server dialog
Then inline error appears: "A server named 'GitHub Tools' already exists"

### Acceptance Criteria
- [ ] "Add MCP Server" button visible in Tools tab MCP Servers section
- [ ] Dialog with fields: name, URL, transport selector (Streamable HTTP / SSE), optional credential provider dropdown
- [ ] URL validation: only http:// and https:// allowed
- [ ] Duplicate server name validation (unique per workspace)
- [ ] On success: dialog closes, server appears in list with status indicator
- [ ] On connection failure: error message displayed with guidance, server saved with "error" status
- [ ] Transport auto-detect: fallback from Streamable HTTP to SSE on 4xx failure

### Outcome KPIs
- **Who**: Workspace admins
- **Does what**: Register an external MCP server via UI
- **By how much**: Under 30 seconds per server connection
- **Measured by**: Time from "Add MCP Server" click to server appearing in list
- **Baseline**: No server connection capability exists

### Technical Notes
- POST to `/api/workspaces/:wsId/mcp-servers` creates record
- After creation, server attempts connection + `initialize` handshake to validate URL
- Transport auto-detect: try streamable-http first, fall back to SSE on 4xx
- Credential injection: if provider linked, decrypt credentials from connected_account and inject as HTTP headers
- `mcp_server` table requires migration (see architecture-mcp-discovery.md)
- Depends on: MCP client module (`mcp-client.ts`) using `@modelcontextprotocol/sdk/client`
- ADR-070: on-demand connections only (no persistent subscriptions)

---

## US-UI-10: Tool Discovery and Import

### Problem
After connecting an MCP server, Priya Sharma needs to discover what tools it exposes and selectively import them into Brain's tool registry. Without this, she would have to manually inspect the MCP server's `tools/list` response and create each `mcp_tool` record by hand -- copying tool names, descriptions, and JSON schemas one at a time.

### Who
- Workspace admin | Brain web UI | Needs to preview and selectively import tools from connected MCP servers

### Solution
A discovery flow triggered per server: Brain calls `tools/list`, shows the admin a review panel with tool names, inferred risk levels, and planned actions (new/update/disable), then applies selected changes on confirmation.

### Domain Examples
#### 1: First discovery -- all new tools
Priya clicks "Discover" on the "GitHub Tools" server. Brain connects, calls `tools/list`, and returns 12 tools. The review panel shows all 12 as "New" with inferred risk_levels: 5 low (read-only hints), 4 medium (no annotations), 2 high (destructive hints), 1 critical (destructive, no confirmation). All are selected by default. Priya unchecks `github.admin_delete_repo` (critical), then clicks "Import Selected". 11 tools are created as `mcp_tool` records linked to this server.

#### 2: Re-sync with changes
A month later, the GitHub MCP server has added 2 new tools and updated the schema for `github.create_pr`. Priya clicks "Sync" on "GitHub Tools". The review panel shows: 2 new, 1 updated (expandable diff showing schema changes), 0 disabled, 9 unchanged. She confirms and all 3 changes are applied.

#### 3: Server removed tools
The GitHub MCP server deprecated `github.legacy_search`. Priya clicks "Sync". The review panel shows 1 tool as "Disabled" -- it will be set to status "disabled" but not deleted. She confirms. The tool remains in Brain's registry with status "disabled" and is no longer injected by the proxy.

### UAT Scenarios (BDD)

#### Scenario: First discovery shows all tools as new
Given mcp_server "GitHub Tools" is connected with status "ok"
And the server exposes 12 tools via tools/list
When Priya clicks "Discover" on "GitHub Tools"
Then a review panel shows 12 tools with action "new"
And each tool shows name, description, and inferred risk_level badge
And all tools are selected by default

#### Scenario: Selective import
Given the discovery review panel shows 12 new tools
And Priya unchecks "github.admin_delete_repo"
When she clicks "Import Selected"
Then 11 mcp_tool records are created with source_server linking to "GitHub Tools"
And "github.admin_delete_repo" is not created
And "GitHub Tools" server shows tool_count = 11

#### Scenario: Re-sync shows diff
Given "GitHub Tools" has 11 imported tools
And the server now exposes 13 tools (2 new, 1 with updated schema, 10 unchanged)
When Priya clicks "Sync" on "GitHub Tools"
Then the review panel shows: 2 "new", 1 "updated", 0 "disabled", 10 "unchanged"
And the "updated" tool has an expandable diff showing schema changes

#### Scenario: Risk level inferred from MCP annotations
Given the MCP server tool "github.delete_repo" has annotation destructiveHint: true
And tool "github.list_repos" has annotation readOnlyHint: true
When the discovery review panel displays
Then "github.delete_repo" shows risk_level "high"
And "github.list_repos" shows risk_level "low"

#### Scenario: Admin overrides inferred risk level
Given the discovery review shows "github.create_pr" with inferred risk_level "medium"
When Priya changes the risk_level to "high" in the review panel
And clicks "Import Selected"
Then the created mcp_tool has risk_level "high"

### Acceptance Criteria
- [ ] "Discover" button on each server row triggers dry-run discovery
- [ ] Review panel shows per-tool breakdown: name, description, risk_level badge, action (new/update/disable/unchanged)
- [ ] Checkboxes for selective import (all selected by default for "new"; all selected for "update")
- [ ] "Unchanged" tools collapsed by default in review panel
- [ ] Risk level inferred from MCP tool annotations (readOnlyHint, destructiveHint, idempotentHint)
- [ ] Admin can override inferred risk_level before import
- [ ] "Import Selected" applies changes and updates server tool_count
- [ ] Sync shows schema diff for updated tools (expandable)

### Outcome KPIs
- **Who**: Workspace admins
- **Does what**: Import tools from an MCP server without manual JSON creation
- **By how much**: Under 2 minutes for 20+ tools (vs 30+ minutes manually)
- **Measured by**: Time from "Discover" click to tools appearing in Tools tab
- **Baseline**: Manual tool creation only (no discovery capability)

### Technical Notes
- POST `/api/workspaces/:wsId/mcp-servers/:serverId/discover?dry_run=true` returns DiscoveryResult
- POST `/api/workspaces/:wsId/mcp-servers/:serverId/sync` applies changes
- Risk inference: readOnlyHint=true -> low, destructiveHint=true -> high, destructiveHint+no confirmationHint -> critical, default -> medium
- Sync algorithm: compare by tool name, deep-equal on input_schema + description for change detection
- Discovered tools get `source_server` field linking back to mcp_server record
- Depends on: US-UI-09 (server must be connected first)

---

## US-UI-11: Tool Execution via Proxy

### Problem
When the LLM generates a `tool_use` block for a Brain-managed integration tool (e.g., `github.create_issue`), the proxy pipeline classifies the call as "integration" (step 8.5) but has no executor to actually perform the call. The tool call is effectively dropped -- the agent receives no result, and the LLM's multi-turn conversation stalls. This is invisible to end users but renders the entire tool injection pipeline non-functional.

### Who
- Proxy pipeline (automated) | No direct UI | Critical for agents to use injected integration tools

### Solution
A Tool Executor that connects to the upstream MCP server, calls `tools/call` with the tool name and input, returns the result as a `tool_result` message, and loops until the LLM produces a final text response (not another `tool_use`).

### Domain Examples
#### 1: Single tool call execution
Coding-agent-1 asks the LLM to create a GitHub issue. The LLM responds with `tool_use: github.create_issue` and input `{ title: "Fix login timeout", body: "Users report..." }`. The proxy classifies this as "integration", looks up the `mcp_tool` record to find source_server "GitHub Tools", connects to `https://mcp.acme.dev/github`, calls `tools/call` with the tool name and input, gets back `{ issue_url: "https://github.com/acme/app/issues/247" }`, constructs a `tool_result` message, and resends to the LLM. The LLM produces a text response: "I've created issue #247."

#### 2: Multi-turn tool loop
The LLM first calls `github.list_issues` (returns 5 issues), then calls `github.create_comment` on issue #247. The proxy executes each tool call sequentially, feeding results back to the LLM, until the LLM produces a final text response. Total: 3 LLM round-trips.

#### 3: Tool execution failure with graceful degradation
The upstream MCP server is unreachable when the proxy tries to execute `github.create_issue`. The proxy constructs a `tool_result` with `is_error: true` and content "Could not reach the GitHub MCP server. The server may be temporarily unavailable." The LLM receives this error result and informs the user: "I was unable to create the issue because the GitHub service is currently unavailable."

### UAT Scenarios (BDD)

#### Scenario: Single integration tool call executed
Given identity "coding-agent-1" has a can_use grant for "github.create_issue"
And mcp_tool "github.create_issue" has source_server "GitHub Tools" at "https://mcp.acme.dev/github"
And identity "coding-agent-1" has a connected_account for the GitHub credential provider
When the LLM responds with tool_use "github.create_issue" with input { title: "Fix login timeout" }
Then the proxy connects to "https://mcp.acme.dev/github" with decrypted credentials
And calls tools/call with name "github.create_issue" and the input
And constructs a tool_result message with the MCP server response
And resends to the LLM with the tool_result appended

#### Scenario: Multi-turn tool loop completes
Given the LLM responds with tool_use "github.list_issues"
When the proxy executes the tool call and returns the result
And the LLM responds with another tool_use "github.create_comment"
And the proxy executes that tool call and returns the result
And the LLM responds with a text message (stop_reason: "end_turn")
Then the proxy returns the final text response to the client
And total LLM round-trips equal 3

#### Scenario: Upstream MCP server unreachable
Given mcp_tool "github.create_issue" has source_server "GitHub Tools"
And the GitHub MCP server is unreachable
When the proxy attempts to execute tool_use "github.create_issue"
Then the proxy constructs a tool_result with is_error: true
And the content explains the server is unavailable
And the LLM receives the error and responds to the user accordingly

#### Scenario: Credential injection during execution
Given mcp_tool "jira.create_ticket" has source_server "Jira Tools"
And "Jira Tools" is linked to credential_provider "jira-api-key"
And the requesting identity has a connected_account for "jira-api-key" with encrypted API key
When the proxy executes tool_use "jira.create_ticket"
Then the proxy decrypts the API key from the connected_account
And injects it as an HTTP header on the MCP transport connection

#### Scenario: OAuth2 token refresh before execution
Given mcp_tool "github.create_issue" source_server uses OAuth2 credentials
And the requesting identity's access_token has expired but refresh_token is valid
When the proxy prepares to execute the tool call
Then the proxy refreshes the access_token using the refresh_token
And stores the new access_token encrypted in the connected_account
And proceeds with the tool call using the fresh token

### Acceptance Criteria
- [ ] Proxy step 9: integration-classified tool calls are executed on the upstream MCP server
- [ ] Tool Executor connects to source_server URL with correct transport
- [ ] Credential injection: API key, bearer, basic, and OAuth2 credentials decrypted and injected as HTTP headers
- [ ] OAuth2 token refresh: expired access_token refreshed before execution if refresh_token available
- [ ] tool_result message constructed from MCP server response and appended to conversation
- [ ] Multi-turn loop: proxy re-sends to LLM until stop_reason is not "tool_use" (max 10 iterations safety limit)
- [ ] Error handling: unreachable server produces tool_result with is_error: true and descriptive message
- [ ] Connection is short-lived: connect, execute, disconnect per tool call (ADR-070 on-demand pattern)

### Outcome KPIs
- **Who**: Agents (coding-agent, review-agent, etc.) using injected integration tools
- **Does what**: Successfully execute integration tool calls end-to-end
- **By how much**: 95% tool call success rate (excluding upstream server failures)
- **Measured by**: Proxy trace logs: tool_use classified as integration -> tool_result returned
- **Baseline**: 0% (tool calls classified but never executed)

### Technical Notes
- New module: `app/src/server/proxy/tool-executor.ts`
- Uses MCP client module from `tool-registry/mcp-client.ts` (same as discovery)
- Credential resolution: `mcp_tool.source_server -> mcp_server.provider -> connected_account` -> decrypt
- OAuth2 refresh: call token_url with refresh_token grant_type, update encrypted tokens
- Multi-turn loop safety: max 10 iterations to prevent infinite loops
- Connection per call (ADR-070): no persistent MCP client connections; connect -> call -> disconnect
- The existing `tool-router.ts` classifyToolCalls() already identifies "integration" calls -- executor consumes this classification
- Depends on: MCP client module, credential brokerage (existing), mcp_server records (US-UI-09)

---

## US-UI-12: MCP Server Management

### Problem
After connecting multiple MCP servers, Priya Sharma needs ongoing visibility into their status and the ability to re-sync, disconnect, or remove them. Without a management view, she has no way to know if a server went offline, when tools were last synced, or how to clean up decommissioned servers.

### Who
- Workspace admin | Brain web UI | Needs to monitor and manage connected MCP servers

### Solution
An MCP Servers section at the top of the Tools tab showing all connected servers with status indicators, last sync time, tool counts, and actions (Sync, Disconnect, Remove).

### Domain Examples
#### 1: View server status dashboard
Priya opens the Tools tab. The MCP Servers section shows: "GitHub Tools" (ok, 11 tools, synced 2h ago), "Jira Tools" (ok, 8 tools, synced 1d ago), "Legacy API" (error, 0 tools, last error: "Connection refused"). Green dots for "ok", red dots for "error".

#### 2: Remove decommissioned server
The Legacy API server has been decommissioned. Priya clicks "Remove" on it. A confirmation dialog warns: "This will remove the server registration. 0 discovered tools will be disabled." She confirms. The server disappears from the list.

#### 3: Disconnect without removing
Priya clicks "Disconnect" on "Jira Tools". The server status changes to "disconnected" but the 8 discovered tools remain in the registry (still usable if the server comes back). She can re-connect later by clicking "Reconnect".

### UAT Scenarios (BDD)

#### Scenario: View server list with status
Given workspace has 3 mcp_servers: "GitHub Tools" (ok), "Jira Tools" (ok), "Legacy API" (error)
When Priya views the Tools tab
Then the MCP Servers section lists all 3 servers
And each shows: name, URL, status indicator (green/red), tool_count, last_discovery timestamp

#### Scenario: Remove server and disable tools
Given mcp_server "Legacy API" has 3 discovered tools
When Priya clicks "Remove" on "Legacy API"
And confirms the removal
Then the mcp_server record is deleted
And the 3 discovered tools have status set to "disabled"
And the server disappears from the MCP Servers section

#### Scenario: Re-sync server tools
Given mcp_server "GitHub Tools" was last synced 7 days ago
When Priya clicks "Sync" on "GitHub Tools"
Then the discovery review panel appears (same flow as US-UI-10)
And she can review and apply changes

#### Scenario: Empty server list
Given the workspace has no mcp_servers
When Priya views the Tools tab
Then the MCP Servers section shows "No MCP servers connected. Add a server to discover tools automatically."
And an "Add MCP Server" CTA button is visible

### Acceptance Criteria
- [ ] MCP Servers section at top of Tools tab (collapsible)
- [ ] Server list shows: name, URL, status indicator, tool_count, last_discovery, last_error (if any)
- [ ] Status indicators: ok=green dot, error=red dot
- [ ] "Sync" action per server triggers discovery review flow (US-UI-10)
- [ ] "Remove" action with confirmation dialog; disables discovered tools on removal
- [ ] Empty state with guidance and "Add MCP Server" CTA
- [ ] Last sync time shown as relative time ("2 hours ago", "1 day ago")

### Outcome KPIs
- **Who**: Workspace admins
- **Does what**: Monitor and manage MCP server connections without DB queries
- **By how much**: 100% self-service server management via UI
- **Measured by**: % of server management actions done via UI
- **Baseline**: No server management capability exists

### Technical Notes
- GET `/api/workspaces/:wsId/mcp-servers` returns server list with status
- DELETE `/api/workspaces/:wsId/mcp-servers/:serverId` removes server + disables tools
- Relative time display using date-fns or similar (check existing dependencies)
- MCP Servers section is part of Tools tab (not a separate tab) per ADR-070
- Depends on: US-UI-09 (servers must exist to manage)

---

## Changed Assumptions

### What changed (revision 2, 2026-03-23)

Four new stories added (US-UI-09 through US-UI-12) to address three critical gaps discovered during architecture and proxy code review:

1. **Gap 1 -- Tool Execution (US-UI-11)**: The proxy pipeline classifies tool calls (step 8.5) but has no executor (step 9). Without US-UI-11, the entire tool injection system is non-functional -- the LLM generates tool calls that are silently dropped.

2. **Gap 2 -- MCP Client + Discovery (US-UI-09, US-UI-10, US-UI-12)**: Tools must currently be created manually. US-UI-09 adds server connections, US-UI-10 adds discovery/import, US-UI-12 adds ongoing management.

3. **Gap 3 -- Credential to MCP Transport Injection (US-UI-11)**: Credentials are stored and encrypted but never injected into MCP transport headers. US-UI-11 includes credential injection and OAuth2 token refresh as part of the execution flow.

### Why existing stories were not modified

The original 8 stories (US-UI-01 through US-UI-08) remain valid and unchanged. They cover the UI layer for existing backend capabilities. The new stories address backend gaps that were deferred from the walking skeleton but are now recognized as prerequisites for the feature to be functional end-to-end.

### Impact on walking skeleton

The walking skeleton must now include tool execution (US-UI-11) because without it, tools injected by the proxy have no effect. Discovery (US-UI-09, US-UI-10) is the second priority because manual tool creation is a workaround but does not scale.
