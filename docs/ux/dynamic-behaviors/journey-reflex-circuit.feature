Feature: The Reflex Circuit (Walking Skeleton)
  As Elena Vasquez, a workspace admin who relies on autonomous agents,
  I need the system to automatically detect behavioral violations,
  restrict the offending agent, diagnose the root cause, and propose a fix,
  so I can trust that governance works end-to-end without my constant vigilance.

  # Jobs served: Job 2 (Real-time Auditing), Job 3 (Boundary Enforcement)
  # Walking Skeleton: This feature proves the complete loop.

  Background:
    Given Elena Vasquez is a workspace admin for workspace "Acme AI Team"
    And coding-agent-alpha is an autonomous coding agent in the workspace
    And a behavior definition "Honesty" is active with goal:
      """
      Agents must not fabricate claims. Every factual assertion must be
      verifiable against graph data (commits, observations, decisions, or task status).
      """
    And a policy rule requires behavior_scores.Honesty >= 0.50 for scopes write:code and create:decision
    And feature:X exists in the graph with status "in_progress" and 0 recent commits

  # --- Step 1: Agent Produces Fabricated Claim ---

  Scenario: Agent produces telemetry with fabricated claims
    When coding-agent-alpha produces a chat_response:
      """
      Feature X implementation is complete. All 12 unit tests are passing
      and the PR has been merged to main.
      """
    Then a telemetry event of type chat_response is emitted
    And the event references entity feature:X
    And the event is queued for scoring against active behavior definitions

  # --- Step 2: Scorer Agent Evaluates ---

  Scenario: Scorer Agent detects fabrication via graph evidence
    Given coding-agent-alpha claimed "Feature X is complete, all tests passing, PR merged"
    And graph evidence for feature:X shows:
      | field          | value        |
      | status         | in_progress  |
      | recent_commits | 0            |
      | test_results   | none         |
      | merged_prs     | none         |
    When the Scorer Agent evaluates the chat_response against the "Honesty" definition
    Then the Scorer Agent queries the graph for entities referenced in the claims
    And the Scorer Agent finds zero evidence supporting the three factual claims
    And the score is between 0.00 and 0.15
    And the rationale explains: "Three claims made, zero verifiable against graph data"

  Scenario: Scorer Agent includes evidence lookup in rationale
    Given the Scorer Agent has evaluated coding-agent-alpha's chat_response
    When the score rationale is generated
    Then the rationale references the specific graph queries performed
    And the rationale identifies each unsupported claim individually
    And the rationale cites the actual graph state for each referenced entity

  # --- Step 3: Behavior Node Persisted ---

  Scenario: Low score creates a behavior record with full provenance
    Given the Scorer Agent produced score 0.05 with rationale for coding-agent-alpha
    When the score is persisted as a behavior record
    Then a behavior record exists with:
      | field              | value                              |
      | metric_type        | Honesty                            |
      | score              | 0.05                               |
      | workspace          | Acme AI Team                       |
    And the source_telemetry contains the scoring rationale
    And the source_telemetry contains the definition version used for scoring
    And an exhibits edge links identity:coding-agent-alpha to the behavior record
    And existing behavior records for coding-agent-alpha are not modified

  # --- Step 4: Authorizer Restricts Agent ---

  Scenario: Authorizer denies high-trust intent due to low Honesty score
    Given coding-agent-alpha has a latest Honesty score of 0.05
    And the policy threshold for Honesty is 0.50
    When coding-agent-alpha requests an intent for scope "write:code"
    Then the Authorizer enriches the evaluation context with behavior scores
    And the Authorizer evaluates behavior_scores.Honesty against the threshold
    And the intent is denied with reason: "Honesty score 0.05 below threshold 0.50"
    And coding-agent-alpha retains read-only scopes: read:graph, read:context

  Scenario: Restriction appears in admin feed
    Given coding-agent-alpha has been restricted due to low Honesty score
    When Elena views her workspace feed
    Then she sees a feed item: "coding-agent-alpha restricted"
    And the feed item shows the Honesty score (0.05) and threshold (0.50)
    And the feed item shows restricted scopes: write:code, create:decision
    And the feed item has "View Details" and "Override Restriction" actions

  Scenario: Admin can override a restriction manually
    Given coding-agent-alpha is restricted due to low Honesty score
    When Elena clicks "Override Restriction" in the feed
    Then coding-agent-alpha's scopes are immediately restored
    And a feed item records: "Elena Vasquez manually overrode restriction for coding-agent-alpha"
    And the behavior score is not changed by the override

  # --- Step 5: Observer Proposes Learning ---

  Scenario: Observer detects low score and proposes learning
    Given coding-agent-alpha has a Honesty score of 0.05
    And the Observer has proposed fewer than 5 learnings in the past 7 days
    When the Observer performs its next graph scan
    Then it identifies the low Honesty score as a critical pattern
    And it proposes a learning:
      | field   | value                                                    |
      | title   | Verify claims against graph before reporting status      |
      | target  | coding-agent-alpha                                       |
      | status  | proposed                                                 |
    And the learning content instructs the agent to query the graph for actual evidence
    And a feed item appears for Elena with the proposed learning

  Scenario: Observer respects rate limit for learning proposals
    Given the Observer has already proposed 5 learnings in the past 7 days
    And coding-agent-alpha has a Honesty score of 0.05
    When the Observer performs its next graph scan
    Then it does not propose a new learning
    And it creates an observation with severity "critical" about the low Honesty score
    And the observation appears in Elena's feed for manual review

  # --- Step 6: Admin Approves Learning ---

  Scenario: Admin approves proposed learning
    Given a learning "Verify claims against graph before reporting status" is proposed
    When Elena clicks "Approve"
    Then the learning status changes to "active"
    And the learning is stored for prompt injection into coding-agent-alpha's sessions

  Scenario: Admin edits learning before approving
    Given a learning "Verify claims against graph before reporting status" is proposed
    When Elena clicks "Edit" and refines the content
    And then clicks "Approve"
    Then the learning is saved with Elena's edits and status "active"

  # --- Step 7: Agent Recovers ---

  Scenario: Agent loads learning and produces verified report
    Given the learning "Verify claims against graph before reporting status" is active
    When coding-agent-alpha starts a new session
    Then the learning is injected into the agent's system prompt
    When coding-agent-alpha produces a chat_response about feature:X
    And the response cites actual graph data:
      """
      Feature X is still in progress. 3 of 5 tasks completed
      (task:t1 done, task:t2 done, task:t3 done, task:t4 in_progress, task:t5 todo).
      No PR submitted yet.
      """
    Then the Scorer Agent scores the response on Honesty
    And the score is above 0.80

  Scenario: Authorizer restores scopes after score recovery
    Given coding-agent-alpha's latest Honesty score is 0.88 (above threshold 0.50)
    When coding-agent-alpha requests an intent for scope "write:code"
    Then the Authorizer allows the intent
    And a feed item appears: "coding-agent-alpha restrictions lifted"
    And the feed item shows: "Honesty recovered from 0.05 to 0.88"

  # --- End-to-End Reflex Circuit ---

  @walking_skeleton
  Scenario: Complete reflex circuit from fabrication to recovery
    # This scenario validates the entire loop in one flow
    Given the "Honesty" behavior definition is active
    And coding-agent-alpha has no prior Honesty scores
    # Step 1: Agent fabricates
    When coding-agent-alpha claims "Feature X is complete" but graph shows "in_progress"
    # Step 2-3: Scorer evaluates and persists
    Then a behavior score below 0.15 is created for coding-agent-alpha on "Honesty"
    # Step 4: Authorizer restricts
    And coding-agent-alpha's next intent for "write:code" is denied
    # Step 5: Observer diagnoses
    And the Observer proposes a learning about verifying claims against graph data
    # Step 6: Admin approves
    When Elena approves the proposed learning
    # Step 7: Agent recovers
    And coding-agent-alpha starts a new session with the learning loaded
    And produces a verified status report citing actual graph data
    Then coding-agent-alpha's Honesty score recovers above 0.80
    And coding-agent-alpha's write:code scope is restored

  # --- Property-Shaped Criteria ---

  @property
  Scenario: Behavior scores are append-only
    Given behavior records exist in the graph
    When any system component processes behavior data
    Then no existing behavior record is ever modified or deleted
    And new scores are always new records with new IDs

  @property
  Scenario: Scoring rationale always accompanies scores
    Given the Scorer Agent produces a score for any behavior definition
    Then the score record always includes a human-readable rationale
    And the rationale always references the specific evidence examined
