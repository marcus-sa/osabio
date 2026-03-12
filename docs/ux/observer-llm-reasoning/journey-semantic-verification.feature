Feature: Semantic Verification via LLM Reasoning
  As the Brain knowledge graph system
  I want the observer to use LLM reasoning for semantic contradiction detection
  So that contradictions between decisions and implementation are caught beyond string matching

  Background:
    Given a workspace with an active observer agent
    And a Haiku-class LLM model configured for observer reasoning

  # --- J1: Semantic Contradiction Detection ---

  Scenario: LLM detects semantic contradiction between decision and completed task
    Given a confirmed decision "minimize external dependencies"
    And a task "add Redis, Kafka, and RabbitMQ integrations" linked to the same project
    When the task status transitions to "completed"
    And the observer verification pipeline runs
    Then the LLM reasoning step receives the decision text and task details
    And the LLM identifies a semantic contradiction
    And an observation is created with severity "conflict"
    And the observation text explains the contradiction in natural language
    And the observation links to both the decision and the task via observes edges

  Scenario: LLM confirms no contradiction for semantically aligned entities
    Given a confirmed decision "use TypeScript for all backend services"
    And a task "implement auth middleware in TypeScript" linked to the same project
    When the task status transitions to "completed"
    And the observer verification pipeline runs
    Then the LLM reasoning step finds no semantic contradiction
    And an observation is created with severity "info" and verified true
    And the observation text confirms alignment

  Scenario: Deterministic match skips LLM call for cost optimization
    Given a task with a linked commit
    And the commit has passing CI status from GitHub
    And the deterministic verification returns "match" with high confidence
    When the observer verification pipeline runs
    Then the LLM reasoning step is skipped
    And an observation is created using the deterministic verdict
    And no LLM API call is made

  Scenario: LLM call failure falls back to deterministic verdict
    Given a task completion event triggers the observer
    And the LLM service is unavailable
    When the observer verification pipeline runs
    Then the pipeline falls back to the deterministic verdict
    And an observation is created with the deterministic result
    And the observation source indicates "deterministic_fallback"

  Scenario: Low-confidence LLM verdict downgrades to inconclusive
    Given a task completion event with ambiguous relationship to decisions
    When the LLM reasoning step produces a verdict with confidence below threshold
    Then the observation is created with verdict "inconclusive"
    And the severity is "info" rather than "conflict"

  # --- J3: Cross-Signal Pattern Synthesis ---

  Scenario: LLM synthesizes bottleneck pattern from multiple blocked tasks
    Given a workspace with 3 tasks blocked on the same unresolved decision
    When a graph scan runs on the workspace
    Then the LLM synthesis step identifies a "bottleneck_decision" pattern
    And a synthesis observation is created with observation_type "pattern"
    And the observation links to the decision and all 3 blocked tasks
    And the observation text names the bottleneck and suggests resolution

  Scenario: LLM synthesizes cascade block pattern
    Given task A is blocked by task B
    And task B is blocked by task C
    And task C has been blocked for 20 days
    When a graph scan runs
    Then the LLM identifies a "cascade_block" pattern
    And the synthesis observation explains the chain and impact

  Scenario: Synthesis requires minimum 2 contributing signals
    Given a workspace with only 1 stale blocked task
    When a graph scan runs
    Then no synthesis pattern is created for that single anomaly
    And the individual anomaly is still reported as a standard observation

  Scenario: Synthesis deduplicates against existing open patterns
    Given an existing open observation of type "pattern" for "bottleneck_decision" on decision X
    And the same 3 tasks are still blocked on decision X
    When a graph scan runs
    Then no duplicate synthesis observation is created

  Scenario: Graph scan with no anomalies skips LLM entirely
    Given a healthy workspace with no contradictions, stale blockers, or drift
    When a graph scan runs
    Then no LLM synthesis call is made
    And the scan returns an empty result

  # --- J2: Reasoning-Quality Peer Review ---

  Scenario: LLM evaluates reasoning quality of peer observation
    Given agent "pm_agent" created an observation claiming "task X is at risk"
    And the observation cites 2 evidence references in the graph
    When the observer peer review triggers
    Then the LLM evaluates whether the claim follows from the evidence
    And the observer creates a review observation linked to the original

  # --- J4: Contextual Natural Language (implicit in all scenarios) ---
  # Note: All LLM-produced observations inherently satisfy J4 by generating
  # contextual, actionable text rather than template strings.
