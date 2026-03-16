Feature: Transparent Proxy Passthrough (US-LP-001)
  As a developer using Claude Code daily,
  I want Brain's proxy to forward my LLM calls with zero perceptible latency,
  so that I get observability without any workflow friction.

  Background:
    Given Priya has configured ANTHROPIC_BASE_URL to Brain's proxy
    And she has a valid Anthropic API key

  # --- Happy Path ---

  Scenario: Non-streaming request forwarded transparently
    Given Priya sends a non-streaming request for model "claude-sonnet-4"
    When the proxy forwards the request to Anthropic
    Then the response arrives with the original status code
    And the response body is unmodified

  Scenario: Streaming request relays all SSE events
    Given Priya sends a streaming request for model "claude-sonnet-4"
    When the proxy forwards the request to Anthropic
    Then SSE events are relayed as raw bytes with no transformation
    And message_start, content_block_delta, message_delta, and message_stop events all pass through
    And the time-to-first-token overhead is less than 50ms

  Scenario: All required headers forwarded to Anthropic
    Given Priya's request includes anthropic-version, anthropic-beta, x-api-key, and content-type headers
    When the proxy forwards the request
    Then all four headers are present in the upstream request
    And no additional headers are injected that could alter behavior

  # --- Error Paths ---

  Scenario: Upstream failure returns distinguishable error
    Given Anthropic's API is unreachable
    When Priya's request is sent through the proxy
    Then the proxy returns a gateway error
    And the error indicates "upstream_unreachable"
    And the error source is identified as "proxy" to distinguish from Anthropic errors

  Scenario: Malformed request body forwarded without proxy interference
    Given Priya sends a request with invalid JSON body
    When the proxy attempts to forward the request
    Then the upstream provider's error response is returned unchanged
    And the proxy does not inject its own validation errors

  # --- Edge Cases ---

  Scenario: Tool use SSE events pass through unmodified
    Given Claude Code receives a response with tool_use content blocks via streaming
    When the proxy relays content_block_start and input_json_delta events
    Then the events arrive byte-identical to what Anthropic sent
    And Claude Code can parse and execute tool calls normally

  Scenario: Extended thinking blocks pass through unmodified
    Given Claude Code receives a response with thinking content blocks via streaming
    When the proxy relays thinking_delta events
    Then thinking blocks arrive unmodified
    And Claude Code displays the thinking output correctly

  Scenario: Count tokens request forwarded without creating a trace
    Given Priya sends a count_tokens request through the proxy
    When the proxy forwards the request
    Then the token count response is returned unmodified
    And no trace is created in the knowledge graph
