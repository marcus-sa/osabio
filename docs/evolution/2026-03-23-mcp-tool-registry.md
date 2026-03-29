# Evolution: MCP Tool Registry (#178)

**Date**: 2026-03-23
**Branch**: `marcus-sa/mcp-tool-registry`
**Duration**: ~2 hours (design through delivery)

## Summary

Added a tool registry subsystem to the Osabio proxy that lets workspace admins register tools (both Osabio-native graph tools and external integration tools), grant identity-level access, broker credentials at execution time, and enforce governance policies. The proxy now resolves an identity's effective toolset, injects tool definitions into LLM requests, intercepts tool calls from LLM responses, and routes them to the appropriate executor with full forensic tracing.

## Motivation

Coding agents connected via the Osabio proxy had no mechanism to use tools beyond what the runtime provided. Osabio-native graph tools (search_entities, get_entity_detail, etc.) and external integration tools (GitHub, Jira, Slack APIs) needed to be discoverable, authorized, and executed without agents ever seeing raw credentials. The proxy was the natural interception point since it already handles context injection and tracing.

## What Changed

### Phase 1: Tool Schema and Grants (01-01)
- Created migration `0065_mcp_tool_registry.surql` with `mcp_tool`, `can_use`, `credential_provider`, `connected_account`, and `governs_tool` tables
- `mcp_tool` stores tool definitions with `input_schema`, `output_schema`, `toolkit` (brain/integration), `risk_level`, and `status`
- `can_use` relation edges grant identity access with optional `max_calls_per_hour` rate limit

### Phase 2: Proxy Tool Injection (02-01)
- Added step 7.5 to proxy pipeline: resolves identity's effective toolset via `can_use` edges, merges Osabio-managed tool definitions into LLM request `tools[]`
- Runtime tool names take precedence over Osabio tool names on collision
- Tool resolution uses 60s TTL cache per identity (ADR-065)

### Phase 3: Osabio-Native Tool Call Routing (03-01)
- Added step 8.5: intercepts tool_use blocks from LLM responses, classifies as osabio-native/integration/unknown
- Osabio-native tools execute directly via graph query handlers (reusing shared `tools/` execute functions)
- Unknown tools pass through to runtime unmodified

### Phase 4: Tool Call Tracing (04-01)
- Extended `tool-trace-writer.ts` with `tool_call` trace type
- Every Osabio-managed tool execution produces a trace record with tool_name, identity, workspace, duration_ms, and outcome

### Phase 5: Credential Provider Registration (05-01)
- Admin CRUD routes for credential providers with auth method variants: `oauth2`, `api_key`, `bearer`, `basic`
- Client secrets encrypted at rest via AES-256-GCM (ADR-066)
- API responses never return plaintext secrets

### Phase 6: Account Connection (06-01)
- User routes to connect accounts to credential providers
- Static credentials (API key, basic, bearer) stored with AES-256-GCM encryption
- OAuth2 flow: initiate returns redirect URL, callback exchanges code for encrypted tokens
- One active connected_account per identity+provider combination

### Phase 7: Credential Brokerage (07-01)
- Credential resolver follows `mcp_tool -> credential_provider -> connected_account` chain
- Injects provider-specific auth headers: `X-API-Key`, `Authorization: Basic`, `Authorization: Bearer`
- OAuth2 expired tokens trigger refresh before execution; refresh failure marks account as expired

### Phase 8: Integration Tool Execution (08-01)
- Integration executor makes HTTP calls with brokered credentials
- Response sanitization: strips auth headers, removes credential JSON fields recursively, truncates to 100KB
- Errors returned as `tool_result` with `is_error: true`, not HTTP 500

### Phase 9: Tool Governance (09-01)
- Policy enforcement via `governs_tool` relation edges
- Governance check runs BEFORE credential resolution -- denied calls never touch credentials
- Supports `requires_human_approval` condition and `max_per_day` limits
- Rate limiting via `can_use.max_calls_per_hour`
- Multiple policies evaluated with most-restrictive winning

