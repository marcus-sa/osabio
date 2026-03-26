Feature: Evidence-Backed Intent Authorization
  As a workspace administrator managing autonomous agents,
  I want agent authorization requests to be grounded in verifiable system state,
  so that compromised or misbehaving agents cannot fabricate justification for high-stakes actions.

  Background:
    Given the workspace "Acme Supply Chain" has evidence enforcement set to "hard"
    And the workspace has 15 confirmed decisions and 20 completed tasks
    And the Logistics-Planner agent has identity "logistics-planner-001"

  # --- Evidence Submission ---

  Scenario: Agent submits intent with valid evidence references
    Given Ravi Patel has confirmed decision "Switch to regional warehousing for Southeast Asia"
    And the Logistics-Planner agent has completed task "Audit current fulfillment SLAs"
    And the Observer has created verified observation "Supplier lead times increased 40% in Q2" with confidence 0.85
    When the Logistics-Planner agent creates an intent to reroute Southeast Asia orders
    And the intent includes evidence_refs pointing to the decision, task, and observation
    Then the intent is created with status "draft"
    And the intent record contains 3 evidence references

  Scenario: Agent submits intent without evidence references
    Given the workspace evidence enforcement is "hard"
    And the Logistics-Planner agent creates an intent to modify supplier contracts
    And the intent has no evidence_refs
    When the intent transitions to "pending_auth"
    Then the intent is rejected before LLM evaluation
    And the error reason is "Insufficient evidence: 0 refs provided, minimum 1 required for this risk tier"

  # --- Deterministic Verification Pipeline ---

  Scenario: All evidence references pass verification
    Given an intent with evidence_refs:
      | ref                | entity_type  | status     | workspace            | author               |
      | decision:abc123    | decision     | confirmed  | Acme Supply Chain    | ravi-patel           |
      | task:def456        | task         | completed  | Acme Supply Chain    | logistics-planner-001|
      | observation:ghi789 | observation  | open       | Acme Supply Chain    | observer-agent       |
    And the intent requester is "logistics-planner-001"
    When the verification pipeline runs
    Then evidence_verification.verified_count is 3
    And evidence_verification.failed_refs is empty
    And evidence_verification.verification_time_ms is less than 100

  Scenario: Non-existent evidence reference fails verification
    Given an intent with evidence_ref "observation:does-not-exist"
    When the verification pipeline runs
    Then evidence_verification.failed_refs contains "observation:does-not-exist"
    And the verification result includes warning "Reference observation:does-not-exist not found"

  Scenario: Cross-workspace evidence reference fails scope check
    Given an intent in workspace "Acme Supply Chain"
    And an evidence_ref "decision:xyz789" belonging to workspace "Other Organization"
    When the verification pipeline runs
    Then the reference fails scope containment check
    And evidence_verification.failed_refs contains "decision:xyz789"

  Scenario: Superseded decision fails liveness check
    Given decision "Original supplier routing policy" has status "superseded"
    And an intent references this decision as evidence
    When the verification pipeline runs
    Then the reference fails liveness check
    And evidence_verification.warnings contains "Referenced decision has been superseded"

  Scenario: Evidence created after intent fails temporal check
    Given an intent created at "2026-03-25T10:00:00Z"
    And an evidence_ref pointing to observation created at "2026-03-25T10:05:00Z"
    When the verification pipeline runs
    Then the reference fails temporal ordering check
    And evidence_verification.failed_refs contains the future-dated reference

  # --- Authorship Independence ---

  Scenario: High-risk intent requires independent authorship
    Given a high-risk intent (risk tier requiring 3 refs with 2 independent)
    And the intent requester is "logistics-planner-001"
    And evidence_refs:
      | ref             | author                |
      | decision:abc123 | ravi-patel            |
      | task:def456     | logistics-planner-001 |
      | observation:ghi | observer-agent        |
    When the verification pipeline checks authorship independence
    Then 2 refs are authored by identities other than the requester
    And the authorship independence requirement is satisfied

  Scenario: Self-referencing evidence detected for high-risk intent
    Given a high-risk intent requiring 2 independent evidence refs
    And the intent requester is "logistics-planner-001"
    And all 3 evidence_refs are authored by "logistics-planner-001"
    When the verification pipeline checks authorship independence
    Then 0 refs are authored by independent identities
    And the authorship independence requirement fails
    And evidence_verification.warnings contains "Insufficient independent evidence: 0 of 2 required"

  # --- Minimum Evidence Age ---

  Scenario: Recently created evidence fails minimum age check
    Given the workspace has minimum evidence age of 5 minutes
    And an intent references observation:recent created 30 seconds ago
    When the verification pipeline runs
    Then the reference fails minimum age check
    And evidence_verification.warnings contains "Evidence observation:recent is newer than minimum age threshold"

  # --- Risk-Tiered Evidence Requirements ---

  Scenario: Low-risk intent needs only 1 evidence reference
    Given an intent with risk score 15
    And the intent has 1 verified evidence reference
    When the risk router evaluates evidence sufficiency
    Then the evidence requirement for low-risk tier (1 ref) is met
    And the routing decision is "auto_approve"

  Scenario: Medium-risk intent needs 2 references including a decision or task
    Given an intent with risk score 50
    And the intent has 2 evidence refs: 1 confirmed decision and 1 observation
    And at least 1 ref is authored by a different identity
    When the risk router evaluates evidence sufficiency
    Then the evidence requirement for medium-risk tier is met

  Scenario: High-risk intent needs 3+ references with authorship independence
    Given an intent with risk score 85
    And the intent has 3 evidence refs
    And the refs include a confirmed decision and a completed task
    And at least 2 refs are authored by different identities than the requester
    When the risk router evaluates evidence sufficiency
    Then the evidence requirement for high-risk tier is met

  # --- Soft vs Hard Enforcement ---

  Scenario: Soft enforcement adds risk score for evidence shortfall
    Given the workspace evidence enforcement is "soft"
    And an intent requiring 2 evidence refs but providing only 1
    And the LLM risk score is 25
    When the risk router evaluates the intent
    Then the effective risk score is 45
    And the routing decision is "veto_window" instead of "auto_approve"

  Scenario: Hard enforcement rejects insufficient evidence
    Given the workspace evidence enforcement is "hard"
    And an intent requiring 3 evidence refs but providing only 1
    When the intent transitions to "pending_auth"
    Then the intent is rejected before LLM evaluation
    And the error reason explains the specific evidence shortfall

  # --- Bootstrapping ---

  Scenario: New workspace operates in bootstrap mode
    Given a newly created workspace "Fresh Supply Chain" with 0 confirmed decisions
    And the workspace evidence_enforcement is "bootstrap"
    When the first agent creates an intent without evidence_refs
    Then the intent proceeds to LLM evaluation without evidence requirements
    And the intent is logged with a bootstrap_exemption flag

  Scenario: Workspace transitions from bootstrap to soft enforcement
    Given workspace "Fresh Supply Chain" in "bootstrap" enforcement mode
    When the first decision in the workspace is confirmed
    Then the workspace evidence_enforcement transitions to "soft"

  Scenario: Workspace transitions from soft to hard enforcement
    Given workspace "Acme Supply Chain" in "soft" enforcement mode
    And the workspace has 10 confirmed decisions and 5 completed tasks
    When the workspace reaches the maturity threshold
    Then the workspace evidence_enforcement transitions to "hard"

  # --- Fabrication Detection ---

  Scenario: Evidence spam triggers Observer anomaly detection
    Given the Logistics-Planner agent creates 15 observations in 10 minutes
    When the Observer runs its periodic scan
    Then the Observer creates an anomaly observation of type "evidence_anomaly"
    And the anomaly references the suspicious creation pattern
    And the anomaly is visible in the governance feed

  # --- Feed Display ---

  Scenario: Governance feed shows evidence chain for pending intent
    Given an intent in "pending_veto" status with 3 verified evidence refs
    When Ravi Patel views the intent in the governance feed
    Then each evidence reference shows entity type, title, and verification status
    And Ravi can navigate to any referenced entity
    And the evidence verification summary shows "3/3 verified"

  Scenario: Feed highlights failed evidence references
    Given an intent with 2 verified and 1 failed evidence ref
    When Ravi Patel views the intent in the governance feed
    Then verified references show a success indicator
    And the failed reference shows a failure indicator with reason
    And the evidence summary shows "2/3 verified"

  # --- Property Scenarios ---

  @property
  Scenario: Evidence verification latency stays bounded
    Given the system is processing intents with 1-10 evidence references
    Then evidence verification completes within 100ms at the 95th percentile
    And no single verification exceeds 500ms

  @property
  Scenario: Evidence verification is deterministic
    Given the same intent with the same evidence_refs
    When verification runs multiple times
    Then the result is identical each time
    And the result does not depend on LLM output
