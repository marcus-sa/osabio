Feature: Fabrication Resistance -- Authorship Independence and Hard Enforcement
  As a workspace administrator,
  I want evidence requirements that prevent self-referencing and timing exploits,
  so that agents cannot fabricate their own justification for high-stakes actions.

  Background:
    Given the workspace "Acme Supply Chain" has evidence enforcement set to "hard"
    And the workspace has multiple agent identities with independent authorship

  # --- US-05: Authorship Independence ---

  Scenario: High-risk intent with sufficient independent evidence passes authorship check
    Given a high-risk intent from the Logistics-Planner agent
    And the intent references a decision confirmed by Ravi Patel
    And the intent references a task completed by the Logistics-Planner itself
    And the intent references an observation created by the Observer agent
    When the verification pipeline checks authorship independence
    Then 2 references are authored by identities other than the requester
    And the high-risk authorship requirement of 2 independent references is satisfied

  Scenario: Self-referencing evidence fails authorship check for high-risk intent
    Given a high-risk intent from the Logistics-Planner agent
    And all 3 evidence references are authored by the Logistics-Planner itself
    When the verification pipeline checks authorship independence
    Then 0 references are from independent identities
    And the authorship independence requirement fails
    And the verification warns about insufficient independent evidence

  Scenario: Agent-confirmed evidence counts as independent from another agent
    Given a decision confirmed by the Architect agent
    And the Logistics-Planner agent references this decision in its intent
    When the verification pipeline checks authorship
    Then the decision counts as independently authored evidence
    And agent-to-agent independence is recognized

  Scenario: Low-risk intent has no authorship requirement
    Given a low-risk intent from the Logistics-Planner agent
    And the agent authored all evidence references itself
    When the verification pipeline runs
    Then authorship independence is not checked for low-risk intents
    And no authorship warning is generated

  Scenario: Medium-risk intent requires 1 independent evidence reference
    Given a medium-risk intent from the Logistics-Planner agent
    And the intent has 2 evidence references with 1 authored by Ravi Patel
    When the verification pipeline checks authorship independence
    Then 1 reference is authored by an independent identity
    And the medium-risk authorship requirement is satisfied

  # --- US-06: Minimum Evidence Age ---

  Scenario: Recently created evidence fails minimum age check
    Given the workspace minimum evidence age is 5 minutes
    And the Logistics-Planner agent references an observation created 30 seconds ago
    When the verification pipeline runs
    Then the reference fails the minimum age check
    And the verification warns that the evidence is newer than the minimum age threshold

  Scenario: Evidence older than minimum age passes age check
    Given the workspace minimum evidence age is 5 minutes
    And the Logistics-Planner agent references a decision confirmed 10 minutes ago
    When the verification pipeline runs
    Then the reference passes the minimum age check

  # --- US-06: Hard Enforcement ---

  Scenario: Hard enforcement rejects intent with insufficient evidence before evaluation
    Given the workspace evidence enforcement is "hard"
    And the Logistics-Planner agent creates an intent requiring 2 evidence references
    And the intent provides 0 evidence references
    When the intent is submitted for authorization
    Then the intent is rejected with status "failed"
    And the rejection reason explains the evidence shortfall
    And the evaluation pipeline does not call the risk assessor

  Scenario: Hard enforcement passes intent with sufficient evidence to evaluation
    Given the workspace evidence enforcement is "hard"
    And the Logistics-Planner agent creates an intent with all required evidence
    When the intent is submitted for authorization
    Then the intent proceeds to evaluation
    And evidence verification shows all references verified

  # --- US-07: Risk-Tiered Evidence Requirements ---

  Scenario: Low-risk intent meets tier requirement with 1 reference of any type
    Given an intent with risk score 15
    And the intent has 1 verified evidence reference of type "task"
    When the risk router evaluates evidence sufficiency
    Then the low-risk tier requirement is met

  Scenario: Medium-risk intent requires a decision or task among references
    Given an intent with risk score 50
    And the intent has 2 references including 1 confirmed decision and 1 observation
    And 1 reference is authored by a different identity
    When the risk router evaluates evidence sufficiency
    Then the medium-risk tier requirement is met

  Scenario: High-risk intent fails when missing required evidence types
    Given an intent with risk score 85
    And the intent has 3 references but all are observations
    When the risk router evaluates evidence sufficiency
    Then the high-risk tier type requirement fails
    And the verification warns that high risk requires a decision and a task or observation

  Scenario: High-risk intent needs decision AND task or observation plus independence
    Given an intent with risk score 85
    And the intent references a confirmed decision, a completed task, and a verified observation
    And 2 references are authored by independent identities
    When the risk router evaluates evidence sufficiency
    Then the high-risk tier requirement is fully met

  # --- US-06: Auto-Transition ---

  @property
  Scenario: Workspace transitions from soft to hard at maturity threshold
    Given workspace "Acme Supply Chain" in "soft" enforcement mode
    And the enforcement threshold is 10 confirmed decisions and 5 completed tasks
    When the workspace accumulates enough decisions and tasks to meet the threshold
    Then the workspace enforcement transitions to "hard"
