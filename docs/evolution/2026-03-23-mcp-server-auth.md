# MCP Server Authentication

**Date**: 2026-03-23
**Feature ID**: mcp-server-auth
**Branch**: marcus-sa/mcp-tool-registry
**Duration**: ~3 hours (08:46 – 11:05 UTC)

## Summary

Added two authentication modes to the MCP server connection lifecycle: **static headers** (encrypted key-value pairs for API keys/PATs) and **MCP-native OAuth 2.1** (spec-compliant auto-discovery + PKCE authorization code flow). Extended the existing tool-registry and proxy modules within Osabio's modular monolith.

## Business Context

Osabio connects to external MCP servers (GitHub, Linear, etc.) but had no mechanism for authenticated connections. Static headers cover ~90% of current MCP servers that use API keys or PATs. OAuth 2.1 support follows the MCP Authorization specification for servers that require browser-based authorization flows.

## Key Decisions

| ID | Decision | Rationale |
|----|----------|-----------|
| D1 | Static headers stored directly on `mcp_server` (no provider indirection) | Simplest path for API key auth; avoids unnecessary abstraction |
| D2 | OAuth discovery follows MCP spec exactly: RFC 9728 → RFC 8414 with multi-endpoint fallback | Spec compliance ensures interoperability with any MCP-compliant auth server |
| D3 | Dynamic Client Registration (RFC 7591) as registration approach | Auth servers can verify Osabio's identity without preregistration |
| D4 | `resource` parameter (RFC 8707) in all authorization requests | Binds tokens to specific MCP server, preventing token reuse across servers |
| D5 | Token refresh is transparent — resolver refreshes before MCP connect | Admin never sees token expiry unless refresh_token itself expires |
| D6 | No new top-level modules — extends `tool-registry` and `proxy` | Maintains modular monolith boundaries |
| D7 | Keep `credential_provider` for shared OAuth configs; auto-create from discovery | Backward compatible with existing non-MCP integrations |

## Architecture

- **Pattern**: Modular monolith with pure core / effect shell (functional paradigm)
- **Pure core**: header validation, metadata parsing, PKCE generation, auth URL building, discovery endpoint derivation
- **Effect shell**: HTTP fetches (discovery), AES-256-GCM encryption/decryption, SurrealDB queries, token exchange
- **Credential resolver dispatch**: `auth_mode` field on `mcp_server` determines which resolution path runs (none → empty, static_headers → decrypt, oauth → Bearer token, provider → existing flow)

## Steps Completed

### Phase 01: Walking Skeleton — Static Header Auth End-to-End (4 steps)
| Step | Description | Status |
|------|-------------|--------|
| 01-01 | Schema migration: auth_mode and static_headers fields | DONE |
| 01-02 | Encrypt static header values at rest (AES-256-GCM) | DONE |
| 01-03 | Mask header values in API responses | DONE |
| 01-04 | Inject static headers on MCP client connection | DONE |

### Phase 02: Static Header Management (4 steps)
| Step | Description | Status |
|------|-------------|--------|
| 02-01 | Update static headers on existing server (PUT /headers) | DONE |
| 02-02 | Remove all static headers when switching auth mode | DONE |
| 02-03 | Reject restricted header names (Host, Content-Length, etc.) | DONE |
| 02-04 | Multiple headers on same server | DONE |

### Phase 03: OAuth 2.1 Discovery (5 steps)
| Step | Description | Status |
|------|-------------|--------|
| 03-01 | Discover auth from Protected Resource Metadata (RFC 9728) | DONE |
| 03-02 | WWW-Authenticate header fallback for discovery | DONE |
| 03-03 | Auth server metadata multi-endpoint fallback | DONE |
| 03-04 | Discovery fails gracefully when no metadata available | DONE |
| 03-05 | Auto-create credential_provider from discovery | DONE |

