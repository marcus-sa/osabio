# MCP Server Discovery via tools/list — Architecture

**Issue**: #184 (US-2, deferred from walking skeleton)
**Depends on**: architecture.md (Integrations page, tool CRUD endpoints)

## 1. Overview

Workspace admins connect external MCP servers by URL. Brain acts as an MCP **client**, calls `tools/list` to discover available tools, and creates `mcp_tool` records from the response. Re-syncs are on-demand — the admin clicks "Sync" when they want to check for changes.

## 2. Scope

### In scope
- **`mcp_server` table**: new SurrealDB entity tracking connected MCP server endpoints
- **MCP client module**: connects to remote MCP servers via SSE or Streamable HTTP transport
- **Discovery service**: calls `tools/list`, maps MCP tool definitions to `mcp_tool` records with risk_level inference
- **Sync service**: diffs discovered tools against existing records — creates new, updates changed schemas, disables removed
- **Discovery UI**: server connection dialog, tool review screen with selective import, sync status
- **Backend endpoints**: server CRUD, trigger discovery on demand

### Out of scope
- Tool **execution** through the discovered server (already handled by existing credential brokerage pipeline)
- Bidirectional MCP — Brain does not expose its own tools to the connected server during discovery
- Authentication to the remote MCP server beyond what the credential provider supplies (mTLS, custom headers)

## 3. Schema: `mcp_server` Table

New migration: `schema/migrations/NNNN_mcp_server_table.surql`

```sql
BEGIN TRANSACTION;

DEFINE TABLE mcp_server SCHEMAFULL;
DEFINE FIELD name             ON mcp_server TYPE string;
DEFINE FIELD url              ON mcp_server TYPE string;
DEFINE FIELD transport        ON mcp_server TYPE string
  ASSERT $value IN ["sse", "streamable-http"];
DEFINE FIELD workspace        ON mcp_server TYPE record<workspace>;
DEFINE FIELD provider         ON mcp_server TYPE option<record<credential_provider>>;
DEFINE FIELD last_status      ON mcp_server TYPE string
  ASSERT $value IN ["ok", "error"];  -- result of last discover/sync attempt
DEFINE FIELD server_info      ON mcp_server TYPE option<object> FLEXIBLE;
DEFINE FIELD capabilities     ON mcp_server TYPE option<object> FLEXIBLE;
DEFINE FIELD last_discovery   ON mcp_server TYPE option<datetime>;
DEFINE FIELD last_error       ON mcp_server TYPE option<string>;
DEFINE FIELD tool_count       ON mcp_server TYPE int DEFAULT 0;
DEFINE FIELD created_at       ON mcp_server TYPE datetime DEFAULT time::now();

DEFINE INDEX mcp_server_workspace      ON mcp_server FIELDS workspace;
DEFINE INDEX mcp_server_workspace_name ON mcp_server FIELDS workspace, name UNIQUE;

-- Link tools to their source server
DEFINE FIELD source_server ON mcp_tool TYPE option<record<mcp_server>>;

COMMIT TRANSACTION;
```

### Key design choices

- **`transport` field**: MCP protocol supports two HTTP transports — legacy SSE (`/sse` endpoint) and the newer Streamable HTTP. We store which one so reconnection uses the correct transport.
- **`server_info` + `capabilities`**: Cached from the MCP `initialize` handshake. Stored for informational display (server name, version, supported features).
- **`source_server` on `mcp_tool`**: Links discovered tools back to their origin. Manually-created tools have `source_server: NONE`. This enables "re-sync this server" and "which server did this tool come from?" queries.
- **`provider` on `mcp_server`**: Optional link to a credential_provider for authenticated MCP servers (e.g., a server behind an API gateway). The discovery client injects credentials from this provider's connected_account.

## 4. MCP Client Module

File: `app/src/server/tool-registry/mcp-client.ts`

Uses `@modelcontextprotocol/sdk/client`:

```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

type McpConnectionResult = {
  client: Client;
  serverInfo: ServerInfo;
  capabilities: ServerCapabilities;
};

// Connect to an MCP server, perform initialize handshake, return client + metadata
function connectToMcpServer(
  url: string,
  transport: "sse" | "streamable-http",
  headers?: Record<string, string>,   // injected from credential provider
): Promise<McpConnectionResult>

// Fetch tools from a connected client
function fetchToolList(client: Client): Promise<ToolListResult>

// Graceful disconnect
function disconnectMcpServer(client: Client): Promise<void>
```

### Transport selection strategy

1. **User selects transport** in the connection dialog (default: `streamable-http`)
2. **Auto-detect fallback**: if `streamable-http` connection fails with 4xx, retry with `sse` transport and update the stored transport field
3. No stdio transport — Brain server connects over HTTP only (stdio is for local CLI agents)

### Credential injection

