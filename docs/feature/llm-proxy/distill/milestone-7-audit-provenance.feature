Feature: Audit Provenance Chain (US-LP-007)
  As a compliance auditor,
  I need to verify that every LLM call was authorized and traceable,
  so that I can produce audit reports without manual log archaeology.

  Background:
    Given Brain's proxy has been capturing traces with full provenance edges
    And Elena is a compliance auditor for workspace "brain-v1"

  # --- Happy Path ---

  Scenario: Auditor views full provenance chain for a trace
    Given Elena queries a specific trace in the audit view
    When the trace detail loads
    Then Elena sees model, token counts, cost, latency, and stop reason
    And the provenance chain shows linked entities from session through to workspace
    And Elena can export the provenance chain as structured data

  Scenario: Auditor queries traces by project and date range
    Given Elena queries traces for project "auth-service" between March 1 and March 15
    When the query executes
    Then results return within 2 seconds
    And each result includes model, tokens, cost, session reference, and policy reference

  # --- Compliance Checks ---

  Scenario: Authorization compliance check passes
    Given all LLM traces in March have an associated policy authorization
    When Elena runs the compliance check
    Then the report shows 100% compliance
    And each trace is verified to have an active policy at the time of the call

  # --- Error Paths ---

  Scenario: Traces without authorization flagged as unverified
    Given 17 LLM traces were processed during a policy migration gap
    When Elena runs the compliance check
    Then those 17 traces are flagged as "unverified"
    And each flagged trace shows the time period and reason for missing authorization
    And the compliance summary shows authorized and unverified counts separately
