# Walking Skeleton Rationale -- Tool Registry UI

## Skeleton Definition

The walking skeleton proves: **Can workspace users manage integrations, discover tools from MCP servers, and have agents actually execute those tools end-to-end?**

## Thinnest E2E Slice

```
Admin registers provider (POST /providers)
  -> Provider appears in list (GET /providers)
Member connects account (POST /accounts/connect/:id)
  -> Account appears in dashboard (GET /accounts)
Admin seeds tools (DB precondition)
  -> Tools browsable with grouping (GET /tools)
Admin grants access (POST /tools/:id/grants)
  -> Grant visible in tool detail (GET /tools/:id)
Admin connects MCP server (POST /mcp-servers)
  -> Triggers discovery (POST /mcp-servers/:id/discover)
  -> Imports tools (POST /mcp-servers/:id/sync)
  -> Discovered tools appear in tool list (GET /tools)
Agent executes tool via proxy
  -> Proxy classifies tool_use as integration
  -> Proxy connects to upstream MCP server
  -> Proxy calls tools/call, returns tool_result
  -> LLM receives result and produces final text
```

## Why Six Skeletons

1. **Provider registration + listing**: Proves the Providers tab has data. Entry point for all subsequent integration management.
2. **Account connection + listing**: Proves the Accounts tab works. Validates credential encryption pipeline end-to-end.
3. **Tool browsing with grouping**: Proves the Tools tab renders meaningful data. Validates the GET /tools endpoint with counts.
4. **Grant creation + detail**: Proves the Access tab works. Validates the grant management endpoints.
5. **MCP server connection + discovery**: Proves admin can connect external MCP servers and import tools automatically instead of manual JSON creation.
6. **Tool execution via proxy**: **Critical skeleton.** Without this, the entire tool injection pipeline is non-functional -- tools get injected into LLM requests but tool calls are silently dropped. Proves the proxy can execute integration tools on upstream MCP servers and return results.

## Litmus Test

| Question | Answer |
|----------|--------|
| Title describes user goal? | "Admin manages integrations end-to-end, agent executes tools" -- yes |
| Given/When describe user actions? | "Admin registers provider", "Agent sends LLM request" -- yes |
| Then describe user observations? | "Provider appears in list", "Agent receives tool result" -- yes |
| Non-technical stakeholder confirms? | "Yes, admins can set up tools and agents can use them" |

## What Is NOT in the Skeleton

- OAuth2 browser redirect (cannot test in acceptance suite)
- Governance policy attachment (Release 2 scope, existing policies page works)
- UI-specific behavior (keyboard navigation, empty states, badges)
- OAuth2 token refresh (unit test level)
- Transport auto-detect fallback (requires mock returning 4xx)

## Implementation Sequence

Enable skeletons in order (each builds on previous):
1. Skeleton 1: Provider CRUD (exercises existing endpoint)
2. Skeleton 2: Account connection (exercises existing endpoint with DPoP auth)
3. Skeleton 3: Tool browsing (requires GET /tools endpoint)
4. Skeleton 4: Grant management (requires grant endpoints)
5. Skeleton 5: MCP server + discovery (requires mcp-servers endpoints + MCP client module)
6. Skeleton 6: Tool execution via proxy (requires tool executor + mock MCP server + mock Anthropic)

## Changed Assumptions

### What changed (revision 2, 2026-03-23)

**Skeletons 5 and 6 added**: The walking skeleton grows from 4 to 6 scenarios. Skeleton 5 (MCP server + discovery) validates the admin can import tools from external servers. Skeleton 6 (tool execution) is the most critical addition -- without it, the feature is non-functional.

**Skeleton 6 requires mock infrastructure**: Full proxy round-trip testing needs a mock Anthropic API (returning configurable tool_use responses) and a mock MCP server (via InMemoryTransport). Both are injected through ServerDependencies.
