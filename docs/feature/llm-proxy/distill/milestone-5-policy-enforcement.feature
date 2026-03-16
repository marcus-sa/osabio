Feature: Policy Enforcement at the LLM Call Boundary (US-LP-005)
  As a workspace admin,
  I need guardrails that prevent unauthorized model usage and runaway spending,
  so that agents operate within governed boundaries.

  Background:
    Given Brain's proxy is running with policy enforcement enabled
    And workspace "brain-v1" has identity resolution configured

  # --- Happy Path ---

  Scenario: Authorized request passes policy check and is forwarded
    Given workspace "brain-v1" allows "coding-agent" to use "claude-sonnet-4"
    And daily spend is $12.40 against a $50.00 limit
    And request rate is 45 per minute against a 60 per minute limit
    When a coding-agent requests model "claude-sonnet-4"
    Then the policy check passes
    And the request is forwarded to Anthropic

  # --- Error Paths ---

  Scenario: Unauthorized model request is blocked with policy reference
    Given workspace "brain-v1" allows "observer" to use only "claude-haiku-3.5"
    When the observer agent requests model "claude-opus-4"
    Then the request is rejected with a policy violation
    And the error identifies which policy was violated
    And the error suggests using an authorized model or requesting admin access

  Scenario: Budget exceeded request is blocked with spend details
    Given workspace "brain-v1" has daily budget $50.00 and current spend $49.80
    When any agent makes an LLM request
    Then the request is rejected as over budget
    And the error shows current spend $49.80 and limit $50.00
    And the error suggests contacting the workspace admin or waiting until tomorrow

  Scenario: Rate limited request is blocked with retry guidance
    Given workspace "brain-v1" rate limit is 60 requests per minute
    And 60 requests have been made in the current minute
    When request number 61 arrives
    Then the request is rejected as rate limited
    And a retry-after indicator shows when the next request will be accepted
    And the error describes the rate limit exceeded

  # --- Edge Cases ---

  Scenario: No policies configured defaults to permissive with warning
    Given workspace "brain-v1" has no model access policies configured
    When any agent requests any model
    Then the request is forwarded (permissive default)
    And a warning observation is created noting missing policies

  Scenario: Policy check does not add perceptible latency
    Given workspace "brain-v1" has active model access and budget policies
    When a request passes all policy checks
    Then the policy evaluation completes within 10ms

  Scenario: Policy decision logged for audit trail
    Given a request passes or fails policy evaluation
    When the policy decision is recorded
    Then the decision includes pass/fail result, policy reference, and timestamp
    And the decision is queryable in the audit trail
