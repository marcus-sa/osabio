Feature: Cost Attribution and Spend Tracking (US-LP-004)
  As a workspace admin,
  I need per-project LLM cost breakdowns computed automatically,
  so that I can understand where my LLM budget is going without manual calculation.

  Background:
    Given Brain's proxy captures traces with usage data
    And model pricing is configured for all supported models

  # --- Happy Path ---

  Scenario: Cost computed from Sonnet streaming response with cache efficiency
    Given a streaming response completes with model "claude-sonnet-4"
    And input_tokens is 12340, output_tokens is 2100, cache_read_tokens is 8200
    When the proxy computes cost
    Then cost equals (4140 * $3.00 + 8200 * $0.30 + 2100 * $15.00) / 1000000
    And the computed cost $0.046 is stored on the trace

  Scenario: Cost computed from Haiku non-streaming response
    Given a non-streaming response completes with model "claude-haiku-3.5"
    And input_tokens is 500, output_tokens is 100, no cache tokens
    When the proxy computes cost
    Then cost equals (500 * $0.80 + 100 * $4.00) / 1000000
    And the computed cost $0.0008 is stored on the trace

  Scenario: Spend counters updated at workspace, project, and task levels
    Given a call costs $0.046 attributed to workspace "brain-v1", project "auth-service", task "implement-oauth"
    When spend counters are updated
    Then workspace "brain-v1" daily spend increases by $0.046
    And project "auth-service" spend increases by $0.046
    And task "implement-oauth" spend increases by $0.046

  # --- Edge Cases ---

  Scenario: Unattributed costs visible in workspace total
    Given 10 LLM calls totaling $5.00 have no task attribution
    And 50 LLM calls totaling $45.00 have full attribution
    When Marcus queries the workspace spend breakdown
    Then workspace total shows $50.00
    And the breakdown shows $45.00 attributed across projects
    And $5.00 listed under "unattributed"

  Scenario: Historical costs unaffected by pricing changes
    Given a trace was created yesterday with cost $0.046 at old pricing
    And model pricing is updated today
    When Marcus queries yesterday's spend
    Then the historical cost remains $0.046
    And today's calls use the new pricing

  # --- API ---

  Scenario: Spend breakdown available via workspace API
    Given workspace "brain-v1" has traces across multiple projects
    When Marcus queries the spend breakdown for today
    Then the response includes workspace total spend
    And per-project breakdown with call count
    And the response arrives within 2 seconds

  @property
  Scenario: Spend counters are consistent with trace data
    Given spend counters exist for any scope
    Then the sum of trace costs for that scope equals the counter value
    And any discrepancy triggers reconciliation
