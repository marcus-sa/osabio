# ADR-064: Proxy Tool Injection via Request Body Mutation

## Status
Proposed

## Context
The MCP Tool Registry (#178) needs to inject Osabio-managed tool definitions into LLM requests. The proxy already mutates request bodies for context injection (ADR-046). We need to decide how tool definitions are delivered to the LLM.

Three constraints shape this decision:
1. Tools must appear in the Anthropic Messages API `tools[]` parameter for the LLM to use them
2. Agent runtimes (Claude Code, Cursor) already provide their own tools in the request
3. Tool injection must be additive -- runtime tools must not be modified or removed

## Decision
Inject Osabio-managed tools by appending to the `tools[]` array in the parsed request body, following the same body mutation pattern as context injection (step 7 in the proxy pipeline). This becomes step 7.5, after context injection and before forwarding.

Runtime tools occupy the front of the array (original positions preserved). Osabio-managed tools are appended at the end. If a Osabio-managed tool name collides with a runtime tool name, the Osabio tool is skipped (runtime takes precedence).

## Alternatives Considered

### Alternative 1: Separate tools-only request header
- **What**: Send Osabio tools in a custom `X-Osabio-Tools` header, rely on the LLM provider to merge them.
- **Expected impact**: Zero body mutation.
- **Why rejected**: Anthropic's Messages API ignores custom headers for tool definitions. The model only sees `tools[]` in the request body. Same rejection rationale as ADR-046 Alternative 2.

### Alternative 2: MCP server-side tool provision
- **What**: Osabio exposes tools via its existing CLI MCP server (stdio), agents discover them via MCP protocol.
- **Expected impact**: Standard MCP discovery, no proxy changes.
- **Why rejected**: Only works for agent runtimes that support MCP (Claude Code). Does not work for Cursor, Codex, or any HTTP-only agent routing through the proxy. The proxy path is runtime-agnostic. Additionally, MCP tools don't carry credential brokerage -- the agent runtime would need to handle credentials, defeating the security model.

### Alternative 3: Inject tools via system prompt description
- **What**: Describe available tools in the system prompt `<osabio-context>` block, relying on the LLM to "call" them via structured text output.
- **Expected impact**: No tools[] mutation.
- **Why rejected**: LLMs use structured tool_use blocks only when tools are in the `tools[]` parameter. System prompt descriptions produce unstructured text that the proxy cannot reliably intercept and route. Breaks the tool call interception pipeline.

## Consequences
- **Positive**: Runtime-agnostic -- any agent routing through the proxy gets tools injected
- **Positive**: Follows established proxy body mutation pattern (ADR-046)
- **Positive**: Additive injection preserves prompt cache for runtime tools (they're at the same array positions)
- **Positive**: Deduplication prevents tool name collisions
- **Negative**: Increases request body size proportional to number of injected tools (~200-500 bytes per tool definition)
- **Negative**: Too many injected tools could confuse the LLM -- mitigated by token budget for tool definitions (same approach as context injection budget)
