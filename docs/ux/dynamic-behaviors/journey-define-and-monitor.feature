Feature: Define and Monitor Behavioral Standards
  As Elena Vasquez, a workspace admin who wants to measure agent alignment
  with team values like evidence-based reasoning,
  I need to create behavior definitions in plain language, activate them,
  and review real-time scores so I can shape agent culture without writing code.

  # Jobs served: Job 1 (Define Standards), Job 2 (Real-time Auditing)

  Background:
    Given Elena Vasquez is a workspace admin for workspace "Acme AI Team"
    And the workspace has 3 coding agents and 1 design agent
    And 2 deterministic behavior definitions exist: "TDD Adherence" and "Security First"

  # --- Step 1: Browse Behavior Library ---

  Scenario: Browse existing definitions and community templates
    Given 4 community behavior definition templates are available system-wide
    When Elena navigates to the Behavior Library page
    Then she sees 2 active definitions in the "Your Definitions" section
    And each definition card shows the title, scoring mode, average score, and trend indicator
    And she sees 4 community templates in the "Community Templates" section
    And each template card shows a description and a "Use Template" button

  Scenario: Empty state for first-time workspace
    Given Elena's workspace has no behavior definitions
    When Elena navigates to the Behavior Library page
    Then she sees a message: "No behavior definitions yet. Define what good agent behavior looks like."
    And she sees a "Create Your First Definition" button
    And she sees community templates as starting points

  # --- Step 2: Create Behavior Definition ---

  Scenario: Create a definition from a community template
    Given Elena is on the Behavior Library page
    When she clicks "Use Template" on the "Evidence-Based Reasoning" template
    Then the definition form opens with pre-filled goal and scoring logic from the template
    And the title field contains "Evidence-Based Reasoning"
    And the scoring mode is set to "LLM-scored"
    And the telemetry type checkboxes show the template's defaults

  Scenario: Customize and save a definition as draft
    Given Elena has the definition form open with the "Evidence-Based Reasoning" template
    When she edits the scoring logic to read:
      """
      Score 0.9-1.0: Every claim has a specific citation
      Score 0.6-0.8: Most claims cited, minor gaps
      Score 0.3-0.5: Some claims unsupported
      Score 0.0-0.2: Fabricated claims or no evidence provided
      """
    And she selects telemetry types: chat_response, decision_proposal, observation_creation
    Then the validation preview shows "Definition parsed successfully"
    And the preview shows "4 levels detected"
    And the preview lists the selected telemetry types
    When she clicks "Save as Draft"
    Then the definition appears in her library with status "Draft"
    And the definition is not yet evaluated against any agent actions

  Scenario: Validation warns on ambiguous goal
    Given Elena is creating a new behavior definition
    When she enters the goal: "Agents should be good"
    Then the validation preview shows a warning:
      """
      Goal is too broad for consistent scoring.
      Consider specifying what "good" means with concrete examples.
      """
    And the "Activate" button is disabled until the warning is addressed

  Scenario: Conflict detection with existing definition
    Given Elena's workspace has an active definition "Documentation Quality" scoring chat_response events
    When Elena creates a new definition "Evidence-Based Reasoning" also scoring chat_response events
    Then a conflict notice appears identifying overlap with "Documentation Quality"
    And the notice explains both definitions will score the same telemetry type
    And Elena can choose to proceed, edit to differentiate, or cancel

  # --- Step 3: Activate Definition ---

  Scenario: Activate a draft definition
    Given Elena has a draft definition "Evidence-Based Reasoning"
    When she clicks "Activate"
    Then a confirmation dialog appears with the message:
      """
      Once active, the Scorer Agent will evaluate matching telemetry events
      against this definition. Scores will appear within minutes of the next agent action.
      """
    And the dialog shows enforcement mode: "Scoring only (no automatic restrictions)"
    When Elena confirms activation
    Then the definition status changes to "Active"
    And the Scorer Agent begins matching new telemetry events to this definition

  Scenario: Cannot activate a definition with validation warnings
    Given Elena has a draft definition with an unresolved validation warning
    When she attempts to activate the definition
    Then the system prevents activation
    And displays the unresolved warnings with guidance on how to fix them

  # --- Step 4: Review Scores ---

  Scenario: View scores after initial scoring period
    Given the "Evidence-Based Reasoning" definition has been active for 1 hour
    And coding-agent-alpha produced a chat_response scored 0.62
    And coding-agent-beta produced a decision_proposal scored 0.85
    And design-agent produced an observation_creation scored 0.81
    When Elena opens the "Evidence-Based Reasoning" detail page
    Then she sees a score timeline chart with 3 data points
    And she sees the average score is 0.76
    And each score entry shows: acting identity, action type, score, and timestamp

  Scenario: View scoring rationale
    Given Elena is viewing the "Evidence-Based Reasoning" scores
    When she clicks "Details" on the entry for coding-agent-alpha (score 0.62)
    Then she sees the Scorer Agent's rationale:
      """
      Agent recommended tRPC migration but cited only one supporting decision node.
      Two claims about performance gains lacked specific benchmarks or references.
      """
    And the rationale references the specific telemetry event that was scored

  Scenario: No scores after 24 hours
    Given the "Evidence-Based Reasoning" definition has been active for 24 hours
    And no agent actions matched the selected telemetry types
    When Elena views the definition detail page
    Then she sees a notice:
      """
      No matching telemetry events in 24 hours.
      Check: are the selected telemetry types correct?
      """
    And the notice shows recent workspace activity by telemetry type

  # --- Step 5: Adjust Definition ---

  Scenario: Edit scoring logic of an active definition
    Given the "Evidence-Based Reasoning" definition is active with 3 existing scores
    When Elena opens the edit form
    And changes the top-tier scoring logic from "every claim" to "key claims"
    Then a change summary highlights the modifications
    And a notice states: "Existing scores are preserved. New scoring uses the updated definition."
    When Elena saves the changes
    Then the definition version increments from 1 to 2
    And subsequent telemetry events are scored against version 2

  Scenario: Scorer Agent failure during scoring
    Given the "Evidence-Based Reasoning" definition is active
    And coding-agent-alpha produces a chat_response
    And the Scorer Agent times out after 30 seconds
    When Elena views the definition detail page
    Then she sees a notice for the failed scoring event:
      """
      Scoring failed at 14:22 (coding-agent-alpha, chat_response)
      Reason: Scorer Agent timeout
      Action: Event queued for retry
      """
    And the agent's existing scores and capabilities are not affected