If `mcp_server.provider` is set:
1. Look up the active `connected_account` for the workspace identity + provider
2. Decrypt credentials via `decryptSecret()`
3. Inject as HTTP headers on the transport:
   - `api_key` → custom header (from `provider.api_key_header`, default `Authorization: Bearer <key>`)
   - `bearer` → `Authorization: Bearer <token>`
   - `oauth2` → `Authorization: Bearer <access_token>` (with refresh if expired)
   - `basic` → `Authorization: Basic <base64(user:pass)>`

## 5. Discovery Service

File: `app/src/server/tool-registry/discovery.ts`

### Core function: `discoverTools`

```typescript
type DiscoveryResult = {
  created: number;       // new tools added
  updated: number;       // existing tools with schema changes
  disabled: number;      // tools removed from server
  unchanged: number;     // tools identical to stored
  tools: ToolSyncDetail[];  // per-tool breakdown for review UI
};

type ToolSyncDetail = {
  name: string;
  action: "create" | "update" | "disable" | "unchanged";
  risk_level: RiskLevel;
  changes?: string[];    // human-readable diff for "update" actions
};

async function discoverTools(
  surreal: Surreal,
  serverRecord: RecordId<"mcp_server", string>,
  workspaceRecord: RecordId<"workspace", string>,
  client: Client,
  options?: { dryRun?: boolean },  // preview mode for review UI
): Promise<DiscoveryResult>
```

### Risk level inference (from MCP tool annotations)

MCP spec defines tool annotations (hints). Map them to `risk_level`:

| MCP Annotation | `risk_level` |
|----------------|-------------|
| `readOnlyHint: true` | `low` |
| `idempotentHint: true` (no destructive) | `medium` |
| `destructiveHint: true` | `high` |
| `destructiveHint: true` + no `confirmationHint` | `critical` |
| No annotations | `medium` (default) |

### Sync algorithm

```
1. Fetch tools from MCP server via tools/list
2. Load existing mcp_tool records WHERE source_server = $server
3. Build lookup maps by tool name
4. For each remote tool:
   a. Not in local → CREATE (action: "create")
   b. In local, schema differs → UPDATE input_schema/output_schema/description (action: "update")
   c. In local, identical → skip (action: "unchanged")
5. For each local tool NOT in remote → UPDATE status = "disabled" (action: "disable")
6. Update mcp_server.last_discovery, tool_count
```

### Schema diff

Compare `input_schema` and `description` using deep equality (`JSON.stringify` canonical comparison). Track changed fields in `ToolSyncDetail.changes` for the review UI (e.g., `["input_schema modified", "description changed"]`).

## 6. Backend Endpoints

### New route file: `app/src/server/tool-registry/server-routes.ts`

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/workspaces/:wsId/mcp-servers` | Register MCP server (name, url, transport, provider?) |
| GET | `/api/workspaces/:wsId/mcp-servers` | List registered MCP servers with status |
| GET | `/api/workspaces/:wsId/mcp-servers/:serverId` | Server detail (info, capabilities, tool_count) |
| DELETE | `/api/workspaces/:wsId/mcp-servers/:serverId` | Remove server + optionally disable discovered tools |
| POST | `/api/workspaces/:wsId/mcp-servers/:serverId/discover` | Trigger discovery (dry_run query param for preview) |
| POST | `/api/workspaces/:wsId/mcp-servers/:serverId/sync` | Full sync (discover + apply) |

### Discovery endpoint flow

```
POST /mcp-servers/:serverId/discover?dry_run=true

1. Load mcp_server record
2. connectToMcpServer(url, transport, headers?)
3. discoverTools(surreal, server, workspace, client, { dryRun: true })
4. disconnectMcpServer(client)
5. Return DiscoveryResult with per-tool breakdown

POST /mcp-servers/:serverId/sync

