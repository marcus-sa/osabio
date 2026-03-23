# MCP Server Discovery via tools/list -- Architecture

**Depends on**: architecture.md (Tool Registry page, tool CRUD endpoints, proxy pipeline)
**ADRs**: ADR-070 (discovery architecture), ADR-071 (MCP protocol execution)

## 1. Overview

Workspace admins connect external MCP servers by URL. Brain acts as an MCP **client**, calls `tools/list` to discover available tools, and creates `mcp_tool` records from the response. Re-syncs are on-demand -- the admin clicks "Sync" when they want to check for changes. The same MCP client module is used for tool execution in the proxy pipeline (ADR-071).

## 2. Scope

### In scope
- **`mcp_server` table**: new SurrealDB entity tracking connected MCP server endpoints
- **MCP client module**: connects to remote MCP servers via SSE or Streamable HTTP transport
- **Discovery service**: calls `tools/list`, maps MCP tool definitions to `mcp_tool` records with risk_level inference
- **Sync service**: diffs discovered tools against existing records -- creates new, updates changed schemas, disables removed
- **Discovery UI**: server connection dialog, tool review screen with selective import, sync status
- **Backend endpoints**: server CRUD, trigger discovery on demand
- **Credential injection**: resolve credentials from linked credential_provider and inject into MCP transport headers

### Out of scope
- Bidirectional MCP -- Brain does not expose its own tools to the connected server during discovery
- Persistent connections or `listChanged` subscriptions (ADR-070)
- mTLS or custom TLS for MCP connections (standard HTTPS only)

## 3. Schema: `mcp_server` Table

Migration: `schema/migrations/0066_mcp_server_table.surql`

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
  ASSERT $value IN ["ok", "error"];
DEFINE FIELD server_info      ON mcp_server TYPE option<object> FLEXIBLE;
DEFINE FIELD capabilities     ON mcp_server TYPE option<object> FLEXIBLE;
DEFINE FIELD last_discovery   ON mcp_server TYPE option<datetime>;
DEFINE FIELD last_error       ON mcp_server TYPE option<string>;
DEFINE FIELD tool_count       ON mcp_server TYPE int DEFAULT 0;
DEFINE FIELD created_at       ON mcp_server TYPE datetime DEFAULT time::now();

DEFINE INDEX mcp_server_workspace      ON mcp_server FIELDS workspace;
DEFINE INDEX mcp_server_workspace_name ON mcp_server FIELDS workspace, name UNIQUE;

-- Link tools to their source server
DEFINE FIELD OVERWRITE source_server ON mcp_tool TYPE option<record<mcp_server>>;

COMMIT TRANSACTION;
```

### Key design choices

- **`transport` field**: MCP protocol supports two HTTP transports -- legacy SSE (`/sse` endpoint) and the newer Streamable HTTP. Stored so reconnection uses the correct transport.
- **`server_info` + `capabilities`**: Cached from MCP `initialize` handshake. `FLEXIBLE` because the MCP spec allows arbitrary fields. Stored for informational display.
- **`source_server` on `mcp_tool`**: Links discovered tools back to their origin. Manually-created tools have `source_server: NONE`. Enables "re-sync this server" and "which server did this tool come from?" queries.
- **`provider` on `mcp_server`**: Optional link to a credential_provider for authenticated MCP servers. The MCP client injects credentials from this provider's connected_account.
- **Unique constraint**: `workspace + name` prevents duplicate server names within a workspace.

## 4. MCP Client Module

File: `app/src/server/tool-registry/mcp-client.ts`

Uses `@modelcontextprotocol/sdk/client` (MIT license, ^1.27.1, already a project dependency):

### 4.1 Types

```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

type McpConnectionResult = {
  client: Client;
  serverInfo: { name: string; version: string };
  capabilities: Record<string, unknown>;
};

