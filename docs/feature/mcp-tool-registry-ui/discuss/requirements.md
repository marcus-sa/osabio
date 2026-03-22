# Requirements -- Tool Registry UI

## Business Context

The MCP Tool Registry backend is fully implemented (10/10 walking skeleton phases). This feature layers a React web UI on existing API routes and data models, enabling workspace admins and members to manage integration tools, providers, accounts, and access without CLI or raw API calls.

## JTBD Mapping

| Job | Actor | UI Coverage |
|-----|-------|------------|
| J1: Provider Registration | Workspace Admin (Priya Sharma) | Register providers, browse tools, grant access, attach governance |
| J2: Account Connection | Workspace Member (Carlos Mendez) | Connect accounts (OAuth2 + static), view dashboard, revoke |
| J3: Transparent Tool Injection | Proxy (automated) | No UI needed (proxy-internal) |
| J4: Credential Brokerage | Proxy (automated) | No UI needed (proxy-internal) |

## Functional Requirements

### FR-UI-1: Navigation and Page Shell
- Sidebar entry "Tool Registry" in workspace navigation
- Route `/tools` under authenticated layout
- Tab navigation: Tools, Providers, Accounts, Access
- Empty states with contextual guidance and CTAs

### FR-UI-2: Tool Browsing
- List mcp_tool records grouped by toolkit field
- Columns: name, description, risk_level, status, grant_count, provider
- Filter by status (active/disabled) and risk_level (low/medium/high)
- Client-side search on name and description
- Risk level badges: low=green, medium=amber, high=red

### FR-UI-3: Provider Management
- Add Provider dialog with auth_method selector
- Form adapts to auth_method: OAuth2 shows all OAuth fields; api_key/bearer/basic show name+display_name only
- Client_secret masked as password input
- Inline validation: required fields, duplicate name check
- Provider list with auth_method, tool count, and connection status

### FR-UI-4: Account Connection (Static)
- Connect dialog adapts to auth_method: api_key (1 field), bearer (1 field), basic (2 fields)
- Credential fields masked as password inputs
- Security messaging about encryption and revocability
- One active connected_account per identity+provider

### FR-UI-5: Account Connection (OAuth2)
- Pre-redirect confirmation dialog showing requested scopes
- Redirect to provider authorization URL with state param
- Callback handling: success creates connected_account, failure shows error
- Consent denial returns user with "Connection cancelled" message

### FR-UI-6: Tool Access Management
- Grant dialog with identity picker and optional rate limit
- Grant list per tool showing identity, source (direct/skill), rate limit, granted_at
- Effective toolset view per identity (direct + skill-derived)
- Duplicate grant prevention

### FR-UI-7: Connected Accounts Dashboard
- List connected_account records for current identity
- Status badges: active=green, expired=amber, revoked=red
- Actions: Revoke (active), Reconnect (expired/revoked)
- Revoke confirmation dialog with destructive styling
- Reconnect opens appropriate connection form

### FR-UI-8: Tool Governance
- Governance indicator on governed tools in Tools tab
- Governance dialog with policy picker (active policies only)
- Condition and rate limit configuration
- Governance details in expanded tool row

## Non-Functional Requirements

### Performance
- Page load under 1 second for up to 50 tools
- Filter and search interactions respond within 100ms (client-side)
- Dialog open/close transitions under 200ms

### Security
- Credentials (client_secret, API keys, tokens) never returned in API responses
- Password input masking on all credential fields
- OAuth2 state parameter for CSRF protection
- Confirmation dialog before destructive actions (revoke)

### Accessibility (WCAG 2.2 AA)
- All interactive elements reachable via keyboard
- Focus indicators visible on all focused elements
- Minimum contrast ratio 4.5:1 for text
- Form fields have associated labels
- Error messages identify field and suggest correction

### Consistency
- Follow existing UI patterns: learnings-page.tsx (list/filter/dialog), PoliciesPage.tsx (detail views)
- Use shadcn/ui primitives: Badge, Button, Card, Dialog, Input, Label, Select, Tabs, Tooltip
- Tab navigation for multi-section pages (matches existing codebase patterns)

## Business Rules

- Only workspace admins can register providers, grant access, and attach governance
- Any workspace member can connect their own account and revoke their own connections
- Governance policies must be in "active" status to be attachable
- One active connected_account per identity+provider combination
- Revocation hard-deletes credential fields (not soft-delete)

## Domain Glossary

| Term | Definition |
|------|-----------|
| credential_provider | A registered integration endpoint (GitHub, Slack, etc.) with auth method configuration |
| connected_account | An identity's credential link to a provider (encrypted tokens or keys) |
| can_use | A relation edge granting an identity access to a specific tool |
| governs_tool | A relation edge attaching a governance policy to a tool |
| mcp_tool | A registered tool definition with name, schema, toolkit, risk_level |
| toolkit | Grouping identifier for tools from the same provider (e.g., "github", "slack") |
| risk_level | Tool classification: low (read-only), medium (standard), high (destructive) |
| effective toolset | Union of direct grants (can_use) and skill-derived tools for an identity |
