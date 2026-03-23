# ADR-071: MCP Protocol Tool Execution via Connect-Per-Request

## Status
Proposed

## Context

The proxy pipeline classifies LLM tool calls as brain-native, integration, or unknown (ADR-064, tool-router.ts). Brain-native tools execute via graph queries. Integration tools currently use direct HTTP fetch with `endpoint_url` extracted from the tool's input arguments. This was a placeholder implementation.

MCP tools do not carry endpoint URLs -- they are hosted by MCP servers and executed via the MCP protocol's `tools/call` JSON-RPC method. The `@modelcontextprotocol/sdk` (MIT, ^1.27.1) is already a project dependency (used for the CLI MCP server). Its client module supports SSE and Streamable HTTP transports.

Three connection lifecycle options exist:
1. **Connect-per-call**: new connection + MCP handshake per tool call (LiteLLM pattern)
2. **Connect-per-request**: connection per proxy request, reused for multiple calls to the same server within that request
3. **Persistent pool**: long-lived connections with TTL, shared across requests

## Decision

### MCP protocol execution replaces HTTP fetch

Integration tool execution uses the MCP SDK client (`@modelcontextprotocol/sdk/client`) instead of raw HTTP fetch. The executor:
1. Resolves `source_server` from the `mcp_tool` record (new field, added via migration)
2. Loads the `mcp_server` record to get URL, transport, and optional credential provider
3. Resolves and decrypts credentials (reusing existing `credential-resolver.ts`)
4. Creates an MCP client transport with credentials injected as HTTP headers
5. Calls `tools/call` with the tool name and arguments
6. Converts the MCP `CallToolResult` to an Anthropic `tool_result` content block

### Connect-per-request lifecycle

Connections are scoped to the proxy request lifetime:
- First tool call to a server within a request creates the connection (lazy connect)
- Subsequent calls to the same server within the same request reuse the connection
- All connections are closed when the proxy request completes (in a `finally` block)
- No connections held across requests -- no persistent pool, no module-level state

A request-scoped `Map<string, Client>` (keyed by mcp_server ID) tracks active connections. This map is a local variable in the proxy handler, not module-level state.

### MCP client factory as injected dependency

The MCP client is accessed via a factory function in `ServerDependencies`:
```
createMcpClient: (url, transport, headers?) => Promise<{ client, serverInfo, capabilities }>
```
Tests inject a mock factory backed by `InMemoryTransport`. Production uses real SSE/Streamable HTTP transports.

## Alternatives Considered

### Alternative 1: Connect-per-call (LiteLLM pattern)
- **What**: Create a new MCP client connection for every `tools/call` invocation.
- **Expected impact**: Simplest implementation. No connection tracking needed.
- **Why rejected**: Each connection pays 100-300ms for transport setup + MCP `initialize` handshake. In a multi-turn loop with 3-5 tool calls to the same server, this adds 300-1500ms of overhead. The connect-per-request pattern amortizes this to a single connection cost per server per request.

### Alternative 2: Persistent connection pool with TTL
- **What**: Maintain a pool of MCP client connections with configurable TTL, shared across proxy requests.
- **Expected impact**: Lowest latency -- warm connections for frequent tool calls.
- **Why rejected**: Requires module-level mutable state (connection pool Map), which violates AGENTS.md ("Do NOT use module-level mutable singletons for caching or shared state"). Also adds reconnection logic, health checks, pool size limits, and cleanup on server shutdown. Over-engineering for current scale. Can be added later if latency profiling shows connect-per-request is insufficient -- it's additive, not a rearchitecture.

## Consequences
- **Positive**: Integration tools execute via standard MCP protocol instead of ad-hoc HTTP
- **Positive**: Connection reuse within a request reduces multi-turn loop latency
- **Positive**: No module-level state -- connections are request-scoped local variables
- **Positive**: Testable via MCP SDK's `InMemoryTransport` (mock MCP server in acceptance tests)
- **Positive**: Credential injection reuses existing `credential-resolver.ts` and `buildAuthHeaders`
- **Negative**: First tool call per server per request pays full connection cost (100-300ms)
- **Negative**: New `source_server` field on `mcp_tool` requires a migration
- **Negative**: MCP SDK is a runtime dependency for the proxy path (already a dependency for CLI)