### Phase 10: Account Revocation (10-01)
- Revocation hard-deletes all encrypted credential fields (set to NONE), not just status-flagged
- Subsequent tool calls return "account disconnected" error
- Idempotent: second revoke succeeds

### Bonus: Tool Directory Refactoring
- Relocated 21 tool files from `app/src/server/chat/tools/` to `app/src/server/tools/`
- Extracted reusable `execute*` functions from 5 tools for proxy reuse
- Eliminated ~200 lines of duplicated CONTAINS-based search logic from proxy executor
- Proxy executor now delegates to canonical tool implementations (single source of truth)

## Key Decisions

| ADR | Decision | Rationale |
|-----|----------|-----------|
| ADR-064 | Proxy tool injection via request body mutation | Mutate `tools[]` in the forwarded request body at step 7.5; simpler than header-based signaling |
| ADR-065 | 60s TTL cache for tool resolution | In-memory Map with TTL; acceptable staleness for tool grants that change infrequently |
| ADR-066 | AES-256-GCM for credential encryption | Standard authenticated encryption; key from `ENCRYPTION_KEY` env var |
| ADR-067 | Non-streaming tool interception first | Walking skeleton handles non-streaming only; streaming deferred to follow-up |
| ADR-068 | `_encrypted` suffix convention | All encrypted fields use `_encrypted` suffix in schema for clarity |

## Commits

```
728d624a docs: add MCP tool registry DISCUSS, DESIGN, and DISTILL wave artifacts (#178)
aa668395 feat: add MCP tool registry schema migration (0065)
8e7d091a feat(proxy): add tool injection step 5.7 to proxy pipeline
24a25f6e feat(proxy): add osabio-native tool call routing at step 8.5
1f2a7da0 feat(proxy): add tool call tracing for Osabio-native tool executions
23725e99 feat(tool-registry): add credential provider CRUD with AES-256-GCM encryption
e0b06a05 feat(tool-registry): add account connection routes with encrypted credential storage
cd699fc2 feat(tool-registry): add credential resolver for integration tool auth headers
6cbc7c3e feat(tool-registry): add integration tool execution with credential brokerage and response sanitization
f0f7dc67 feat(tool-registry): add governance policy enforcement before credential resolution
bdc43358 feat(tool-registry): add account revocation with credential hard-deletion
```

## Impact

- **Proxy pipeline**: Extended from 8 steps to 10 (added 7.5 tool injection, 8.5 tool call interception)
- **Schema**: 5 new tables (`mcp_tool`, `can_use`, `credential_provider`, `connected_account`, `governs_tool`)
- **Security**: All credentials encrypted at rest; never exposed to LLM or in API responses
- **Tracing**: Full forensic audit trail for every tool execution with outcome tracking
- **Tool architecture**: Shared `tools/` directory with framework-agnostic `execute*` functions

## Migrated Artifacts

| Source | Destination |
|--------|-------------|
| `docs/design/mcp-tool-registry/` | `docs/architecture/mcp-tool-registry/` |
| `docs/distill/mcp-tool-registry/` | `docs/scenarios/mcp-tool-registry/` |
| `docs/ux/mcp-tool-registry/` | `docs/ux/mcp-tool-registry/` (permanent location) |
| `docs/requirements/mcp-tool-registry/` | `docs/requirements/mcp-tool-registry/` (permanent location) |
| `docs/adrs/ADR-064 through ADR-068` | `docs/adrs/` (already permanent) |

## Remaining Considerations

- **Streaming tool interception** (ADR-067): Deferred. Walking skeleton handles non-streaming only; streaming SSE responses need buffering logic.
- **OAuth2 end-to-end flow**: Walking skeleton implements the token exchange path but real OAuth2 providers need redirect URI configuration and consent screen integration.
- **MCP server discovery** (US-2, FR-11): Not in walking skeleton scope. Future work to auto-discover tools from MCP server `tools/list`.
- **Tool Registry UI** (US-11): Acceptance criteria defined but not implemented in walking skeleton.
- **Token refresh retry**: Single refresh attempt on OAuth2 expiry; no retry with backoff.
