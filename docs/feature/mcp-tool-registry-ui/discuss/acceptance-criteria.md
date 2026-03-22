# Acceptance Criteria -- Tool Registry UI

Derived from UAT scenarios in user-stories.md. Each criterion traces to a specific story.

---

## US-UI-01: Page Shell and Navigation

- [ ] AC-01a: Route /tools registered in TanStack Router under authenticated layout
- [ ] AC-01b: "Tool Registry" appears in workspace sidebar navigation
- [ ] AC-01c: Four tabs render: Tools, Providers, Accounts, Access
- [ ] AC-01d: Empty state displays when no providers/tools exist, with "Add Provider" CTA
- [ ] AC-01e: All tabs reachable via keyboard navigation

## US-UI-02: Browse Tools

- [ ] AC-02a: Tools grouped by toolkit field with group headers showing tool count
- [ ] AC-02b: Each tool row displays name, description, risk_level badge, status badge, grant count, provider name
- [ ] AC-02c: Filter dropdown for status (active/disabled) filters tool list
- [ ] AC-02d: Filter dropdown for risk_level (low/medium/high) filters tool list
- [ ] AC-02e: Text search filters tools by name and description (client-side, instant)
- [ ] AC-02f: Empty search results show "No tools match your search"
- [ ] AC-02g: Risk level badges use color: low=green, medium=amber, high=red

## US-UI-03: Register Credential Provider

- [ ] AC-03a: "Add Provider" opens dialog with auth_method selector
- [ ] AC-03b: Selecting "oauth2" reveals: name, display_name, authorization_url, token_url, client_id, client_secret, scopes
- [ ] AC-03c: Selecting "api_key" reveals only: name, display_name
- [ ] AC-03d: Client_secret field uses password input masking
- [ ] AC-03e: Duplicate provider name shows inline error and disables submit
- [ ] AC-03f: Successful creation closes dialog, refreshes list, shows success toast
- [ ] AC-03g: Failed creation preserves form data and shows error message

## US-UI-04: Connect Account (Static)

- [ ] AC-04a: Connect dialog for api_key shows single masked API key field
- [ ] AC-04b: Connect dialog for basic shows username and password fields
- [ ] AC-04c: Connect dialog for bearer shows single masked token field
- [ ] AC-04d: Security message explains credentials are encrypted and revocable
- [ ] AC-04e: Empty credential submission shows inline validation error
- [ ] AC-04f: Successful connection updates provider status to "Connected" and shows toast

## US-UI-05: Grant Tool Access

- [ ] AC-05a: Access tab lists tools with expandable grant rows
- [ ] AC-05b: Grant dialog has identity dropdown and optional max_calls_per_hour field
- [ ] AC-05c: Successful grant adds row to grant list and increments tool grant count
- [ ] AC-05d: Duplicate grant shows toast: "This identity already has access to this tool"
- [ ] AC-05e: Grant list shows identity name, source (direct/skill), rate limit, granted_at

## US-UI-06: Connect Account (OAuth2)

- [ ] AC-06a: Pre-redirect dialog shows provider name, requested scopes, and security explanation
- [ ] AC-06b: "Continue to {provider}" button redirects to provider authorization URL
- [ ] AC-06c: Successful callback updates provider status to "Connected" and shows toast
- [ ] AC-06d: Consent denial returns to Providers tab with "Connection cancelled" toast
- [ ] AC-06e: Token exchange failure returns to Providers tab with error toast

## US-UI-07: Connected Accounts Dashboard

- [ ] AC-07a: Accounts tab lists connected_account records for current identity
- [ ] AC-07b: Each row shows provider display_name, status badge, connected_at date
- [ ] AC-07c: Active accounts show "Revoke" action
- [ ] AC-07d: Expired/revoked accounts show "Reconnect" action
- [ ] AC-07e: Revoke confirmation dialog warns about permanent credential deletion
- [ ] AC-07f: After revoke, status updates to "revoked" immediately in UI
- [ ] AC-07g: Empty state guides user to Providers tab
- [ ] AC-07h: Reconnect opens appropriate connection form (OAuth2 or static)

## US-UI-08: Tool Governance

- [ ] AC-08a: Governed tools show governance indicator (shield icon) in Tools tab
- [ ] AC-08b: Governance dialog has policy picker with only active policies
- [ ] AC-08c: Governance dialog has condition field and optional rate limit fields
- [ ] AC-08d: Successful attachment creates governs_tool edge and updates indicator
- [ ] AC-08e: Expanded tool row shows attached governance details (policy name, condition, limits)
