# DESIGN Decisions — mcp-server-auth

## Key Decisions

- [D1] Static headers stored directly on `mcp_server` (no provider indirection): simplest path for API key auth (see: architecture-design.md §Static Header Manager)
- [D2] OAuth discovery follows MCP spec exactly: RFC 9728 Protected Resource Metadata → RFC 8414 Auth Server Metadata with multi-endpoint fallback (see: architecture-design.md §Auth Discovery)
- [D3] Client ID Metadata Documents as primary registration approach (MCP spec preferred), Dynamic Registration as fallback (see: architecture-design.md §Client ID Metadata Document)
- [D4] Brain hosts `/.well-known/oauth-client-id` so auth servers can verify Brain's identity without preregistration (see: data-models.md §Client ID Metadata Document)
- [D5] `resource` parameter (RFC 8707) included in all authorization requests to bind tokens to specific MCP server (see: architecture-design.md §OAuth Flow)
- [D6] Token refresh is transparent — resolver refreshes expired tokens before MCP connect, surfaces auth_error status on failure (see: architecture-design.md §Token Refresh)
- [D7] No new top-level modules — all code extends existing `tool-registry` and `proxy` modules (see: component-boundaries.md)

## Architecture Summary

- Pattern: modular monolith with pure core / effect shell (functional paradigm)
- Paradigm: FP (already set in project CLAUDE.md)
- Key components: auth-discovery, static-headers, oauth-flow, client-metadata, credential-resolver extension, AddMcpServerDialog enhancement

## Technology Stack

- TypeScript/Bun: existing stack, no additions
- Web Crypto API: PKCE S256 generation (Bun native)
- AES-256-GCM: existing encryption module (ADR-066)

## Constraints Established

- All OAuth flows MUST use PKCE with S256 (MCP spec mandate)
- All auth server endpoints MUST be HTTPS (MCP spec §Communication Security)
- Tokens MUST include `resource` parameter binding to MCP server canonical URI
- Static header values MUST never appear in logs, API responses, or LLM context
- Discovery URLs validated against SSRF (no private IPs, HTTPS only in prod)

## Upstream Changes

- None — DISCUSS requirements align with MCP spec. No assumptions changed.
