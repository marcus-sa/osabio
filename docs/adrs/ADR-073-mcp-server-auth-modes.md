# ADR-073: MCP Server Auth Modes — Static Headers + MCP OAuth 2.1

## Status

Proposed

## Context

Osabio's MCP Tool Registry requires authentication when connecting to remote MCP servers. The current design assumes manual OAuth2 provider configuration (admin enters authorization_url, token_url, client_id, client_secret). This doesn't match reality:

1. Most MCP servers today use static tokens (GitHub PATs, API keys) — no OAuth dance needed
2. The MCP spec defines an OAuth 2.1 discovery flow where the server self-describes its auth
3. Manual provider config collects fields that should be auto-discovered

## Decision

Support four auth modes on `mcp_server`:

| Mode | Provider needed? | Use case |
|------|-----------------|----------|
| `none` | No | Public MCP servers |
| `static_headers` | No | API keys, PATs — encrypted key-value pairs stored on `mcp_server` |
| `oauth` | Auto-created | MCP spec OAuth 2.1 — discovery + PKCE authorization code flow |
| `provider` | Yes (admin creates) | Manual OAuth for non-MCP integrations |

**Static headers** are a Osabio-specific convenience (not part of MCP spec). Header values are encrypted at rest with AES-256-GCM (ADR-066).

**OAuth 2.1** follows the MCP Authorization specification exactly:
- Protected Resource Metadata (RFC 9728) → Auth Server Metadata (RFC 8414) discovery
- Client ID Metadata Documents as primary registration (Osabio hosts `/.well-known/oauth-client-id`)
- Dynamic Client Registration (RFC 7591) as fallback
- PKCE S256 mandatory
- `resource` parameter (RFC 8707) for token audience binding

**`credential_provider` retained** for shared OAuth app configs across multiple servers and non-MCP integrations.

## Alternatives Considered

### A: Remove credential_provider, OAuth-only on mcp_server

Rejected — credential_provider serves shared OAuth app configs and non-MCP integrations (webhooks, REST APIs). Multiple MCP servers behind the same corporate IdP share one provider config.

### B: Static headers via credential_provider

Rejected — unnecessary indirection. Static headers are per-server, not shared. Creating a provider + account for a single API key adds complexity without benefit.

### C: Custom OAuth implementation (non-spec)

Rejected — the MCP spec defines a clear authorization flow. Deviating creates interoperability issues with MCP servers that expect spec-compliant clients.

## Consequences

- `mcp_server` schema gains `auth_mode`, `static_headers`, `oauth_account` fields
- `credential_provider` gains `discovery_source` field for auto-discovered providers
- Osabio serves `/.well-known/oauth-client-id` as a public endpoint
- `credential-resolver.ts` extended with `resolveAuthForMcpServer()` dispatch
- AddMcpServerDialog redesigned with auth mode selector
- SSRF validation required for discovery URL fetches
