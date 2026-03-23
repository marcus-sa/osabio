# Test Scenarios — mcp-server-auth

## Overview

Acceptance tests for MCP server authentication: static headers and MCP-native OAuth 2.1. Tests use the existing acceptance-test-kit (in-process Brain server + isolated SurrealDB) with MSW to simulate external MCP servers and OAuth authorization servers.

## Test Structure

```
tests/acceptance/mcp-server-auth/
  mcp-server-auth-test-kit.ts        # Shared helpers, MSW setup for mock MCP/OAuth servers
  11-static-headers.test.ts           # Walking skeleton: static header CRUD + injection
  12-oauth-discovery.test.ts          # OAuth discovery: Protected Resource + Auth Server metadata
  13-oauth-authorization.test.ts      # OAuth flow: PKCE, token exchange, refresh
  14-credential-resolver.test.ts      # Resolver dispatch: none/static/oauth/provider modes
```

Numbering continues from existing `10-account-revocation.test.ts`.

## Walking Skeleton: Static Headers (Slice 1)

| # | Scenario | Story | Driving Port | Status |
|---|----------|-------|-------------|--------|
| WS-1 | Create MCP server with static headers | US-1 | `POST /api/workspaces/:wsId/mcp-servers` | ENABLED |
| WS-2 | Header values encrypted at rest | US-1 | SurrealDB direct read | ENABLED |
| WS-3 | Header values never in API response | US-1 | `GET /api/workspaces/:wsId/mcp-servers` | ENABLED |
| WS-4 | Static headers injected on MCP connect | US-1 | `POST /api/workspaces/:wsId/mcp-servers/:id/discover` | ENABLED |

## Milestone 1: Static Header Management

| # | Scenario | Story | Driving Port | Status |
|---|----------|-------|-------------|--------|
| M1-1 | Update static headers | US-1 | `PUT /api/workspaces/:wsId/mcp-servers/:id/headers` | @skip |
| M1-2 | Remove all static headers (switch to no auth) | US-1 | `PUT /api/workspaces/:wsId/mcp-servers/:id/headers` | @skip |
| M1-3 | Reject restricted header names (Host, Content-Length) | US-1 | `POST /api/workspaces/:wsId/mcp-servers` | @skip |
| M1-4 | Multiple headers on same server | US-1 | `POST /api/workspaces/:wsId/mcp-servers` | @skip |

## Milestone 2: OAuth 2.1 Discovery

| # | Scenario | Story | Driving Port | Status |
|---|----------|-------|-------------|--------|
| M2-1 | Discover auth from Protected Resource Metadata | US-2 | `POST /api/workspaces/:wsId/mcp-servers/:id/discover-auth` | @skip |
| M2-2 | Discover auth from WWW-Authenticate header on 401 | US-2 | `POST /api/workspaces/:wsId/mcp-servers/:id/discover-auth` | @skip |
| M2-3 | Auth server metadata with path component (multi-endpoint fallback) | US-2 | `POST /api/workspaces/:wsId/mcp-servers/:id/discover-auth` | @skip |
| M2-4 | Discovery fails gracefully (no metadata) | US-2 | `POST /api/workspaces/:wsId/mcp-servers/:id/discover-auth` | @skip |
| M2-5 | Auto-created credential_provider from discovery | US-2 | SurrealDB direct read | @skip |

## Milestone 3: OAuth 2.1 Authorization Flow

| # | Scenario | Story | Driving Port | Status |
|---|----------|-------|-------------|--------|
| M3-1 | Generate authorization URL with PKCE S256 | US-3 | `POST /api/workspaces/:wsId/mcp-servers/:id/authorize` | @skip |
| M3-2 | Exchange authorization code for tokens | US-3 | `GET /oauth/callback?code=...&state=...` | @skip |
| M3-3 | Tokens encrypted and stored | US-3 | SurrealDB direct read | @skip |
| M3-4 | Token refresh on expiry | US-3 | credential-resolver (internal) | @skip |
| M3-5 | Refresh failure surfaces auth_error status | US-3 | `GET /api/workspaces/:wsId/mcp-servers/:id/auth-status` | @skip |

## Milestone 4: Credential Resolver Dispatch

| # | Scenario | Story | Driving Port | Status |
|---|----------|-------|-------------|--------|
| M4-1 | No-auth server resolves to empty headers | US-1 | MCP client factory (internal) | @skip |
| M4-2 | Static headers server resolves to decrypted headers | US-1 | MCP client factory (internal) | @skip |
| M4-3 | OAuth server resolves to Bearer token | US-3 | MCP client factory (internal) | @skip |
| M4-4 | Provider server resolves via existing credential flow | US-1 | MCP client factory (internal) | @skip |

## MSW Strategy

MSW simulates external MCP servers and OAuth authorization servers:

- **Mock MCP server**: Responds to `tools/list`, returns 401 without auth, 200 with valid `Authorization` header
- **Mock Protected Resource Metadata**: `GET /.well-known/oauth-protected-resource` returns `authorization_servers`
- **Mock Auth Server Metadata**: `GET /.well-known/oauth-authorization-server` returns endpoints
- **Mock Token Endpoint**: `POST /token` validates code + code_verifier, returns tokens
- **Mock Dynamic Registration**: `POST /register` returns client_id + client_secret

This avoids network calls to real OAuth providers while testing the full discovery → authorization → token exchange flow.
