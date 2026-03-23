# Wave Decisions -- Tool Registry UI (DESIGN)

## Decision D-01: MCP Protocol Execution Replaces Direct HTTP for Integration Tools

**Decision**: Replace the current `executeIntegrationTools` HTTP-fetch pattern with MCP protocol execution via `@modelcontextprotocol/sdk/client`.

**Rationale**: The current integration executor expects an `endpoint_url` in the tool input and makes a raw HTTP call. This was a placeholder -- MCP tools don't carry their own endpoint URL. Instead, tools are hosted by MCP servers and executed via the MCP `tools/call` JSON-RPC method. The executor must resolve the tool's `source_server`, connect via MCP client, and call `tools/call`.

**Alternatives considered**:
- Keep HTTP-fetch pattern and require each tool definition to include an endpoint URL: rejected because MCP tools don't carry endpoint URLs, and it forces admins to duplicate server URLs per-tool.
- Embed a lightweight JSON-RPC client instead of using MCP SDK: rejected because the SDK handles transport negotiation, session management, and protocol framing. Reimplementing this adds maintenance burden with no benefit.

**Impact**: `tool-executor.ts` `executeIntegrationTools` is replaced. Credential injection moves from HTTP headers to MCP transport headers. The MCP client module is the new adapter boundary.

## Decision D-02: Connect-Per-Request with Intra-Request Session Reuse

**Decision**: MCP client connections are established per proxy request, not per tool call. Within a single proxy request, if multiple tool calls target the same MCP server, the connection is reused. Connections are closed when the proxy request completes.

**Rationale**: Pure connect-per-call (LiteLLM pattern) pays connection + MCP handshake cost for every tool call. With multi-turn loops, a single proxy request may execute 3-5 tool calls against the same server. Reusing the connection within a request amortizes that cost. Connections are NOT held across separate proxy requests -- no persistent connection pool, no module-level singleton state.

**Alternatives considered**:
- Connect-per-call (LiteLLM pattern): simpler but 100-300ms overhead per call. Acceptable for single calls but compounds in multi-turn loops.
- Persistent connection pool with TTL: lower latency but adds module-level mutable state (violates AGENTS.md), reconnection logic, and cleanup complexity. Over-engineering for current scale.

**Aligns with**: ADR-070 on-demand connections, AGENTS.md no module-level mutable singletons, Decision 9 from DISCUSS wave.

## Decision D-03: Unified Tool Execution in Multi-Turn Loop

**Decision**: The multi-turn loop handles brain-native, integration, and mixed tool calls in a single iteration. Currently the loop has two separate branches (brain-native vs integration). The revised loop processes ALL classified tool calls per iteration: brain-native tools execute via graph queries, integration tools execute via MCP client, unknown tools pass through. All results are combined into a single `tool_result` message for the follow-up LLM request.

**Rationale**: The current two-branch design cannot handle responses where the LLM calls both a brain-native tool and an integration tool simultaneously. The Anthropic API allows multiple `tool_use` blocks per response. A unified approach handles all combinations.

**Alternatives considered**:
- Execute brain-native first, integration second, in sequence: rejected because it splits a single response's tool calls across two iterations, doubling LLM round-trips.
- Fail when mixed tool calls detected: rejected because it artificially limits the LLM's ability to call tools from different sources in one turn.

**Impact**: Proxy loop refactored from two branches to one unified branch with parallel execution.

## Decision D-04: Tool Resolution Query Extended with source_server

**Decision**: The `can_use` graph query in `tool-resolver.ts` is extended to also return `source_server` from the `mcp_tool` record. The `ResolvedTool` type gains a `source_server_id` field (raw string ID, not full record). The tool executor uses this to look up the MCP server for execution.

**Rationale**: The executor needs to know which MCP server hosts each integration tool. Adding this to the existing resolution query avoids an extra DB round-trip per tool call. The `source_server` field is optional (manual tools have NONE).

**Alternatives considered**:
- Separate query at execution time to look up source_server: rejected because the resolver already traverses the graph for each tool. Adding one field to the SELECT is cheaper than a second query.
- Store server URL directly on mcp_tool: rejected because it duplicates data (URL already on mcp_server) and requires updating every tool when a server URL changes.

## Decision D-05: MCP Client Module as Injected Dependency

**Decision**: The MCP client module exposes factory functions, not a singleton. The proxy route creates MCP client connections via a factory injected through `ServerDependencies`. The factory takes `(url, transport, headers)` and returns a connected client. Tests can inject a mock factory.

**Rationale**: AGENTS.md forbids module-level mutable singletons. The proxy already receives `ServerDependencies` -- the MCP client factory fits this pattern. Testability: acceptance tests inject a mock MCP server via `InMemoryTransport` from the MCP SDK.

## Decision D-06: Max Tool Use Iterations Increased to 10

**Decision**: Increase `MAX_TOOL_USE_ITERATIONS` from 5 to 10 in the proxy loop.

**Rationale**: DISCUSS wave Decision 9 and requirements FR-UI-11 specify a 10-iteration safety limit. Integration tool calls often trigger multi-step workflows (e.g., LLM calls search, then creates, then verifies). 5 iterations is too restrictive for realistic multi-tool workflows. 10 matches the documented requirement.

## Decision D-07: MCP Server Status Lifecycle

**Decision**: `mcp_server.last_status` uses two values: `ok` and `error`. Status is updated after every discovery or tool execution attempt. `last_error` stores the most recent error message. There is no intermediate "connecting" status -- connections are short-lived and synchronous from the API caller's perspective.

**Rationale**: Simple two-state model matches the on-demand connection pattern. A "connecting" state would require background tasks and state cleanup. The admin sees either "last operation succeeded" or "last operation failed with reason X."