type McpClientFactory = (
  url: string,
  transport: "sse" | "streamable-http",
  headers?: Record<string, string>,
) => Promise<McpConnectionResult>;
```

### 4.2 Transport selection strategy

1. **User selects transport** in the connection dialog (default: `streamable-http`)
2. **Auto-detect fallback**: if `streamable-http` fails with 4xx, retry with `sse` and update stored transport field
3. No stdio transport -- Brain server connects over HTTP only

### 4.3 Credential injection

If `mcp_server.provider` is set:
1. Resolve the admin's `connected_account` for the provider (identity from request context)
2. Decrypt credentials via `decryptSecret()`
3. Build auth headers via `buildAuthHeaders()` (reusing `credential-resolver.ts`)
4. Inject as `requestInit.headers` on the MCP transport constructor:
   - `SSEClientTransport({ url, requestInit: { headers } })`
   - `StreamableHTTPClientTransport({ url, requestInit: { headers } })`

For tool execution in the proxy, credential resolution uses the **proxy identity** (the agent's user), not the admin. The proxy's existing `resolveCredentialsForTool` handles this.

### 4.4 Connection timeout

Transport connection timeout: 10 seconds. If the MCP server does not respond within 10 seconds, the connection attempt fails with a descriptive error. Implemented via `AbortController` with `setTimeout`.

### 4.5 Dependency injection

The `McpClientFactory` is added to `ServerDependencies` for injection:

```typescript
// In runtime/types.ts
type ServerDependencies = {
  // ... existing
  mcpClientFactory: McpClientFactory;
};
```

Production creates real transports. Tests inject a factory backed by `InMemoryTransport` from the MCP SDK.

## 5. Discovery Service

File: `app/src/server/tool-registry/discovery.ts`

### 5.1 Core types

```typescript
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
```

### 5.2 Risk level inference

MCP spec defines tool annotations (hints). Map them to `risk_level`:

| MCP Annotation | `risk_level` |
|----------------|-------------|
| `readOnlyHint: true` | `low` |
| `idempotentHint: true` (no destructive) | `medium` |
| `destructiveHint: true` | `high` |
| `destructiveHint: true` + no confirmation | `critical` |
| No annotations | `medium` (default) |

Admin can override inferred risk_level before import.

### 5.3 Sync algorithm

```
1. Fetch tools from MCP server via client.listTools()
2. Load existing mcp_tool records WHERE source_server = $server
3. Build lookup maps by tool name
4. For each remote tool:
   a. Not in local -> action: "create"
   b. In local, schema differs -> action: "update" (track changed fields)
   c. In local, identical -> action: "unchanged"
5. For each local tool NOT in remote -> action: "disable"
6. If not dry_run: apply all create/update/disable operations
7. Update mcp_server: last_discovery, tool_count, last_status, server_info, capabilities
```

### 5.4 Schema diff

Compare `input_schema` and `description` using deep equality (canonical `JSON.stringify` comparison). Track changed fields in `ToolSyncDetail.changes` (e.g., `["input_schema modified", "description changed"]`).

### 5.5 Selective import

The sync endpoint accepts an optional `selected_tools` array. When present, only tools in this list are created/updated. Tools not in the list are skipped (not disabled -- they simply aren't imported). This enables the UI's checkbox-based selective import.

## 6. Backend Endpoints

### Route file: `app/src/server/tool-registry/server-routes.ts`

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/workspaces/:wsId/mcp-servers` | Register MCP server (name, url, transport, provider?) |
| GET | `/api/workspaces/:wsId/mcp-servers` | List registered MCP servers with status |
| GET | `/api/workspaces/:wsId/mcp-servers/:serverId` | Server detail (info, capabilities, tool_count) |
| DELETE | `/api/workspaces/:wsId/mcp-servers/:serverId` | Remove server + disable discovered tools |
| POST | `/api/workspaces/:wsId/mcp-servers/:serverId/discover` | Trigger discovery (dry_run query param for preview) |
| POST | `/api/workspaces/:wsId/mcp-servers/:serverId/sync` | Apply sync with optional selected_tools filter |

### Discovery endpoint flow

```
POST /mcp-servers/:serverId/discover?dry_run=true

1. Load mcp_server record
2. Resolve credentials if server has provider link
3. Connect via mcpClientFactory(url, transport, headers?)
4. Call client.listTools()
5. discoverTools(surreal, server, workspace, client, { dryRun: true })
6. Close client connection
7. Return DiscoveryResult with per-tool breakdown

POST /mcp-servers/:serverId/sync

1. Same connect + discover flow with dryRun: false
2. Apply selected_tools filter if provided in request body
3. Write changes to DB
4. Close client connection
5. Return DiscoveryResult
```

### Query functions: `app/src/server/tool-registry/server-queries.ts`

```typescript
createMcpServer(surreal, workspaceRecord, content)
listMcpServers(surreal, workspaceRecord)
getMcpServerById(surreal, serverRecord)
updateMcpServerStatus(surreal, serverRecord, status, lastError?)
updateMcpServerAfterDiscovery(surreal, serverRecord, toolCount, capabilities, serverInfo)
deleteMcpServer(surreal, serverRecord)
disableToolsBySourceServer(surreal, serverRecord)
listToolsBySourceServer(surreal, serverRecord)
mcpServerNameExists(surreal, workspaceRecord, name)
```

## 7. UI Components

### New components (under `app/src/client/components/tool-registry/`)