### Phase 04: OAuth 2.1 Authorization Flow (6 steps)
| Step | Description | Status |
|------|-------------|--------|
| 04-01 | Generate authorization URL with PKCE S256 | DONE |
| 04-02 | Exchange authorization code for tokens | DONE |
| 04-03 | Encrypt and store tokens in connected_account | DONE |
| 04-04 | Token refresh on expiry | DONE |
| 04-05 | Refresh failure surfaces auth_error status | DONE |
| 04-06 | Dynamic client registration (RFC 7591) | DONE |

### Phase 05: Credential Resolver Dispatch (4 steps)
| Step | Description | Status |
|------|-------------|--------|
| 05-01 | No-auth server resolves to empty headers | DONE |
| 05-02 | Static headers server resolves to decrypted headers | DONE |
| 05-03 | OAuth server resolves to Bearer token | DONE |
| 05-04 | Provider server resolves via existing credential flow | DONE |

**Total: 23/23 steps completed**

## Test Coverage

- **8 acceptance tests** for static headers (11-static-headers.test.ts)
- **5 acceptance tests** for OAuth discovery (12-oauth-discovery.test.ts)
- **6 acceptance tests** for OAuth authorization flow (13-oauth-authorization.test.ts)
- **4 acceptance tests** for credential resolver dispatch (14-credential-resolver.test.ts)
- **10 unit tests** for static header validation (static-headers.test.ts)
- **14+ unit tests** for auth discovery pure functions (auth-discovery.test.ts)
- MSW (Mock Service Worker) simulates external MCP servers and OAuth auth servers — no real network calls

## Files Created/Modified

### New files
- `app/src/server/tool-registry/auth-discovery.ts` — OAuth discovery (RFC 9728 + RFC 8414)
- `app/src/server/tool-registry/oauth-flow.ts` — PKCE, token exchange, dynamic registration
- `app/src/server/tool-registry/static-headers.ts` — Header encryption/validation
- `schema/migrations/0067_mcp_server_auth_modes.surql` — Schema migration
- `tests/acceptance/mcp-server-auth/` — 4 acceptance test files + test kit
- `tests/unit/tool-registry/static-headers.test.ts` — Unit tests
- `tests/unit/tool-registry/auth-discovery.test.ts` — Unit tests

### Modified files
- `app/src/server/tool-registry/server-routes.ts` — New endpoints (discover-auth, headers, authorize, callback)
- `app/src/server/tool-registry/server-queries.ts` — Auth-related CRUD queries
- `app/src/server/tool-registry/types.ts` — Auth mode types
- `app/src/server/proxy/credential-resolver.ts` — Extended with auth mode dispatch
- `app/src/server/runtime/config.ts` — Added configurable base URL
- `app/src/server/runtime/start-server.ts` — Base URL wiring

## Issues Encountered

1. **Test infrastructure conflict (01-02)**: Better Auth + happy-dom Response type mismatch caused `HPE_UNEXPECTED_CONTENT_LENGTH` in acceptance tests. Resolved by splitting test config so happy-dom only loads for client tests (`bunfig.client.toml`).
2. **OAuth token expiry buffer**: Initially set to 60 seconds, increased to 5 minutes for reliability — ensures tokens are refreshed well before they expire, reducing risk of in-flight requests using soon-to-expire tokens.
3. **Hardcoded localhost URLs**: OAuth redirect URIs were constructed with hardcoded `http://127.0.0.1:${port}`. Refactored to use configurable `OSABIO_BASE_URL` environment variable for deployment flexibility.

## Migrated Artifacts

- `docs/architecture/mcp-server-auth/` — architecture-design.md, component-boundaries.md, data-models.md
- `docs/scenarios/mcp-server-auth/` — test-scenarios.md, walking-skeleton.md

## Security Controls

- All secrets encrypted at rest with AES-256-GCM (ADR-066)
- PKCE S256 required for all OAuth flows (MCP spec mandate)
- Header values never appear in API responses, logs, or LLM context
- Restricted header names blocked (Host, Content-Length, Transfer-Encoding, Connection)
- SSRF mitigation for discovery URLs
- State parameter for CSRF protection
- Resource parameter (RFC 8707) for token audience binding
