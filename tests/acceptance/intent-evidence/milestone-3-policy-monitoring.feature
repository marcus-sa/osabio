Feature: Policy-Driven Evidence Rules and Observer Monitoring
  As a workspace administrator,
  I want to define custom evidence rules via policies and detect evidence anomalies,
  so that evidence requirements are configurable per action type and fabrication patterns are caught.

  Background:
    Given workspace "Acme Supply Chain" has evidence enforcement set to "hard"
    And the Observer agent runs periodic scans

  # --- US-10: Policy Evidence Rules ---

  Scenario: Policy defines stricter evidence requirements for financial actions
    Given a policy rule requiring 4 evidence references for "financial_transaction" actions
    And the policy requires 2 confirmed decisions among the references
    When the Logistics-Planner agent submits an intent for a financial transaction
    And the intent provides only 2 evidence references
    Then the intent fails the policy-specific evidence requirement
    And the failure reason cites the policy rule

  Scenario: Policy overrides default tier requirements for specific action type
    Given a policy rule requiring 1 evidence reference for "data_read" actions (overriding default)
    When the Logistics-Planner agent submits a data read intent with 1 observation reference
    Then the policy-specific requirement is met
    And default tier requirements are not applied

  Scenario: Intent without matching policy falls back to default tier requirements
    Given no policy rules exist for "configuration_update" actions
    When the Logistics-Planner agent submits a configuration update intent
    Then the default risk-tiered evidence requirements apply

  # --- US-10: Observer Anomaly Detection ---

  Scenario: Evidence spam triggers Observer anomaly detection
    Given the Logistics-Planner agent creates 15 observations in 10 minutes
    When the Observer runs its periodic scan
    Then the Observer creates an anomaly observation of type "evidence_anomaly"
    And the anomaly references the suspicious creation pattern
    And the anomaly is visible in the governance feed

  Scenario: Observer detects repeated evidence reuse across intents
    Given the same 2 evidence references are used in 8 different intents
    When the Observer runs its periodic scan
    Then the Observer flags the reuse pattern as an evidence anomaly
    And the anomaly identifies the specific references being reused

  Scenario: Normal evidence usage does not trigger anomaly
    Given agents submit intents with varied evidence references over a week
    And no single agent creates more than 5 observations per hour
    When the Observer runs its periodic scan
    Then no evidence anomaly observations are created
