Feature: Browse & Filter Learning Library
  As a workspace owner managing multiple AI agents,
  I want to browse all learnings with filtering,
  so I can understand what rules govern agent behavior.

  # Traces to: Job 1 (Visibility & Audit), Job 4 (Triage entry point)

  Background:
    Given Marcus is logged into workspace "brain-v1"
    And the workspace has the following learnings:
      | text                                              | type        | status           | priority | agents              | source  |
      | Always use TypeScript strict mode                  | constraint  | active           | high     | chat_agent, mcp     | human   |
      | Prefer functional composition over classes         | instruction | active           | medium   | All agents          | agent   |
      | Database migrations must use transactions          | constraint  | active           | high     | mcp                 | human   |
      | Avoid module-level mutable singletons              | instruction | pending_approval | medium   | mcp                 | agent   |
      | Use RecordId objects not string IDs                 | constraint  | pending_approval | high     | mcp, chat_agent     | agent   |
      | Log all errors with structured context             | instruction | pending_approval | medium   | All agents          | agent   |
      | Always return 404 for missing entities             | precedent   | dismissed        | low      | chat_agent          | agent   |

  Scenario: Navigate to learning library from sidebar
    When Marcus clicks "Learnings" in the sidebar
    Then the learning library page loads at route "/learnings"
    And the Active tab is selected by default
    And tab counts are displayed: Active (3), Pending (3), Dismissed (1), Deactivated (0)

  Scenario: Browse active learnings with card metadata
    Given Marcus is on the learning library page
    When the Active tab is selected
    Then 3 learning cards are displayed
    And each card shows the learning text as a preview
    And each card shows a type badge ("constraint" or "instruction")
    And each card shows priority level
    And each card shows target agent chips (or "All agents")
    And each card shows the source ("human" or agent name)

  Scenario: Filter active learnings by type
    Given Marcus is viewing 3 active learnings
    When Marcus selects "constraint" from the Type filter
    Then 2 learning cards are displayed
    And both cards show type "constraint"

  Scenario: Filter active learnings by target agent
    Given Marcus is viewing 3 active learnings
    When Marcus selects "mcp" from the Agent filter
    Then 2 learning cards are displayed
    And all shown learnings include "mcp" in their target agents

  Scenario: Combine multiple filters
    Given Marcus is viewing 3 active learnings
    When Marcus selects "constraint" from the Type filter
    And Marcus selects "mcp" from the Agent filter
    Then the filtered results show learnings matching both criteria
    And the URL query parameters reflect the active filters

  Scenario: Clear filters returns to full list
    Given Marcus has active filters (type: "constraint", agent: "mcp")
    When Marcus clears all filters
    Then all 3 active learnings are displayed
    And filter dropdowns reset to "All"

  Scenario: Expand learning card for detail
    Given Marcus is viewing active learnings
    When Marcus clicks the card "Always use TypeScript strict mode"
    Then the card expands inline to show full detail
    And the detail shows: full text, type, priority, status, source, created date
    And the detail shows target agents: "chat_agent, mcp"
    And action buttons are visible: Edit, Deactivate

  Scenario: Switch to pending tab
    Given Marcus is on the Active tab
    When Marcus clicks the "Pending (3)" tab
    Then 3 pending learning cards are displayed
    And each pending card shows the suggesting agent name
    And each pending card shows the pattern confidence score
    And each pending card has Approve and Dismiss buttons

  Scenario: Empty state for new workspace
    Given a workspace "fresh-start" with no learnings
    When Marcus navigates to the learning library
    Then an empty state is displayed with explanation text
    And a "Create your first learning" call-to-action button is shown
    And the explanation describes what learnings are and how they work

  Scenario: Keyboard accessibility
    Given Marcus navigates with keyboard only
    When Marcus tabs through the learning library
    Then all tabs, filters, cards, and action buttons are reachable via keyboard
    And focus indicators are visible on each interactive element
