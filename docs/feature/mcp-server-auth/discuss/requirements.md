# Requirements — mcp-server-auth

## Problem Statement

Brain's MCP Tool Registry currently requires admin to manually configure OAuth2 provider details (authorization_url, token_url, client_id, client_secret) before connecting an MCP server. This doesn't match how MCP servers actually authenticate:

1. Many MCP servers use **static headers** (API keys, PATs) — no OAuth dance needed
2. MCP spec defines an **OAuth 2.1 discovery flow** where the server self-describes its auth — no manual provider config needed
3. The current `CreateProviderDialog` collects fields that should be auto-discovered

## Functional Requirements

### FR-1: Static Header Auth Mode
- Admin can configure key-value header pairs directly on an MCP server record
- Header values are encrypted at rest (AES-256-GCM, per ADR-066)
- Headers are injected on every MCP client connection (discovery, sync, tool execution)
- No `credential_provider` or `connected_account` needed for this mode
- Example: `Authorization: Bearer ghp_xxx` or `X-API-Key: sk-xxx`

### FR-2: MCP-Native OAuth 2.1 Discovery
- When admin adds an MCP server URL, Brain attempts to discover auth requirements:
  1. Connect to MCP server → if `401`, read `WWW-Authenticate` header
  2. Fetch `/.well-known/oauth-protected-resource` from the MCP server origin
  3. Extract `authorization_servers` from Protected Resource Metadata (RFC 9728)
  4. Fetch `/.well-known/oauth-authorization-server` from the auth server
  5. Extract endpoints: `authorization_endpoint`, `token_endpoint`, `registration_endpoint`
- If discovery succeeds, Brain auto-creates a `credential_provider` with discovered fields
- Admin sees "Authorize" button instead of manual OAuth form fields

### FR-3: OAuth 2.1 Authorization Flow
- Brain acts as OAuth 2.1 client per MCP spec
- PKCE required (`S256` code challenge method)
- Dynamic Client Registration (RFC 7591) when auth server supports it
- Fallback: Client ID Metadata Document hosted by Brain
- Authorization code flow with browser redirect
- Token storage in `connected_account` (encrypted)
- Automatic token refresh via `refresh_token` grant

### FR-4: Auth Mode Selection on MCP Server
- When adding an MCP server, admin selects auth mode:
  - **No auth** — public server, no credentials
  - **Static headers** — admin enters key-value pairs
  - **OAuth (auto-discover)** — Brain discovers auth from server URL
  - **OAuth (manual provider)** — admin selects existing `credential_provider`
- Auth mode stored on `mcp_server` record

### FR-5: Credential Provider Remains for Shared OAuth Apps
- `credential_provider` continues to exist for:
  - Shared OAuth app configs referenced by multiple MCP servers
  - Non-MCP integrations (webhooks, REST APIs)
  - Manual OAuth configuration when auto-discovery isn't available
- Auto-discovered providers are marked with `discovery_source` to distinguish from manual ones

## Non-Functional Requirements

### NFR-1: Credential Security (carried from ADR-066)
- All secrets encrypted at rest with AES-256-GCM
- Static header values never appear in logs, LLM context, or API responses
- Decryption only at execution boundary (credential-resolver)

### NFR-2: SSRF Mitigation
- MCP server URLs and discovered auth server URLs must be validated
- No connections to private/internal networks from discovery flow
- URL allowlist/blocklist consideration for production

### NFR-3: Token Lifecycle
- OAuth tokens refreshed automatically before expiry
- Failed refresh surfaces error in MCP server status (last_status: "auth_error")
- Admin can re-authorize without removing the server

## Out of Scope
- Per-tool auth (all tools from an MCP server share the server's auth)
- Multi-user OAuth (Phase 1: workspace-level credentials, not per-identity)
- Persistent MCP connections / `listChanged` subscriptions (per ADR-070)
