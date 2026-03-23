# DISCUSS Decisions — mcp-server-auth

## Key Decisions

- [D1] Keep `credential_provider` for shared OAuth app configs and non-MCP integrations; don't remove it (see: requirements.md)
- [D2] Static headers live directly on `mcp_server` — no provider indirection for simple auth (see: requirements.md FR-1)
- [D3] MCP OAuth 2.1 auto-discovery creates a `credential_provider` automatically from server metadata (see: requirements.md FR-2)
- [D4] Walking skeleton is Static Headers (Slice 1) — unblocks real MCP server usage immediately (see: story-map.md)
- [D5] Phase 1 uses workspace-level credentials, not per-identity OAuth tokens (see: requirements.md Out of Scope)

## Requirements Summary

- Primary need: Two auth modes for MCP servers — static headers (simple) and MCP-native OAuth 2.1 (spec-compliant)
- Static headers cover 90% of current MCP servers (GitHub PATs, API keys)
- OAuth discovery follows MCP spec: Protected Resource Metadata → Auth Server Metadata → PKCE authorization code flow
- `credential_provider` remains valuable for shared OAuth apps and non-MCP integrations
- Walking skeleton: Static Headers (US-1)

## Auth Mode Decision Matrix

| Auth Mode | Provider needed? | How it works |
|-----------|-----------------|--------------|
| No auth | No | Public MCP server |
| Static headers | No | Key-value pairs encrypted on `mcp_server` |
| OAuth (auto-discover) | Auto-created | Brain discovers auth from MCP server URL |
| OAuth (manual provider) | Yes (admin creates) | Admin selects existing `credential_provider` |

## Constraints Established

- All secrets encrypted at rest with AES-256-GCM (ADR-066)
- PKCE required for all OAuth flows (MCP spec mandate)
- No persistent MCP connections (ADR-070)
- Connect-per-request lifecycle (ADR-071)
- SSRF mitigation required for URL discovery

## Schema Changes Required

- `mcp_server`: add `auth_mode`, `static_headers_encrypted` fields
- `credential_provider`: add `discovery_source` field
- No changes to `connected_account` or `mcp_tool`
