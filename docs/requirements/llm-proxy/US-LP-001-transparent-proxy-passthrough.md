# US-LP-001: Transparent Proxy Passthrough

## Problem
Priya Chandrasekaran is a senior developer who uses Claude Code daily across multiple projects. She needs Brain's observability benefits (tracing, cost tracking) but finds it unacceptable if the proxy adds latency, breaks streaming, or requires workflow changes. Today she points Claude Code directly at `api.anthropic.com` and gets zero visibility into her LLM usage.

## Who
- Developer | Daily Claude Code user, 100-500 API calls/day | Wants Brain observability without any workflow friction

## Job Story Trace
- JS-2: Zero-Friction Agent Gateway

## Solution
A transparent HTTP proxy that forwards Anthropic Messages API requests without transformation, pipes SSE streams byte-for-byte, and extracts usage data from stream events asynchronously after delivery.

## Domain Examples

### 1: Happy Path -- Priya uses Claude Code normally through the proxy
Priya sets `ANTHROPIC_BASE_URL=http://localhost:4100/proxy/llm/anthropic` via `brain init`. She opens Claude Code and asks it to refactor `auth-service/middleware.ts`. Claude Code sends 8 streaming API requests through the proxy over 3 minutes. Each request is forwarded to Anthropic with Priya's own `x-api-key`. She notices zero difference in latency or behavior. All 8 calls produce `llm_trace` nodes in the graph (async).

### 2: Edge Case -- Extended thinking and tool use work through the proxy
Priya asks Claude Code to analyze a complex race condition. Claude Code uses extended thinking (thinking blocks in SSE stream) and then calls the Read tool 4 times. The proxy relays all SSE event types: `message_start`, `content_block_start` (type: thinking), `content_block_delta` (thinking_delta and text_delta), `content_block_stop`, `tool_use` blocks, `message_delta`, `message_stop`. Every event passes through unmodified.

### 3: Error Path -- Anthropic API is unreachable
Priya is coding and Anthropic's API goes down. Her next Claude Code request fails. The proxy returns HTTP 502 with body `{"error": "upstream_unreachable", "message": "Failed to reach Anthropic API", "source": "proxy"}`. The `"source": "proxy"` field lets Priya immediately know this is not a Claude Code bug -- the upstream provider is down.

### 4: Edge Case -- Non-streaming count_tokens request
Priya's Claude Code sends a `POST /v1/messages/count_tokens` request (non-streaming). The proxy forwards it, captures the response, and returns it unmodified. No trace is created for count_tokens (it is a metadata call, not an LLM generation).

## UAT Scenarios (BDD)

### Scenario: Streaming request forwarded transparently
Given Priya has ANTHROPIC_BASE_URL set to the Brain proxy
And she sends a streaming request for model "claude-sonnet-4" with her own x-api-key
When the proxy forwards the request to Anthropic
Then SSE events are relayed as raw bytes with no transformation
And the time-to-first-token overhead added by the proxy is less than 50ms
And all event types (message_start, content_block_delta, message_delta, message_stop) pass through

### Scenario: Non-streaming request forwarded transparently
Given Priya sends a non-streaming request (stream=false) through the proxy
When the proxy forwards the request to Anthropic
Then the JSON response is returned with the original status code
And the response body is unmodified

### Scenario: Upstream failure returns distinguishable error
Given Anthropic's API is unreachable
When Priya's Claude Code sends a request through the proxy
Then the proxy returns HTTP 502
And the error body includes "upstream_unreachable"
And the error body includes "source": "proxy" to distinguish from Anthropic errors

### Scenario: Proxy forwards all required headers
Given Priya's request includes anthropic-version, anthropic-beta, x-api-key, and content-type headers
When the proxy forwards the request
Then all four headers are present in the upstream request
And no additional headers are injected that could alter Anthropic's behavior

### Scenario: Tool use SSE events pass through unmodified
Given Claude Code receives a tool_use response via streaming
When the proxy relays content_block_start (type: tool_use) and content_block_delta (input_json_delta) events
Then the events arrive at Claude Code byte-identical to what Anthropic sent
And Claude Code can parse tool call input and execute the tool normally

## Acceptance Criteria
- [ ] Streaming SSE passthrough relays events as raw bytes with no transformation
- [ ] Non-streaming responses forwarded with original status code and unmodified body
- [ ] Time-to-first-token overhead is less than 50ms at p95
- [ ] All Anthropic protocol headers (anthropic-version, anthropic-beta, x-api-key) forwarded correctly
- [ ] Upstream failures return HTTP 502 with "source": "proxy" in error body
- [ ] Tool use, extended thinking, and all SSE event types pass through unmodified
- [ ] count_tokens endpoint forwarded without creating a trace

## Technical Notes
- Walking skeleton exists: `app/src/server/proxy/anthropic-proxy-route.ts` -- already handles streaming and non-streaming
- Uses Bun's native `fetch` + `TransformStream` for SSE relay
- Forward raw bytes (not decoded text) on the hot path to avoid encoding overhead
- `X-Accel-Buffering: no` header required to prevent reverse-proxy buffering
- Must handle partial SSE events split across chunks (existing `extractSSEUsage` handles this)

## Dependencies
- None (walking skeleton already exists; this story solidifies and tests it)
