Feature: Evidence-Backed Intent Authorization -- Walking Skeleton
  As a workspace administrator managing autonomous agents,
  I want agent authorization requests to include verifiable evidence references,
  so that I can trust that agent actions are grounded in real system state.

  Background:
    Given workspace "Acme Supply Chain" has evidence enforcement set to "soft"
    And the Logistics-Planner agent has an active identity in the workspace

  # Walking Skeleton 1: Thinnest E2E slice -- evidence submitted, verified, influences routing
  @walking_skeleton
  Scenario: Agent submits intent with evidence and receives risk-adjusted authorization
    Given Ravi Patel has confirmed the decision "Switch to regional warehousing for Southeast Asia"
    And the Logistics-Planner agent has completed the task "Audit current fulfillment SLAs"
    When the Logistics-Planner agent creates an intent to reroute Southeast Asia orders
    And the intent includes evidence references pointing to the decision and task
    And the agent submits the intent for authorization
    Then the intent contains 2 evidence references
    And the evidence is verified as existing in the workspace
    And the evaluation proceeds with evidence context available

  # Walking Skeleton 2: Missing evidence raises risk score under soft enforcement
  @walking_skeleton
  Scenario: Agent submits intent without evidence and receives elevated risk score
    Given the workspace evidence enforcement is "soft"
    When the Logistics-Planner agent creates an intent to modify supplier contracts
    And the intent has no evidence references
    And the agent submits the intent for authorization
    Then the effective risk score is higher than the base risk score
    And the intent is routed to a veto window instead of auto-approval

  # Walking Skeleton 3: Hard enforcement rejects intent with no evidence
  @walking_skeleton
  Scenario: Hard enforcement blocks intent with insufficient evidence before evaluation
    Given the workspace evidence enforcement is "hard"
    When the Logistics-Planner agent creates an intent to reroute all orders
    And the intent has no evidence references
    And the agent submits the intent for authorization
    Then the intent is rejected before evaluation occurs
    And the rejection reason explains the evidence shortfall