1. Same as discover but dryRun: false → writes to DB
2. disconnectMcpServer(client)
3. Return DiscoveryResult
```

### Query functions: `app/src/server/tool-registry/server-queries.ts`

```typescript
createMcpServer(surreal, workspaceRecord, content)
listMcpServers(surreal, workspaceRecord)
getMcpServerById(surreal, serverRecord)
updateMcpServerStatus(surreal, serverRecord, status, lastError?)
updateMcpServerAfterDiscovery(surreal, serverRecord, toolCount, capabilities, serverInfo)
deleteMcpServer(surreal, serverRecord)
listToolsBySourceServer(surreal, serverRecord)
```

## 8. UI Components

### New components (under `app/src/client/components/integrations/`)

```
McpServerSection.tsx          # Server list + "Add Server" button (within Integrations page Tools tab or new Servers tab)
AddMcpServerDialog.tsx        # Form: name, url, transport selector, optional provider dropdown
DiscoveryReviewPanel.tsx      # Shows dry_run results: tool list with action badges (new/update/remove/unchanged)
DiscoveryReviewToolRow.tsx    # Per-tool row: name, risk badge, action, schema diff toggle
SyncStatusIndicator.tsx       # Connection status badge: connected (green dot), disconnected (gray), error (red)
```

### New hook: `app/src/client/hooks/use-mcp-servers.ts`

```typescript
type UseMcpServersReturn = {
  servers: McpServerListItem[];
  isLoading: boolean;
  error?: string;
  refresh: () => void;
  addServer: (input: AddServerInput) => Promise<McpServerListItem>;
  removeServer: (serverId: string) => Promise<void>;
  discoverTools: (serverId: string) => Promise<DiscoveryResult>;
  syncTools: (serverId: string) => Promise<DiscoveryResult>;
};
```

### Discovery UX flow

1. Admin clicks **"Add MCP Server"** → `AddMcpServerDialog` opens
2. Enters name, URL, selects transport (default: streamable-http), optionally links a credential provider
3. On submit → `POST /mcp-servers` creates record, then immediately `POST /mcp-servers/:id/discover?dry_run=true`
4. **Review screen** appears showing discovered tools with:
   - Tool name + description
   - Inferred `risk_level` badge (from MCP annotations)
   - Action: "new" for first discovery
   - Checkbox per tool (all selected by default) for selective import
5. Admin reviews, optionally unchecks tools they don't want, adjusts risk_levels
6. Clicks **"Import Selected"** → `POST /mcp-servers/:id/sync` with selected tool names
7. Tools appear in the Tools tab, linked to the server via `source_server`

### Re-sync flow

1. Admin clicks **"Sync"** on an existing server row
2. `POST /mcp-servers/:id/discover?dry_run=true` → review panel shows diff:
   - **New**: tools on server not in Brain (action: create)
   - **Updated**: tools with changed schema (expandable diff view)
   - **Removed**: tools in Brain not on server (action: disable)
   - **Unchanged**: collapsed/hidden by default
3. Admin confirms → `POST /mcp-servers/:id/sync`

## 9. Shared Contract Types

Add to `app/src/shared/contracts.ts`:

```typescript
type McpServerListItem = {
  id: string;
  name: string;
  url: string;
  transport: "sse" | "streamable-http";
  last_status: "ok" | "error";  // result of last discover/sync
  provider_id?: string;
  provider_name?: string;
  tool_count: number;
  last_discovery?: string;
  last_error?: string;
  server_version?: string;     // from server_info
  created_at: string;
};

type DiscoveryResult = {
  created: number;
  updated: number;
  disabled: number;
  unchanged: number;
  tools: ToolSyncDetail[];
};

type ToolSyncDetail = {
  name: string;
  description: string;
  action: "create" | "update" | "disable" | "unchanged";
  risk_level: "low" | "medium" | "high" | "critical";
  changes?: string[];
  input_schema: Record<string, unknown>;
};

type AddMcpServerInput = {
  name: string;
  url: string;
  transport?: "sse" | "streamable-http";
  provider_id?: string;
};
```

## 10. Integration with Existing Architecture

### How discovery fits into the Integrations page

The architecture.md defines three tabs: Providers, Accounts, Tools. Discovery adds a **Servers section** at the top of the Tools tab (not a fourth tab) — servers are the *source* of tools, so they belong in the tools context.

```
Tools tab
├── MCP Servers section (collapsible)
│   ├── Server list (name, url, status indicator, tool_count, last_discovery)
│   ├── "Add MCP Server" button
│   └── Per-server: "Sync" / "Disconnect" / "Remove" actions
├── Separator
└── Tool list (all tools, both manual and discovered)
    └── Each tool shows source badge: "manual" or server name
```

### Tool provenance

- `source_server: NONE` → manually registered tool (existing flow)
- `source_server: mcp_server:xxx` → discovered from MCP server
- UI shows a small badge/label indicating provenance
- Discovered tools can be edited (risk_level override, status toggle) but schema fields are read-only (managed by sync)

### Credential brokerage unchanged

The existing tool execution pipeline (`tool-registry/execution.ts`) resolves credentials via `mcp_tool.provider → connected_account`. Discovery doesn't change this — it only populates `mcp_tool` records. The admin still needs to:
1. Register a credential provider (if the tool needs auth)
2. Link it to the tool (`mcp_tool.provider`)
3. Connect an account

Discovery can **suggest** the provider link if the MCP server itself required credentials (same provider).

## 11. Security Considerations

- **URL validation**: Only allow `http://` and `https://` URLs. No `file://`, `javascript:`, etc.
- **SSRF protection**: The Brain server makes outbound HTTP connections to admin-provided URLs. Consider an allowlist or network-level restriction for production deployments.
- **Credential isolation**: MCP client headers are injected per-connection, never logged or returned in API responses.
- **Transport downgrade**: Auto-detect fallback from streamable-http to SSE is safe (both are HTTP). No downgrade to unencrypted if the original URL is HTTPS.
- **Sync rate**: On-demand only — no persistent connections to remote servers. Each discover/sync is a short-lived connect → fetch → disconnect cycle.

## 12. Testing Strategy

- **Unit tests**: risk_level inference from MCP annotations, sync diff algorithm, URL validation
- **Acceptance tests**: full discovery flow with a mock MCP server (use SDK's `InMemoryTransport` for testing), sync with schema changes, server CRUD
- **Edge cases**: server unreachable, tools/list returns empty, transport auto-detect fallback
