Feature: Core Evidence Verification Pipeline
  As a workspace administrator,
  I want the system to verify that evidence references point to real, valid records,
  so that agents cannot fabricate justification for authorization requests.

  Background:
    Given workspace "Acme Supply Chain" has evidence enforcement set to "soft"
    And the Logistics-Planner agent has identity "logistics-planner-001"

  # --- US-01: Evidence Schema and Submission ---

  Scenario: Agent submits intent with valid evidence references
    Given Ravi Patel has confirmed the decision "Switch to regional warehousing for Southeast Asia"
    And the Logistics-Planner agent has completed the task "Audit current fulfillment SLAs"
    When the Logistics-Planner agent creates an intent to reroute Southeast Asia orders
    And the intent includes evidence references pointing to the decision and task
    Then the intent is created with status "draft"
    And the intent record contains 2 evidence references

  Scenario: Agent submits intent without evidence references
    When the Logistics-Planner agent creates an intent to update pricing rules
    And the intent has no evidence references
    Then the intent is created with status "draft"
    And the evidence references field is absent from the record

  Scenario: Agent submits intent with references to unsupported entity types
    When the Logistics-Planner agent creates an intent with a reference to an unsupported entity type
    Then the creation fails with a validation error identifying the invalid reference type

  # --- US-02: Deterministic Verification Pipeline ---

  Scenario: All evidence references pass verification
    Given the workspace contains a confirmed decision, completed task, and verified observation
    And all evidence records are in the same workspace as the intent
    When the agent creates an intent referencing all three records
    And the verification pipeline runs
    Then the verification result shows 3 verified references
    And no references failed verification
    And verification completed in less than 100 milliseconds

  Scenario: Non-existent evidence reference fails verification
    Given the agent references an observation that does not exist in the system
    When the verification pipeline runs
    Then the failed references list contains the non-existent observation
    And the verification result includes a warning about the missing reference

  Scenario: Cross-workspace evidence reference fails scope check
    Given a decision exists in workspace "Other Organization" but not in "Acme Supply Chain"
    And the agent creates an intent in "Acme Supply Chain" referencing that decision
    When the verification pipeline runs
    Then the failed references list contains the cross-workspace decision
    And the reference fails scope containment check

  Scenario: Superseded decision fails liveness check
    Given the decision "Original supplier routing policy" has been superseded
    And the agent references this superseded decision as evidence
    When the verification pipeline runs
    Then the failed references list contains the superseded decision
    And the verification warnings note that the decision has been superseded

  Scenario: Evidence created after intent fails temporal check
    Given an intent was created before a particular observation existed
    And the intent references that future-dated observation
    When the verification pipeline runs
    Then the failed references list contains the future-dated reference
    And the verification warnings note the temporal ordering violation

  # --- US-03: Soft Enforcement ---

  Scenario: Evidence shortfall adds penalty to risk score under soft enforcement
    Given the workspace evidence enforcement is "soft"
    And an intent requires 2 evidence references for its risk tier but provides only 1
    When the evaluation pipeline processes the intent
    Then the effective risk score is elevated by the evidence shortfall penalty
    And the routing decision reflects the elevated risk

  Scenario: Full evidence keeps risk score unchanged under soft enforcement
    Given the workspace evidence enforcement is "soft"
    And an intent provides all required evidence references for its risk tier
    When the evaluation pipeline processes the intent
    Then the effective risk score equals the base risk score
    And no evidence penalty is applied

  # --- US-04: Verification Result Storage ---

  Scenario: Verification result is persisted on intent record
    Given an intent with 3 evidence references that all pass verification
    When the verification pipeline completes
    Then the intent record stores the verification result
    And the verified count is 3
    And the verification time is recorded

  Scenario: Failed references are individually identified in verification result
    Given an intent with 1 valid reference and 1 non-existent reference
    When the verification pipeline completes
    Then the verification result shows 1 verified and 1 failed
    And the failed reference is individually identified with failure reason
