# MCP Tool Registry UI — Architecture

## 1. Overview

A workspace-scoped admin UI for managing MCP tool integrations: credential providers, connected accounts (including OAuth2 flows), registered tools, identity-level grants (`can_use` edges), and governance policy links (`governs_tool` edges). Adds one new sidebar nav item ("Integrations") and a tabbed page at `/integrations`.

## 2. Scope

### In scope
- **Providers tab**: list, create, delete credential providers (oauth2, api_key, bearer, basic)
- **Accounts tab**: list connected accounts, connect new account (static credentials or OAuth2 redirect), revoke account
- **Tools tab**: list registered MCP tools with toolkit grouping, view tool detail (schema, risk level, grants, governance), MCP server discovery section
- **Tool detail panel**: expandable row or slide-over showing input_schema, linked provider, `can_use` grants, `governs_tool` policies
- **MCP server discovery**: connect external MCP servers, `tools/list` discovery with review, selective import, on-demand sync (see [architecture-mcp-discovery.md](./architecture-mcp-discovery.md))
- **OAuth2 callback handler**: backend route to complete the authorization code exchange
- **Tool CRUD endpoints**: backend routes to list/create/update tools (schema exists, routes do not)
- **Grant management endpoints**: backend routes to create/revoke `can_use` edges

### Out of scope
- Tool execution / invocation UI (already handled by chat agent tool pipeline)
- Governance policy CRUD (already exists at `/policies`)
- `governs_tool` edge creation (use existing policy UI; tools tab is read-only for governance)
- Bulk import/export of tools or providers

## 3. Component Architecture

```
/integrations (IntegrationsPage)
├── Tab: Providers
│   ├── ProviderTable (list view)
│   ├── CreateProviderDialog (form: name, display_name, auth_method, conditional fields)
│   └── DeleteProviderConfirm (confirmation dialog)
├── Tab: Accounts
│   ├── AccountTable (list view with provider name, status, credential indicators)
│   ├── ConnectAccountDialog (select provider → auth_method-specific form OR OAuth2 redirect)
│   └── RevokeAccountConfirm (confirmation dialog)
└── Tab: Tools
    ├── ToolTable (grouped by toolkit, columns: name, risk_level, status, provider, grants count)
    └── ToolDetailPanel (expandable: description, input_schema JSON viewer, grants list, governance policies)
```

### File layout

```
app/src/client/
  routes/integrations-page.tsx          # Page component with tab state
  components/integrations/
    ProviderTable.tsx                    # Provider list table
    CreateProviderDialog.tsx             # Create provider form dialog
    AccountTable.tsx                     # Connected accounts list
    ConnectAccountDialog.tsx             # Connect account flow (static + OAuth2)
    ToolTable.tsx                        # MCP tools list grouped by toolkit
    ToolDetailPanel.tsx                  # Tool detail with schema, grants, governance
  hooks/
    use-providers.ts                     # Fetch/mutate credential providers
    use-accounts.ts                      # Fetch/mutate connected accounts
    use-tools.ts                         # Fetch MCP tools with grants/governance counts
```

## 4. Backend Gaps & New Endpoints

### 4.1 Existing endpoints (no changes needed)

| Method | Path | Handler |
|--------|------|---------|
| POST | `/api/workspaces/:wsId/providers` | Create provider |
| GET | `/api/workspaces/:wsId/providers` | List providers |
| POST | `/api/workspaces/:wsId/accounts/connect/:providerId` | Connect account (static or OAuth2 redirect) |
| GET | `/api/workspaces/:wsId/accounts` | List accounts |
| DELETE | `/api/workspaces/:wsId/accounts/:accountId` | Revoke account |

