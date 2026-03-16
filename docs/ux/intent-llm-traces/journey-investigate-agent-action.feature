Feature: Investigating a Failed Agent Action
  As a workspace admin investigating autonomous agent actions,
  I want to see the LLM's chain-of-thought reasoning behind observations and intent evaluations,
  so I can diagnose whether the agent reasoned correctly and take corrective action.

  Background:
    Given workspace "Acme Product" managed by Carla Navarro
    And the Observer agent has completed a graph scan
    And the Observer used LLM verification for entity "task:i9j0k1l2" against "decision:e5f6g7h8"

  # --- Job 1: Forensic Debugging (Happy Path) ---

  Scenario: LLM reasoning persisted on observation during verification
    Given the Observer's generateVerificationVerdict returned a verdict with reasoning
      """
      The task "Migrate billing to tRPC" (task:i9j0k1l2) explicitly targets the billing API
      for migration from REST to tRPC. However, decision "Standardize on REST for public APIs"
      (decision:e5f6g7h8, status: confirmed) requires all public-facing APIs to use REST.
      The billing API is public-facing (it serves external payment provider webhooks).
      Therefore, migrating it to tRPC would violate the confirmed decision.
      """
    When the Observer creates an observation from the verification result
    Then the observation record includes a "reasoning" field containing the LLM chain-of-thought
    And the observation "text" field contains the agent's conclusion (distinct from reasoning)
    And the observation "confidence" is 0.82
    And the observation "source" is "llm"
    And the observation "evidence_refs" includes "decision:e5f6g7h8" and "task:i9j0k1l2"

  Scenario: Workspace admin views LLM reasoning via "View Logic" toggle
    Given observation "observation:a1b2c3d4" has a "reasoning" field populated
    And Carla Navarro is viewing the observation detail page
    When Carla clicks "View Logic"
    Then the reasoning panel expands showing the full LLM chain-of-thought
    And the panel displays the model identifier from the linked trace
    And the panel shows a link to the trace record for model stats
    And the reasoning text references entity IDs that match evidence_refs

  Scenario: Admin diagnoses valid finding and acknowledges
    Given Carla has read the LLM reasoning for observation "observation:a1b2c3d4"
    And the reasoning correctly identifies the billing API as public-facing
    When Carla clicks "Acknowledge"
    Then the observation status changes to "acknowledged"
    And Carla can create a remediation task linked to the observation

  # --- Job 1: Forensic Debugging (Error Paths) ---

  Scenario: Legacy observation without reasoning shows graceful fallback
    Given observation "observation:legacy001" was created before the reasoning feature
    And the observation has no "reasoning" field
    When Carla opens the observation detail
    Then the "View Logic" toggle is visible but dimmed
    And clicking it shows "No reasoning recorded for this observation"
    And the trace link is shown as a fallback for model stats

  Scenario: Deterministic fallback observation shows source explanation
    Given observation "observation:det001" has source "deterministic_fallback"
    And the observation has no LLM reasoning (LLM call failed)
    When Carla clicks "View Logic"
    Then the panel shows "Reasoning unavailable: verification used deterministic fallback"
    And the deterministic verdict details are displayed
    And the CI status source is shown

  Scenario: Reasoning exists but linked trace is missing
    Given observation "observation:a1b2c3d4" has reasoning populated
    And the linked trace "trace:x1y2z3" has been pruned
    When Carla views the reasoning panel
    Then the reasoning text is fully displayed
    And the trace link shows "(not found)"
    And model stats are shown as "unavailable"

  # --- Job 2: Drift Detection (Programmatic) ---

  Scenario: Observer queries reasoning for self-calibration
    Given 50 observations exist in workspace "Acme Product" with reasoning populated
    And the observations span the last 30 days
    When the Observer agent queries observations with reasoning for drift analysis
    Then the query returns observations with reasoning, confidence, and created_at fields
    And observations without reasoning (legacy or fallback) are excluded
    And the Observer can compute reasoning quality metrics across the time window

  Scenario: Behavior scorer evaluates Observer reasoning quality
    Given behavior definition "Observer Verification Quality" exists for workspace "Acme Product"
    And 20 recent observations have reasoning populated
    When the behavior scorer evaluates the Observer agent
    Then the scorer loads observation reasoning as scoring input
    And the score reflects reasoning specificity (evidence references, entity mentions)
    And the trend is compared against the previous scoring period

  # --- Job 3: Audit/Compliance ---

  Scenario: LLM reasoning persisted on intent authorization evaluation
    Given intent "intent:auth001" for action "deploy billing service"
    And the Authorizer agent evaluated the intent with LLM reasoning
      """
      Intent requests deployment of billing service. Policy "deploy-approval"
      requires human approval for production deployments. The intent's priority (75)
      exceeds the auto-approve threshold (50) in the policy. Risk score: 65.
      Recommending APPROVE with human veto window.
      """
    When the intent evaluation is persisted
    Then the intent record includes an "llm_reasoning" field with the authorization chain-of-thought
    And the existing "reasoning" field retains the human-provided rationale
    And the "evaluation.reason" field retains the one-line summary

  Scenario: Full provenance chain from intent through observation to learning
    Given intent "intent:auth001" has "llm_reasoning" populated
    And the intent's execution produced observation "observation:a1b2c3d4" with "reasoning" populated
    And the observation triggered learning diagnosis with "reasoning" in rootCauseSchema
    When Carla navigates the provenance chain
    Then each node (intent, observation, learning proposal) shows its LLM reasoning
    And the trace hierarchy links all three via parent_trace relationships
    And model stats are available at each trace node

  # --- Properties ---

  @property
  Scenario: Reasoning field does not duplicate observation text
    Given any observation created by the Observer with LLM verification
    Then the "reasoning" field contains the LLM chain-of-thought (how the agent got there)
    And the "text" field contains the observation conclusion (what the agent concluded)
    And the two fields are semantically distinct

  @property
  Scenario: Reasoning is internal telemetry not exposed to non-admin consumers
    Given observation "observation:a1b2c3d4" with reasoning populated
    When a non-Observer agent loads the observation via search_entities or get_entity_detail
    Then the response includes "text", "severity", "confidence" fields
    And the "reasoning" field is not included in the response
    And only workspace admins and the Observer agent can access reasoning

  @property
  Scenario: Reasoning storage does not duplicate model stats from trace table
    Given an observation created from an LLM verification call
    Then the observation stores only the reasoning text (string)
    And model, tokens, cost, and latency are stored exclusively on the linked trace record
    And no model_stats object exists on the observation or intent tables
