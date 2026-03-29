# ADR-067: Non-Streaming Tool Call Interception First

## Status
Proposed

## Context
The proxy must intercept `tool_use` blocks in LLM responses to route Osabio-managed tool calls. The Anthropic Messages API supports two response modes:

1. **Non-streaming**: Full JSON response with `content` array containing `tool_use` blocks
2. **Streaming**: SSE events where `content_block_start` (type=tool_use) and `content_block_delta` events must be accumulated to reconstruct tool calls

Streaming interception is significantly more complex: the proxy must buffer SSE events, detect tool_use block boundaries, accumulate partial JSON from deltas, decide when to pause the stream, execute tools, then either inject results or manage a multi-turn loop -- all while maintaining SSE connection health.

## Decision
Walking skeleton implements non-streaming tool interception only. The proxy detects Osabio-managed tool_use blocks in the full response body, executes them, and constructs a follow-up request with tool_result messages to continue the conversation.

Streaming requests that contain injected Osabio-managed tools are temporarily downgraded to non-streaming for the tool interception loop. Once all tool calls are resolved and the LLM produces a final text response, the result is returned. Alternatively, the walking skeleton can limit tool injection to non-streaming requests only (skip injection when `stream: true`).

Streaming tool interception is deferred to a later phase.

## Alternatives Considered

### Alternative 1: Implement both streaming and non-streaming simultaneously
- **What**: Full SSE event accumulation, partial JSON reconstruction, stream pause/resume.
- **Expected impact**: Complete feature parity from day one.
- **Why rejected**: Doubles implementation complexity for the walking skeleton. The proxy's streaming path (`extractSSEUsage`, `TransformStream`) is already complex. Adding tool call accumulation, execution, and result injection into the SSE pipeline is a separate engineering effort. Walking skeleton principle: prove the vertical slice works first.

### Alternative 2: Client-side tool execution via response modification
- **What**: Let the LLM response pass through with tool_use blocks, expect the agent runtime to execute them.
- **Expected impact**: Zero proxy-side interception needed.
- **Why rejected**: Agent runtimes don't know about Osabio-managed tools. They would encounter unknown tool_use blocks and either error or ignore them. The entire point of proxy-based tool injection is that execution is also proxy-managed -- the agent runtime never handles Osabio tools.

## Consequences
- **Positive**: Walking skeleton ships faster with simpler interception logic
- **Positive**: Full JSON parsing (non-streaming) is straightforward and well-tested
- **Positive**: Multi-turn tool loop is easier to reason about without SSE state management
- **Negative**: Streaming requests with Osabio-managed tools may experience degraded UX (either downgraded to non-streaming or tools not injected)
- **Negative**: Streaming tool interception must be implemented later as a separate effort
