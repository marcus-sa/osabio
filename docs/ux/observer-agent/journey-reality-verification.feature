Feature: Reality Verification
  As the Observer Agent
  I verify that agent-claimed state transitions match external reality
  So the knowledge graph reflects verified truth, not ungrounded claims

  Background:
    Given a workspace with the Observer Agent enabled
    And the workspace has a GitHub integration configured

  # --- Job 1: Reality Verification ---

  Scenario: Task completion verified by passing CI
    Given a task "Implement rate limiting" linked to PR #42
    And PR #42 has a passing CI status on GitHub
    When the task status transitions to "completed"
    Then a SurrealDB EVENT fires an ASYNC webhook to the Observer endpoint
    And the Observer queries GitHub CI status for PR #42
    And the Observer creates an observation with:
      | field            | value                                          |
      | severity         | info                                           |
      | observation_type | validation                                     |
      | verified         | true                                           |
      | source           | GitHub CI                                      |
      | text             | Verified: task completion confirmed by passing CI |
    And the observation is linked to the task via an "observes" edge

  Scenario: Task completion contradicted by failing CI
    Given a task "Implement rate limiting" linked to PR #42
    And PR #42 has a failing CI status on GitHub
    When the task status transitions to "completed"
    Then the Observer queries GitHub CI status for PR #42
    And the Observer creates an observation with:
      | field            | value                                                    |
      | severity         | conflict                                                 |
      | observation_type | contradiction                                            |
      | verified         | false                                                    |
      | source           | GitHub CI                                                |
      | text             | Reality mismatch: task claimed completed but CI is failing |
    And the observation is linked to the task via an "observes" edge
    And the observation surfaces in the governance feed as a "review" tier item

  Scenario: Commit verified by GitHub checks
    Given a git_commit record is created with SHA "abc123" linked to task "Implement rate limiting"
    And SHA "abc123" has all GitHub checks passing
    When the SurrealDB EVENT fires
    Then the Observer queries GitHub commit status API for SHA "abc123"
    And the Observer creates an observation with:
      | field            | value                                                |
      | severity         | info                                                 |
      | observation_type | validation                                           |
      | verified         | true                                                 |
      | source           | GitHub Checks                                        |
      | text             | Verified: commit abc123 has all checks passing        |
    And the observation is linked to the task via an "observes" edge

  Scenario: Commit with failing checks
    Given a git_commit record is created with SHA "def456" linked to task "Add auth middleware"
    And SHA "def456" has failing GitHub checks
    When the SurrealDB EVENT fires
    Then the Observer creates an observation with:
      | field            | value                                                    |
      | severity         | conflict                                                 |
      | observation_type | contradiction                                            |
      | verified         | false                                                    |
      | source           | GitHub Checks                                            |
      | text             | Reality mismatch: commit def456 has failing checks        |
    And the observation is linked to the task via an "observes" edge

  Scenario: Intent completion verified by action outcome
    Given an intent to "deploy service to staging" with action_spec provider "Vercel"
    When the intent status transitions to "completed"
    Then the Observer queries the deployment status from the action provider
    And creates a verified observation if the deployment is healthy
    Or creates a conflict observation if the deployment failed

  Scenario: External API unreachable during verification
    Given a task linked to PR #42
    And the GitHub API is unreachable
    When the task status transitions to "completed"
    Then the Observer creates an observation with:
      | field            | value                                              |
      | severity         | warning                                            |
      | observation_type | error                                              |
      | source           | Observer Agent                                     |
      | text             | Verification skipped: GitHub API unreachable        |
    And the task status is NOT blocked — it proceeds as completed

  Scenario: No external signal source configured
    Given a task with no linked PR or external integration
    When the task status transitions to "completed"
    Then the Observer creates an observation with:
      | field            | value                                                |
      | severity         | info                                                 |
      | observation_type | missing                                              |
      | text             | No verification source configured for this task       |
    And the task proceeds normally

  # --- Job 2: Cross-Agent Peer Review ---

  Scenario: Observer detects contradiction between decision and implementation
    Given a confirmed decision "Standardize on tRPC for all APIs"
    And a task "Implement billing API" completed with REST endpoints
    When the Observer runs a periodic graph scan
    Then the Observer creates an observation with:
      | field            | value                                                         |
      | severity         | conflict                                                      |
      | observation_type | contradiction                                                 |
      | source           | Observer Agent (graph scan)                                   |
      | text             | Billing API uses REST but decision requires tRPC              |
    And the observation is linked to both the decision and the task via "observes" edges

  Scenario: Observer flags stale task blocked longer than threshold
    Given a task "Setup monitoring" in "blocked" status for 14 days
    When the Observer runs a periodic graph scan
    Then the Observer creates an observation with:
      | field            | value                                              |
      | severity         | warning                                            |
      | observation_type | anomaly                                            |
      | text             | Task blocked for 14 days with no status update      |
    And the observation is linked to the task via an "observes" edge

  # --- Decision & Observation Peer Review (Event-Triggered) ---

  Scenario: Decision confirmed — Observer verifies implementation alignment
    Given a decision "Standardize on tRPC for all APIs" transitions to "confirmed"
    When the SurrealDB EVENT fires
    Then the Observer loads all tasks in the decision's project
    And checks whether completed tasks contradict the decision
    And creates a conflict observation for each drifting task
    Or creates an info observation if all implementations align

  Scenario: Decision superseded — Observer flags stale implementations
    Given a decision "Use MongoDB" is superseded by "Use SurrealDB"
    When the SurrealDB EVENT fires
    Then the Observer identifies tasks still referencing the old decision
    And creates warning observations for each affected task

  Scenario: PM agent observation peer-reviewed by Observer
    Given the PM agent creates an observation "Feature X has no assigned tasks"
    When the SurrealDB EVENT fires (source_agent != "observer_agent")
    Then the Observer loads Feature X and its task relationships
    And verifies the claim against the graph
    And creates a peer-review observation with:
      | field    | value                                                    |
      | verified | true (if no tasks found) or false (if tasks exist)       |
      | source   | Observer Agent (peer review)                             |
    And links the peer-review observation to the original via "observes" edge

  Scenario: Observer observation does NOT trigger peer review loop
    Given the Observer agent creates an observation
    Then the observation_peer_review EVENT does NOT fire
    And no infinite observation chain is created
