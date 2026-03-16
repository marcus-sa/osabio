Feature: Graph-Native Trace Capture (US-LP-003)
  As a workspace admin,
  I need every LLM call recorded as a queryable trace in the knowledge graph,
  so that I can investigate agent behavior and track usage patterns.

  Background:
    Given Brain's proxy is running with graph trace capture enabled
    And Priya is working in workspace "brain-v1"

  # --- Happy Path ---

  Scenario: Trace created with full usage data after streaming call
    Given Priya's streaming request completes with model "claude-sonnet-4"
    And the response included 12340 input tokens, 2100 output tokens, and 8200 cache read tokens
    When trace capture runs
    Then a trace node exists with model "claude-sonnet-4"
    And the trace records input_tokens 12340, output_tokens 2100, cache_read_tokens 8200
    And the trace records cost computed from Sonnet pricing
    And the trace records request latency and stop reason

  Scenario: Trace edges link to session, workspace, and task
    Given identity resolution produced session "6ba7b810", workspace "brain-v1", task "implement-oauth"
    When a trace is captured
    Then the agent session is linked to the trace via "invoked" edge
    And the trace is linked to task "implement-oauth" via "attributed_to" edge
    And the trace is linked to workspace "brain-v1" via "scoped_to" edge

  # --- Edge Cases ---

  Scenario: Trace without task has workspace and session edges only
    Given no task header was present in the request
    When the trace is captured
    Then the trace is linked to workspace "brain-v1"
    And the agent session is linked to the trace
    And no task attribution edge is created

  Scenario: Non-streaming response produces identical trace structure
    Given Priya sends a non-streaming request that completes with 500 input tokens and 100 output tokens
    When trace capture runs
    Then a trace node exists with the same fields as a streaming trace
    And usage data is extracted from the response body

  # --- Error Paths ---

  Scenario: Trace capture does not block response delivery
    Given a streaming response is being relayed to Priya
    When the stream completes and Priya receives the full response
    Then trace capture begins after the response is delivered
    And response delivery time is not affected by graph write duration

  Scenario: Graph write failure retries and falls back to structured log
    Given the graph database is temporarily unreachable after a call completes
    When trace capture attempts to write
    Then the proxy retries 3 times with backoff
    And if all retries fail the trace data is logged as structured output
    And a warning observation is created when the graph reconnects

  @property
  Scenario: Every successfully forwarded LLM call has a corresponding trace
    Given the proxy has been running for any period
    Then every forwarded LLM call has a trace node in the graph
    And every trace has at minimum model, input_tokens, output_tokens, cost, and latency
    And every trace has a workspace edge
