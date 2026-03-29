# Component Boundaries -- MCP Tool Registry (#178)

## Module Structure

All new modules live under `app/src/server/` following existing conventions. No new top-level directories.

```
app/src/server/
  proxy/
    anthropic-proxy-route.ts   # MODIFIED: steps 7.5 + 8.5 added
    tool-resolver.ts           # NEW: identity -> effective toolset query + cache
    tool-injector.ts           # NEW: merge Osabio tools into request tools[]
    tool-router.ts             # NEW: classify + dispatch tool_calls
    tool-executor.ts           # NEW: Osabio-native + integration execution
    credential-resolver.ts     # NEW: provider -> account -> decrypt -> inject auth
    tool-trace-writer.ts       # NEW: tool_call-specific trace creation
    trace-writer.ts            # EXISTING: no change (tool traces use separate writer)
  tool-registry/
    routes.ts                  # NEW: API routes for tool CRUD, grants, providers, accounts
    queries.ts                 # NEW: SurrealDB queries for mcp_tool, can_use, governs_tool
    provider-queries.ts        # NEW: credential_provider CRUD queries
    account-queries.ts         # NEW: connected_account CRUD + OAuth callback queries
    encryption.ts              # NEW: AES-256-GCM encrypt/decrypt adapter
    oauth-flow.ts              # NEW: OAuth2 authorization URL builder + token exchange
    mcp-discovery.ts           # NEW: MCP server connection + tools/list sync
    types.ts                   # NEW: shared algebraic data types
  runtime/
    config.ts                  # MODIFIED: add toolEncryptionKey + toolResolutionCacheTtlMs
    types.ts                   # NO CHANGE (ServerDependencies unchanged)
```

## Dependency Graph

```
proxy/anthropic-proxy-route.ts
  |-- proxy/tool-resolver.ts        (resolves effective toolset)
  |     |-- tool-registry/queries.ts  (can_use + mcp_tool queries)
  |     '-- tool-registry/types.ts
  |-- proxy/tool-injector.ts         (merges tools into request)
  |     '-- tool-registry/types.ts
  |-- proxy/tool-router.ts           (classifies tool calls)
  |     |-- proxy/tool-executor.ts    (executes tool calls)
  |     |     |-- proxy/credential-resolver.ts
  |     |     |     |-- tool-registry/account-queries.ts
  |     |     |     '-- tool-registry/encryption.ts
  |     |     |-- proxy/tool-trace-writer.ts
  |     |     |     '-- proxy/trace-writer.ts (reuses retry + edge patterns)
  |     |     '-- chat/tools/*.ts     (Osabio-native tool implementations)
  |     '-- tool-registry/types.ts
  '-- (existing: proxy-auth, context-injector, policy-evaluator, trace-writer)

tool-registry/routes.ts
  |-- tool-registry/queries.ts
  |-- tool-registry/provider-queries.ts
  |-- tool-registry/account-queries.ts
  |-- tool-registry/encryption.ts
  |-- tool-registry/oauth-flow.ts
  |-- tool-registry/mcp-discovery.ts
  '-- tool-registry/types.ts
```

## Component Responsibilities

### proxy/tool-resolver.ts
**Responsibility**: Given an identity ID, resolve the effective toolset (union of direct grants and skill-derived tools, deduplicated).

**Port signature** (function-signature port, FP style):
- Input: identity record ID, workspace record ID
- Output: array of resolved tool definitions (name, description, input_schema, provider reference, risk_level)
- Side effects: SurrealDB read (via injected query function), cache read/write

**Caching**: Per-instance cache object `{ entries: Map<identityId, { tools: ResolvedTool[], populatedAt: number }>, ttlMs: number }` with configurable TTL (default 60s). Created during server startup and injected via the dependencies object (same pattern as `WorkspaceCache`). **Not a module-level mutable singleton** (per AGENTS.md: "Do NOT use module-level mutable singletons for caching or shared state"). The cache is scoped to the server instance and passed through the dependency chain.

