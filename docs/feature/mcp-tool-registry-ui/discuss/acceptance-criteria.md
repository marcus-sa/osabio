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

## US-UI-09: MCP Server Connection

- [ ] AC-09a: "Add MCP Server" button visible in Tools tab MCP Servers section
- [ ] AC-09b: Dialog with fields: name, URL, transport selector, optional credential provider dropdown
- [ ] AC-09c: URL validation rejects non-http/https URLs
- [ ] AC-09d: Duplicate server name (per workspace) shows inline error
- [ ] AC-09e: On success: dialog closes, server appears in list with status indicator
- [ ] AC-09f: On connection failure: error message with guidance, server saved with "error" status
- [ ] AC-09g: Transport auto-detect: fallback from Streamable HTTP to SSE on 4xx

## US-UI-10: Tool Discovery and Import

- [ ] AC-10a: "Discover" button per server triggers dry-run discovery via tools/list
- [ ] AC-10b: Review panel shows per-tool breakdown: name, description, risk_level, action badge
- [ ] AC-10c: Checkboxes for selective import (all new/updated selected by default)
- [ ] AC-10d: "Unchanged" tools collapsed by default
- [ ] AC-10e: Risk level inferred from MCP annotations (readOnlyHint, destructiveHint, idempotentHint)
- [ ] AC-10f: Admin can override inferred risk_level before import
- [ ] AC-10g: "Import Selected" applies changes and updates server tool_count
- [ ] AC-10h: Sync mode shows schema diff for updated tools (expandable)

## US-UI-11: Tool Execution via Proxy

- [ ] AC-11a: Integration-classified tool calls (step 8.5) routed to Tool Executor (step 9)
- [ ] AC-11b: Tool Executor connects to source_server URL using correct transport (SSE or Streamable HTTP)
- [ ] AC-11c: Credentials decrypted and injected as HTTP headers (api_key, bearer, basic, oauth2)
- [ ] AC-11d: OAuth2 token refresh: expired access_token refreshed via refresh_token before execution
- [ ] AC-11e: MCP server response converted to tool_result message and appended to conversation
- [ ] AC-11f: Multi-turn loop: proxy re-sends to LLM until stop_reason is not "tool_use" (max 10 iterations)
- [ ] AC-11g: Unreachable MCP server produces tool_result with is_error: true and descriptive message
- [ ] AC-11h: Connection is short-lived per call: connect, call tools/call, disconnect

## US-UI-12: MCP Server Management

- [ ] AC-12a: MCP Servers section at top of Tools tab (collapsible)
- [ ] AC-12b: Each server row shows: name, URL, status indicator, tool_count, last_discovery, last_error
- [ ] AC-12c: Status indicators: ok=green dot, error=red dot
- [ ] AC-12d: "Sync" action triggers discovery review flow (same as US-UI-10)
- [ ] AC-12e: "Remove" action with confirmation dialog; disables discovered tools on removal
- [ ] AC-12f: Empty state with "Add MCP Server" CTA
- [ ] AC-12g: Last sync time shown as relative time

---

## Changed Assumptions

### What changed (revision 2, 2026-03-23)

Added acceptance criteria for 4 new stories (US-UI-09 through US-UI-12) covering MCP server connection, tool discovery, tool execution, and server management. These address three critical gaps: no tool executor in the proxy pipeline, no MCP client for discovery, and no credential-to-transport injection.

Original criteria (US-UI-01 through US-UI-08) remain unchanged.