```
McpServerSection.tsx          # Server list + "Add Server" button (collapsible section in Tools tab)
AddMcpServerDialog.tsx        # Form: name, url, transport selector, optional provider dropdown
DiscoveryReviewPanel.tsx      # Shows dry_run results: tool list with action badges
DiscoveryReviewToolRow.tsx    # Per-tool row: name, risk badge, action, schema diff toggle
SyncStatusIndicator.tsx       # Connection status: ok (green dot), error (red dot)
```

### New hook: `app/src/client/hooks/use-mcp-servers.ts`

```typescript
type UseMcpServersReturn = {
  servers: McpServerListItem[];
  isLoading: boolean;
  error?: string;
  refresh: () => void;
  addServer: (input: AddMcpServerInput) => Promise<McpServerListItem>;
  removeServer: (serverId: string) => Promise<void>;
  discoverTools: (serverId: string) => Promise<DiscoveryResult>;
  syncTools: (serverId: string, selectedTools?: string[]) => Promise<DiscoveryResult>;
};
```

### Discovery UX flow

1. Admin clicks **"Add MCP Server"** -> `AddMcpServerDialog` opens
2. Enters name, URL, selects transport (default: streamable-http), optionally links a credential provider
3. On submit -> `POST /mcp-servers` creates record, then immediately `POST /mcp-servers/:id/discover?dry_run=true`
4. **Review panel** appears showing discovered tools with:
   - Tool name + description
   - Inferred `risk_level` badge (from MCP annotations)
   - Action: "new" for first discovery
   - Checkbox per tool (all selected by default) for selective import
5. Admin reviews, optionally unchecks tools, adjusts risk_levels
6. Clicks **"Import Selected"** -> `POST /mcp-servers/:id/sync` with selected tool names
7. Tools appear in the Tools tab, linked to the server via `source_server`

### Re-sync flow

1. Admin clicks **"Sync"** on an existing server row
2. `POST /mcp-servers/:id/discover?dry_run=true` -> review panel shows diff:
   - **New**: tools on server not in Brain (action: create)
   - **Updated**: tools with changed schema (expandable diff view)
   - **Removed**: tools in Brain not on server (action: disable)
   - **Unchanged**: collapsed by default
3. Admin confirms -> `POST /mcp-servers/:id/sync`

## 8. Integration with Existing Architecture

### How discovery fits into the Tool Registry page

The Tools tab gains a collapsible **MCP Servers** section above the tool list. Servers are the source of tools, so they belong in the tools context (not a separate tab -- ADR-070).

```
Tools tab
+-- MCP Servers section (collapsible)
|   +-- Server list (name, url, status indicator, tool_count, last_discovery)
|   +-- "Add MCP Server" button
|   +-- Per-server: "Sync" / "Remove" actions
+-- Separator
+-- Tool list (all tools, both manual and discovered)
    +-- Each tool shows source badge: "manual" or server name
```

### Tool provenance

- `source_server: NONE` -> manually registered tool (existing flow)
- `source_server: mcp_server:xxx` -> discovered from MCP server
- UI shows a small badge indicating provenance
- Discovered tools can be edited (risk_level override, status toggle) but schema fields are read-only (managed by sync)

### Credential chain for discovered tools

Discovery populates `mcp_tool` records. The tool executor needs credentials to execute them. The credential chain:

1. **Server-level credentials** (for connecting to the MCP server): resolved from `mcp_server.provider` -> admin's `connected_account`
2. **Tool-level credentials** (for the tool itself, if the MCP server acts as a gateway): resolved from `mcp_tool.provider` -> proxy user's `connected_account`

For most MCP servers, server-level credentials are sufficient (the MCP server authenticates the client, then proxies API calls). Tool-level credentials are for advanced scenarios where the MCP server requires per-tool auth.

## 9. Security Considerations

- **URL validation**: Only allow `http://` and `https://` URLs. No `file://`, `javascript://`, etc.
- **SSRF protection**: Brain server makes outbound HTTP connections to admin-provided URLs. Consider allowlist or network-level restriction for production.
- **Credential isolation**: MCP client headers are injected per-connection, never logged or returned in API responses.
- **Transport downgrade**: Auto-detect fallback from streamable-http to SSE is safe (both are HTTP). No downgrade to unencrypted if original URL is HTTPS.
- **Connection lifecycle**: On-demand only -- no persistent connections. Each discover/sync/execute is short-lived.

## 10. Testing Strategy

- **Unit tests**: risk_level inference from MCP annotations, sync diff algorithm, URL validation, transport selection
- **Acceptance tests**: full discovery flow with mock MCP server (InMemoryTransport), sync with schema changes, server CRUD, selective import, credential injection
- **Edge cases**: server unreachable, tools/list returns empty, transport auto-detect fallback, server removal disables tools
