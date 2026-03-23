# Requirements -- Tool Registry UI

## Business Context

The MCP Tool Registry backend is partially implemented: credential providers, connected accounts, encrypted credential storage, governance queries, tool injection into LLM requests, and tool call classification are all working. However, three critical gaps prevent the feature from functioning end-to-end:

1. **No tool executor**: The proxy classifies tool calls but never executes them on upstream MCP servers
2. **No MCP client/discovery**: Tools must be created manually -- no mechanism to import from MCP servers
3. **No credential-to-transport injection**: Stored credentials are never injected into MCP transport headers

This feature layers a React web UI on existing API routes, adds the missing backend capabilities, and closes the execution gap so that injected tools actually work when agents use them.

## JTBD Mapping

| Job | Actor | Coverage |
|-----|-------|----------|
| J1: Provider Registration | Workspace Admin (Priya Sharma) | UI: Register providers, browse tools, grant access, attach governance |
| J2: Account Connection | Workspace Member (Carlos Mendez) | UI: Connect accounts (OAuth2 + static), view dashboard, revoke |
| J3: Tool Discovery | Workspace Admin (Priya Sharma) | Backend + UI: Connect MCP servers, discover tools, selective import |
| J4: Transparent Tool Execution | Proxy (automated) | Backend: Execute tool calls on upstream MCP servers, return results |
| J5: Credential Brokerage | Proxy (automated) | Backend: Decrypt and inject credentials into MCP transport |

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
- Tool provenance badge: "manual" or source server name

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

### FR-UI-9: MCP Server Connection
- "Add MCP Server" dialog with URL, transport selector, optional credential provider
- URL validation: only http:// and https:// allowed
- Transport auto-detect: try Streamable HTTP, fall back to SSE on 4xx
- Credential injection from linked provider's connected_account into transport headers
- Server status tracking (ok/error) with last_error message
- Duplicate server name prevention (unique per workspace)

### FR-UI-10: Tool Discovery and Import
- Dry-run discovery: connect to MCP server, call tools/list, return DiscoveryResult without DB writes
- Review panel: per-tool breakdown with action badges (new/update/disable/unchanged)
- Selective import: checkboxes per tool, admin confirms before sync
- Risk level inference from MCP tool annotations (readOnlyHint, destructiveHint)
- Admin can override inferred risk_level before import
- Re-sync: diff against existing tools, show changes for review
- Discovered tools linked to source server via source_server field

### FR-UI-11: Tool Execution via Proxy
- Tool Executor (proxy step 9): execute integration-classified tool calls on upstream MCP servers
- Connect to source_server URL using stored transport (SSE or Streamable HTTP)
- Credential injection: decrypt credentials from connected_account, inject as HTTP headers
- OAuth2 token refresh: refresh expired access_token before execution
- Construct tool_result message from MCP server response
- Multi-turn loop: re-send to LLM with tool_result until stop_reason is not "tool_use" (max 10 iterations)
- Error handling: unreachable server produces tool_result with is_error: true

### FR-UI-12: MCP Server Management
- MCP Servers section in Tools tab (collapsible)
- Server list: name, URL, status indicator, tool_count, last_discovery, last_error
- Actions: Sync (triggers discovery review), Remove (disables discovered tools)
- Empty state with guidance and CTA
- Relative time display for last_discovery

## Non-Functional Requirements

### Performance
- Page load under 1 second for up to 50 tools
- Filter and search interactions respond within 100ms (client-side)
- Dialog open/close transitions under 200ms
- Tool execution latency: proxy overhead under 500ms (excluding MCP server response time)
- MCP server connection + tools/list under 10 seconds (timeout with error if exceeded)

### Security
- Credentials (client_secret, API keys, tokens) never returned in API responses
- Password input masking on all credential fields
- OAuth2 state parameter for CSRF protection
- Confirmation dialog before destructive actions (revoke)
- MCP server URL validation: only http/https (no file://, javascript://, etc.)
- SSRF consideration: admin-provided URLs require network-level restrictions in production
- Credential isolation: MCP client headers never logged or returned in API responses

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

- Only workspace admins can register providers, grant access, attach governance, and manage MCP servers
- Any workspace member can connect their own account and revoke their own connections
- Governance policies must be in "active" status to be attachable
- One active connected_account per identity+provider combination
- Revocation hard-deletes credential fields (not soft-delete)
- MCP server names must be unique within a workspace
- On-demand MCP connections only: no persistent subscriptions or listChanged monitoring (ADR-070)
- MCP tool annotations are heuristic: admin can override inferred risk_level
- Multi-turn tool loop has a safety limit of 10 iterations to prevent infinite loops

## Domain Glossary

| Term | Definition |
|------|-----------|
| credential_provider | A registered integration endpoint (GitHub, Slack, etc.) with auth method configuration |
| connected_account | An identity's credential link to a provider (encrypted tokens or keys) |
| can_use | A relation edge granting an identity access to a specific tool |
| governs_tool | A relation edge attaching a governance policy to a tool |
| mcp_tool | A registered tool definition with name, schema, toolkit, risk_level |
| mcp_server | A registered external MCP server endpoint with URL, transport, and connection status |
| toolkit | Grouping identifier for tools from the same provider (e.g., "github", "slack") |
| risk_level | Tool classification: low (read-only), medium (standard), high (destructive), critical (destructive, no confirmation) |
| effective toolset | Union of direct grants (can_use) and skill-derived tools for an identity |
| source_server | Link from an mcp_tool to the mcp_server it was discovered from (NONE for manual tools) |
| tool_result | The MCP response from executing a tool call, sent back to the LLM as part of the conversation |
| transport | MCP connection protocol: "sse" (legacy Server-Sent Events) or "streamable-http" (newer Streamable HTTP) |

---

## Changed Assumptions

### What changed (revision 2, 2026-03-23)

**New jobs added**: J3 (Tool Discovery), J4 (Tool Execution), J5 (Credential Brokerage via transport). Previously J3 and J4 were listed as "no UI needed (proxy-internal)" -- this was incorrect because the proxy had no executor and no MCP client.

**New functional requirements**: FR-UI-9 through FR-UI-12 cover MCP server connection, tool discovery, tool execution, and server management.

**Updated NFRs**: Added tool execution latency target (under 500ms proxy overhead), MCP connection timeout (10 seconds), and SSRF security consideration.

**Domain glossary expanded**: Added mcp_server, source_server, tool_result, transport terms.

**Business rules added**: MCP server name uniqueness, on-demand connections only (ADR-070), annotation-based risk inference is heuristic, multi-turn loop safety limit.
