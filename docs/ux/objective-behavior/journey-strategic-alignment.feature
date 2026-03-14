Feature: Strategic Alignment Governance
  As an engineering lead managing autonomous agents,
  I want every agent intent traced to a business objective,
  so that organizational waste is prevented and strategic alignment is visible.

  Background:
    Given Elena Vasquez is an engineering lead in workspace "BrainOS"
    And the workspace has project "MCP Platform" with 8 active tasks
    And agent identity "Coder-Alpha" exists with role "code_agent"
    And agent identity "Coder-Beta" exists with role "code_agent"

  # --- Step 2: Create Objectives ---

  Scenario: Create objective via chat conversation
    Given Elena is in a conversation in workspace "BrainOS"
    When Elena sends the message "Our Q2 objective is to launch the MCP marketplace with 10 listed integrations by June 30"
    Then the extraction pipeline creates an objective node with:
      | field             | value                        |
      | title             | Launch MCP Marketplace       |
      | target_date       | 2026-06-30                   |
      | priority          | 90                           |
    And the objective has success_criteria containing "10 listed integrations"
    And the objective has status "active"
    And the objective has an embedding for semantic matching
    And Elena sees confirmation: "Objective created: Launch MCP Marketplace (target: June 30, 2026)"

  Scenario: Create objective with missing target date
    Given Elena is in a conversation in workspace "BrainOS"
    When Elena sends the message "We need to improve infrastructure reliability this quarter"
    Then the extraction pipeline creates an objective node with:
      | field    | value                           |
      | title    | Improve Infrastructure Reliability |
      | priority | 50                              |
    And the objective has no target_date (field omitted)
    And the system prompts Elena: "What is the target date for this objective?"

  Scenario: Reject duplicate objective
    Given objective "Launch MCP Marketplace" already exists with status "active"
    When Elena sends the message "Our goal is to launch the MCP marketplace"
    Then the extraction pipeline detects semantic similarity above 0.95 with existing objective
    And the system responds: "An active objective 'Launch MCP Marketplace' already exists. Would you like to update it?"
    And no duplicate objective is created

  # --- Step 3: Link Intents to Objectives ---

  Scenario: Intent automatically linked to matching objective
    Given objective "Launch MCP Marketplace" exists with status "active" and embedding
    When Coder-Alpha submits intent with goal "Implement MCP tool discovery endpoint"
    Then the Authorizer computes semantic similarity between intent goal and active objectives
    And the similarity score with "Launch MCP Marketplace" is above 0.7
    And a supports edge is created: intent ->supports-> objective "Launch MCP Marketplace"
    And the intent proceeds to authorization evaluation

  Scenario: Intent with no matching objective triggers warning
    Given objective "Launch MCP Marketplace" exists with status "active"
    And no other objectives exist
    When Coder-Beta submits intent with goal "Refactor logging subsystem to use structured logs"
    Then the Authorizer computes semantic similarity and finds no match above 0.5
    And an observation is created with:
      | field    | value                                                    |
      | severity | warning                                                  |
      | text     | Intent has no supporting objective. Potential organizational waste. |
      | category | engineering                                              |
    And the intent is NOT blocked (warning mode)
    And a feed card appears with actions: "Link to Objective", "Dismiss", "Create Objective"

  Scenario: Ambiguous intent matches multiple objectives
    Given objective "Launch MCP Marketplace" exists with status "active"
    And objective "Improve Infrastructure Reliability" exists with status "active"
    When Coder-Alpha submits intent with goal "Add health checks to MCP service endpoints"
    Then the Authorizer finds two objectives with similarity above 0.5
    And the intent is linked to the highest-scoring objective
    And a feed card shows both potential objectives for Elena to confirm or reassign

  # --- Step 4: Manual linking from feed card ---

  Scenario: Elena links unaligned intent to objective from feed card
    Given an alignment warning observation exists for intent "Refactor logging subsystem"
    And the feed card shows closest objective "Improve Infrastructure Reliability" (score: 0.31)
    When Elena clicks "Link to Objective" and selects "Improve Infrastructure Reliability"
    Then a supports edge is created between the intent and the selected objective
    And the alignment warning observation status transitions to "resolved"
    And the feed card updates to show "Linked to: Improve Infrastructure Reliability"

  Scenario: Elena creates new objective from unaligned intent feed card
    Given an alignment warning observation exists for intent "Refactor logging subsystem"
    When Elena clicks "Create Objective" on the feed card
    Then a new objective creation flow begins pre-filled with context from the intent
    And upon completion, the intent is linked to the new objective

  # --- Step 5: Monitor Objective Progress ---

  Scenario: View objective progress with supporting data
    Given objective "Launch MCP Marketplace" has 14 supporting intents in the last 7 days
    And 3 of 10 target integrations are completed
    When Elena navigates to the objective progress view
    Then she sees objective title "Launch MCP Marketplace"
    And target date "June 30, 2026"
    And progress bar showing 34%
    And key result "10 listed integrations: 3/10 (30%)"
    And "14 supporting intents (last 7 days)"
    And "2 unaligned intents flagged"

  Scenario: Objective with no recent activity flagged as stale
    Given objective "Improve Infrastructure Reliability" has 0 supporting intents in the last 14 days
    When the coherence auditor runs
    Then an observation is created with:
      | field    | value                                                          |
      | severity | warning                                                        |
      | text     | Objective has no supporting intents in 14 days. May be stale.  |
    And a feed card appears: "Objective 'Improve Infrastructure Reliability' has no recent activity"

  # --- Step 6: Strategic Alignment Report ---

  Scenario: Generate monthly alignment report
    Given the workspace has 2 active objectives
    And 67 authorized intents in March 2026
    And 47 intents support "Launch MCP Marketplace"
    And 9 intents support "Improve Infrastructure Reliability"
    And 11 intents have no supporting objective
    When Elena requests the alignment report for March 2026
    Then the report shows:
      | objective                       | aligned_compute | intent_count |
      | Launch MCP Marketplace          | 70%             | 47           |
      | Improve Infrastructure Reliability | 13%          | 9            |
      | Unaligned                       | 17%             | 11           |
    And the report categorizes unaligned intents by type
    And the report includes a recommendation for high-volume unaligned categories

  # --- Error Paths ---

  Scenario: No objectives exist when intent is submitted
    Given no objectives exist in workspace "BrainOS"
    When Coder-Alpha submits an intent with goal "Build MCP endpoint"
    Then a feed card appears: "No objectives defined. Agent work is untracked."
    And the feed card includes action: "Create first objective"
    And the intent proceeds without alignment check

  Scenario: Objective target date has passed
    Given objective "Q1 Launch" exists with target_date "2026-03-01" and status "active"
    And today is 2026-03-11
    When the coherence auditor runs
    Then the objective status transitions to "expired"
    And an observation is created: "Objective 'Q1 Launch' target date has passed. Review and retire or extend."
    And Elena sees a feed card prompting action

  @property
  Scenario: Alignment evaluation does not block intent authorization latency
    Given the intent authorization pipeline processes intents
    Then objective alignment evaluation completes within 200ms
    And alignment evaluation never blocks intent execution in warning mode
