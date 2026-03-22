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