### 4.2 New endpoints required

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/workspaces/:wsId/accounts/oauth2/callback` | OAuth2 authorization code callback — exchanges code for tokens, creates connected_account, redirects to `/integrations?tab=accounts&status=connected` |
| GET | `/api/workspaces/:wsId/tools` | List MCP tools in workspace with grant/governance counts |
| GET | `/api/workspaces/:wsId/tools/:toolId` | Tool detail with full schema, `can_use` grants, `governs_tool` policies |
| POST | `/api/workspaces/:wsId/tools` | Register a new MCP tool |
| PUT | `/api/workspaces/:wsId/tools/:toolId` | Update tool (status toggle, description, risk_level) |
| POST | `/api/workspaces/:wsId/tools/:toolId/grants` | Create `can_use` edge (grant identity access to tool) |
| DELETE | `/api/workspaces/:wsId/tools/:toolId/grants/:grantId` | Revoke `can_use` edge |
| DELETE | `/api/workspaces/:wsId/providers/:providerId` | Delete provider (only if no active accounts reference it) |

### 4.3 OAuth2 callback handler design

The `oauth-flow.ts` module already provides `consumeOAuthState()` and `exchangeCodeForTokens()`. The callback handler:

1. Extracts `code` and `state` from query params
2. Calls `consumeOAuthState(state)` — returns `{ providerId, identityId, workspaceId }` or rejects if expired/missing
3. Loads provider record via `getProviderById()`
4. Calls `exchangeCodeForTokens(provider, code, redirectUri)` to get access/refresh tokens
5. Encrypts tokens via `encryptSecret()`
6. Creates `connected_account` record via `createConnectedAccount()`
7. Redirects (302) to `/integrations?tab=accounts&status=connected`

Error cases redirect to `/integrations?tab=accounts&status=error&reason=<code>`.

### 4.4 New query functions

```typescript
// queries.ts additions

// List tools with grant and governance counts
listToolsWithCounts(surreal, workspaceRecord)
  → SELECT *, count(←can_use) AS grant_count, count(←governs_tool) AS governance_count
    FROM mcp_tool WHERE workspace = $ws ORDER BY toolkit, name;

// Tool detail with expanded grants and governance
getToolDetail(surreal, toolRecord)
  → batched query:
    1. SELECT * FROM $tool
    2. SELECT *, in.* AS identity FROM can_use WHERE out = $tool
    3. SELECT *, in.title AS policy_title, in.status AS policy_status FROM governs_tool WHERE out = $tool

// Grant management
createGrant(surreal, identityRecord, toolRecord, maxCallsPerHour?)
  → RELATE $identity->can_use->$tool SET max_calls_per_hour = $limit

revokeGrant(surreal, grantRecord)
  → DELETE $grant

// Provider deletion (with active account guard)
deleteProvider(surreal, providerRecord)
  → check: SELECT id FROM connected_account WHERE provider = $p AND status = "active" LIMIT 1
  → if none: DELETE $provider
```

## 5. Shared Contract Types

Add to `app/src/shared/contracts.ts`:

```typescript
// --- Tool Registry UI contracts ---

type ProviderApiResponse = {
  id: string;
  name: string;
  display_name: string;
  auth_method: "oauth2" | "api_key" | "bearer" | "basic";
  has_client_secret: boolean;
  client_id?: string;
  scopes?: string[];
  api_key_header?: string;
  created_at: string;
};

type AccountApiResponse = {
  id: string;
  provider_id: string;
  provider_name: string;       // denormalized for display
  provider_display_name: string;
  status: "active" | "revoked" | "expired";
  has_api_key: boolean;
  has_bearer_token: boolean;
  has_basic_credentials: boolean;
  has_access_token: boolean;
  connected_at: string;
};

type ToolListItem = {
  id: string;
  name: string;
  toolkit: string;
  description: string;
  risk_level: "low" | "medium" | "high" | "critical";
  status: "active" | "disabled";
  provider_id?: string;
  provider_name?: string;
  grant_count: number;
  governance_count: number;
  created_at: string;
};

type ToolDetail = ToolListItem & {
  input_schema: Record<string, unknown>;
  output_schema?: Record<string, unknown>;
  grants: Array<{
    id: string;
    identity_id: string;
    identity_name: string;
    granted_at: string;
    max_calls_per_hour?: number;
  }>;
  governance_policies: Array<{
    id: string;
    policy_title: string;
    policy_status: string;
    conditions?: string;
    max_per_call?: number;
    max_per_day?: number;
  }>;
};
```

## 6. Data Flow

### Provider creation
```
CreateProviderDialog → POST /providers → createProvider() → SurrealDB
  → refresh provider list