**Query strategy**: Single SurrealDB round-trip:
```
SELECT mcp_tool.* FROM can_use WHERE in = $identity AND out.status = 'active' AND out.workspace = $workspace;
```
(Future: `UNION SELECT ... FROM possesses WHERE in = $identity -> skill_requires -> mcp_tool` when #177 ships)

### proxy/tool-injector.ts
**Responsibility**: Merge resolved Osabio-managed tool definitions into the LLM request `tools[]` parameter. Additive only -- never modify or remove runtime tools.

**Pure function**: Takes parsed request body + resolved tools, returns modified body with extended tools array. No side effects.

**Deduplication**: If a runtime tool name collides with a Osabio-managed tool name, the runtime tool takes precedence (Osabio tool is skipped). This prevents conflicts when an agent runtime already provides a tool that Osabio also manages.

**Format**: Converts `mcp_tool` records to Anthropic Messages API tool format:
```
{ name, description, input_schema: { type: "object", properties: ..., required: ... } }
```

### proxy/tool-router.ts
**Responsibility**: Given tool_use blocks from LLM response, classify each as osabio-native, integration, or unknown, and dispatch to the appropriate executor.

**Pure classification function**: Takes tool_call name, looks up in resolved toolset. Returns discriminated union:
- `{ kind: "osabio_native", tool: McpTool }` -- no provider, execute graph query
- `{ kind: "integration", tool: McpTool, provider: CredentialProvider }` -- has provider, needs credentials
- `{ kind: "unknown" }` -- not in registry, pass through

### proxy/tool-executor.ts
**Responsibility**: Execute tool calls by kind. Orchestrates Osabio-native execution (graph queries) and integration execution (credential resolution + HTTP + sanitization).

**Osabio-native execution**: Reuses existing chat tool implementations from `chat/tools/*.ts`. The bridge pattern:
1. `mcp_tool.name` maps to a chat tool handler via a static registry (e.g., `search_entities` -> `searchEntitiesHandler` from `chat/tools/search-entities.ts`)
2. The executor builds a `ChatToolExecutionContext` from the proxy request's workspace + identity (same context type chat tools already use)
3. `tool_call.arguments` (JSON from LLM) maps to the tool's Zod `inputSchema` -- parse with the tool's schema, pass to handler
4. Handler returns a result object -> executor wraps as `{ type: "tool_result", tool_use_id, content: JSON.stringify(result) }`

**Tool registration**: A `brainNativeToolRegistry: Map<string, ChatToolHandler>` is built at startup from the chat tool modules. This is a read-only lookup table (not a mutable singleton) -- built once during server init and injected into the executor via dependencies.

**Integration execution**: Calls credential-resolver to get auth headers, then:
1. **Policy check** (`governs_tool`): evaluate policies BEFORE credential resolution. If denied, return error immediately without touching credentials. Step ordering: `intercept tool_call -> classify -> [if integration] check governs_tool -> resolve credentials -> execute -> sanitize -> trace`
2. Makes HTTP request to the integration API endpoint with injected auth headers
3. Sanitizes response (see sanitization rules below)
4. Returns sanitized result

**Response sanitization rules** (applied to all integration tool results):
- Strip HTTP headers from response before returning: `Authorization`, `Set-Cookie`, `X-API-Key`, `WWW-Authenticate`
- Strip any JSON fields matching: `access_token`, `refresh_token`, `api_key`, `client_secret`, `password`, `secret`, `token` (case-insensitive recursive scan)
- Truncate response body to 100KB to prevent context window flooding
- On sanitization failure (malformed response), return raw status code + content-type only, no body

**Error handling**: All execution errors are returned as tool_result error messages to the LLM (not thrown). The LLM can then decide how to proceed. Pattern: `{ type: "tool_result", tool_use_id, is_error: true, content: "..." }`.

### proxy/credential-resolver.ts
**Responsibility**: Given an mcp_tool with a provider reference and an identity, resolve the connected_account and return decrypted credentials ready for HTTP injection.

**Pure core + effect shell**:
- Pure: credential state classification (active/expired/missing/revoked), auth header construction by method
- Effect: SurrealDB query for connected_account, decryption via encryption adapter, OAuth2 token refresh HTTP call

**Auth header construction by method** (pure function):
- `oauth2`: `{ "Authorization": "Bearer {access_token}" }`
- `api_key`: `{ "{provider.api_key_header}": "{api_key}" }` -- header name is data-driven from `credential_provider.api_key_header` (e.g., `X-API-Key`, `Authorization`, `Api-Key`)
- `bearer`: `{ "Authorization": "Bearer {access_token}" }`
- `basic`: `{ "Authorization": "Basic {base64(username:password)}" }`

**Token refresh logic** (OAuth2 only):
1. Check `token_expires_at` against current time (with 30s buffer to avoid race conditions)
2. If expired and `refresh_token` exists: call `credential_provider.token_url` with refresh grant
3. Refresh request timeout: 10 seconds (hard limit -- if provider is slow, fail rather than block proxy)
4. On success: update `connected_account` with new tokens, return fresh credential
5. On failure: mark `connected_account.status = "expired"`, return error result

**Result type** (discriminated union):
- `{ kind: "ready", headers: Record<string, string> }` -- credential resolved, auth headers built
- `{ kind: "not_connected" }` -- no connected_account for identity + provider
- `{ kind: "expired" }` -- token expired and refresh failed
- `{ kind: "revoked" }` -- account revoked

### proxy/tool-trace-writer.ts
**Responsibility**: Create `trace` records with `type: "tool_call"` for every Osabio-managed tool execution.

**Extends existing pattern**: Follows `trace-writer.ts` conventions (retry, async, inflight tracking). Adds tool-specific fields:
- `tool_name`: the mcp_tool name
- `outcome`: `"success" | "error" | "denied" | "rate_limited"`
- `input`: tool_call arguments (sanitized)
- `output`: tool result (sanitized, no credentials)

### tool-registry/types.ts
**Responsibility**: Shared algebraic data types for the tool registry domain.

Key types:
- `McpTool` -- domain representation of an mcp_tool record
- `CredentialProvider` -- domain representation of a credential_provider record
- `ConnectedAccount` -- domain representation (credential fields always encrypted at this layer)
- `ResolvedTool` -- tool ready for injection (name, description, input_schema)
- `ToolCallRoute` -- discriminated union for routing (osabio_native | integration | unknown)
- `CredentialResult` -- discriminated union for credential resolution outcome
- `ToolExecutionOutcome` -- discriminated union for execution result

### tool-registry/encryption.ts
**Responsibility**: AES-256-GCM encrypt/decrypt for credential fields. Effect boundary adapter.

**Interface**: Two pure-looking functions (encrypt and decrypt) that take plaintext/ciphertext + key and return ciphertext/plaintext. The key comes from `ServerConfig.toolEncryptionKey`.

**IV handling**: Random 12-byte IV prepended to ciphertext. Each encryption produces a unique IV. Stored as base64 in SurrealDB string fields.

### tool-registry/oauth-flow.ts
**Responsibility**: Build OAuth2 authorization URLs and exchange authorization codes for tokens.

**Pure functions**:
- `buildAuthorizationUrl`: credential_provider fields -> URL with query params (client_id, redirect_uri, scope, state)
- `parseOAuthCallback`: callback query params -> { code, state } or error

**Effect functions**:
- `exchangeCodeForTokens`: POST to token_url with code + client_secret -> { access_token, refresh_token, expires_in }
- `refreshAccessToken`: POST to token_url with refresh_token -> { access_token, expires_in }

### tool-registry/routes.ts
**Responsibility**: REST API endpoints for tool registry management. All endpoints use existing DPoP authentication middleware.

**Endpoints** (mounted under `/api/workspaces/:workspaceId/tools/`):
- `GET /` -- list mcp_tools (filterable by toolkit, status, risk_level)
- `POST /` -- create mcp_tool (admin only)
- `PUT /:id` -- update mcp_tool (admin only)
- `DELETE /:id` -- disable mcp_tool (admin only, sets status=disabled)
- `GET /:id/grants` -- list can_use edges for a tool
- `POST /:id/grants` -- create can_use edge (admin only)
- `DELETE /:id/grants/:identityId` -- remove can_use edge (admin only)

**Provider endpoints** (`/api/workspaces/:workspaceId/providers/`):
- `GET /` -- list credential_providers
- `POST /` -- register credential_provider (admin only)
- `PUT /:id` -- update credential_provider (admin only)
- `DELETE /:id` -- delete credential_provider (admin only)

**Account endpoints** (`/api/workspaces/:workspaceId/accounts/`):
- `GET /` -- list connected_accounts for current identity
- `POST /connect/:providerId` -- initiate connection (OAuth2: returns redirect URL; static: accepts credentials)
- `GET /callback` -- OAuth2 callback handler
- `DELETE /:id` -- revoke connected_account

**Discovery endpoints** (`/api/workspaces/:workspaceId/tools/discover`):
- `POST /` -- connect MCP server + discover tools

## Walking Skeleton Phase Mapping

| Phase | Components Created/Modified | Independently Deployable |
|---|---|---|
| 1. US-3: Schema + grants | `tool-registry/types.ts`, `queries.ts`, `routes.ts` (partial: tool CRUD + grants) | Yes -- schema + API only, no proxy changes |
| 2. US-5: Tool injection | `proxy/tool-resolver.ts`, `proxy/tool-injector.ts`, proxy route step 7.5 | Yes -- tools injected but not intercepted yet |
| 3. US-6a: Osabio-native routing | `proxy/tool-router.ts`, `proxy/tool-executor.ts` (osabio-native path), proxy route step 8.5 | Yes -- osabio-native tools work end-to-end |
| 4. US-9: Tracing | `proxy/tool-trace-writer.ts` | Yes -- trace records written for tool executions |
| 5-8: Credentials + integration | `encryption.ts`, `provider-queries.ts`, `account-queries.ts`, `oauth-flow.ts`, `credential-resolver.ts`, tool-executor integration path | Incremental -- each US adds a path |
| 9. US-8: Governance | Policy evaluator extension for `governs_tool` | Yes -- layers onto existing policy engine |
| 10. US-2: MCP discovery | `mcp-discovery.ts` | Yes -- admin-initiated, no proxy changes |
