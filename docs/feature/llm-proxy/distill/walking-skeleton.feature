Feature: LLM Proxy Walking Skeleton
  As a developer using Claude Code through Brain's proxy,
  I want my LLM calls to be forwarded transparently and traced in the graph,
  so that I get observability without changing my workflow.

  These walking skeletons prove the thinnest E2E slices delivering
  observable user value. Each answers "can a user accomplish their goal?"

  @walking_skeleton
  Scenario: Developer makes an LLM call through the proxy and it works identically
    Given Priya has configured Claude Code to use Brain's proxy
    And she has a valid Anthropic API key
    When Priya sends a non-streaming request for model "claude-sonnet-4"
    Then she receives the model's response with the original content
    And the response is indistinguishable from calling Anthropic directly

  @walking_skeleton
  Scenario: Developer's LLM call is recorded as a trace in the knowledge graph
    Given Priya has configured Claude Code to use Brain's proxy
    And she is working in workspace "brain-v1"
    When Priya sends a request for model "claude-sonnet-4" with 500 input tokens
    Then the model response is delivered to Priya
    And a trace appears in the knowledge graph with model "claude-sonnet-4"
    And the trace records the token counts and computed cost
    And the trace is linked to workspace "brain-v1"

  @walking_skeleton
  Scenario: Admin sees cost of an LLM call attributed to the correct project
    Given Priya is working on task "implement-oauth" in project "auth-service"
    And she makes an LLM call through the proxy costing $0.046
    When Marcus queries the spend breakdown for workspace "brain-v1"
    Then the $0.046 cost appears under project "auth-service"
    And the cost is attributed to task "implement-oauth"