```

### Account connection (static credentials)
```
ConnectAccountDialog → select provider → render auth_method-specific form
  → POST /accounts/connect/:providerId (with credentials)
  → encrypt + createConnectedAccount() → SurrealDB
  → refresh account list
```

### Account connection (OAuth2)
```
ConnectAccountDialog → select OAuth2 provider → POST /accounts/connect/:providerId
  → server returns { redirect_url, state }
  → window.location.href = redirect_url (full-page redirect to external IdP)
  → user authorizes → IdP redirects to /api/.../oauth2/callback?code=...&state=...
  → server exchanges code for tokens, creates account, redirects to /integrations?tab=accounts&status=connected
  → IntegrationsPage reads query params, shows success toast, refreshes account list
```

### Tool listing with counts
```
ToolTable mount → GET /tools → listToolsWithCounts() → SurrealDB
  → render grouped by toolkit
```

### Tool detail expand
```
ToolTable row click → GET /tools/:toolId → getToolDetail() → SurrealDB
  → render ToolDetailPanel with schema, grants, governance
```

## 7. UI Patterns (following existing conventions)

- **Tabs**: Use inline tab buttons (like policy status filter pattern), not a separate tab component
- **Tables**: Follow `PoliciesPage` table pattern — `<table>` with `text-xs`, hover rows, badge for status/risk
- **Dialogs**: Follow `CreatePolicyDialog` pattern — controlled dialog with form state, async submit
- **Hooks**: Follow `useLearnings` pattern — `useState` + `useCallback` + `fetch`, return `{ data, isLoading, error, refresh }`
- **Sidebar**: Add "Integrations" link between "Policies" and the separator, following the existing `Link` + `matchRoute` + `navItemClass` pattern
- **Risk badges**: color-coded — low: secondary, medium: outline, high: default, critical: destructive
- **Status badges**: active: default, disabled: secondary, revoked: destructive, expired: secondary
- **Credential indicators**: boolean `has_*` fields rendered as small icons/badges (key, lock, user icons)
- **JSON schema viewer**: render `input_schema` as formatted `<pre>` with syntax highlighting (no new dependency — use `JSON.stringify(schema, null, 2)` in a `<pre className="text-xs bg-muted p-3 rounded overflow-auto">`)

## 8. Route Registration

### Frontend (router.tsx)
```typescript
import { IntegrationsPage } from "./routes/integrations-page";

const integrationsRoute = createRoute({
  getParentRoute: () => authLayout,
  path: "/integrations",
  component: IntegrationsPage,
});

// Add to routeTree:
authLayout.addChildren([..., integrationsRoute])
```

### Backend (start-server.ts)
```typescript
import { createToolRouteHandlers } from "../tool-registry/tool-routes";
import { createGrantRouteHandlers } from "../tool-registry/grant-routes";

// Register alongside existing provider/account handlers:
"/api/workspaces/:workspaceId/tools": { ... }
"/api/workspaces/:workspaceId/tools/:toolId": { ... }
"/api/workspaces/:workspaceId/tools/:toolId/grants": { ... }
"/api/workspaces/:workspaceId/tools/:toolId/grants/:grantId": { ... }
"/api/workspaces/:workspaceId/accounts/oauth2/callback": { ... }
"/api/workspaces/:workspaceId/providers/:providerId": { ... }
```

## 9. Security Considerations

- **No plaintext secrets**: API responses use `has_*` boolean indicators, never return encrypted values
- **Encryption**: All credential storage uses AES-256-GCM via existing `encryption.ts` (ADR-066)
- **OAuth2 state**: CSRF protection via `consumeOAuthState()` with 10-minute TTL
- **Provider deletion guard**: Cannot delete provider with active connected accounts
- **Grant management**: Only workspace members can create/revoke `can_use` edges (workspace scope enforced by existing middleware)

## 10. Testing Strategy

- **Acceptance tests**: OAuth2 callback flow (mock IdP), tool CRUD, grant CRUD, provider deletion guard
- **Unit tests**: Hook URL builders, response mappers, dialog form validation logic
- **Pattern**: Follow existing `tests/acceptance/tool-registry/` structure for new endpoint tests
