Feature: Create Learning with Agent Targeting
  As a workspace owner who wants to codify rules for agent behavior,
  I want to create a learning with precise agent targeting,
  so I can teach specific agents without affecting others unnecessarily.

  # Traces to: Job 3 (Scoping & Targeting), Job 1 (Visibility)

  Background:
    Given Marcus is logged into workspace "brain-v1"
    And the workspace has the following active learnings:
      | text                                              | type        | priority | agents          |
      | Always use TypeScript strict mode                  | constraint  | high     | chat_agent, mcp |

  Scenario: Open create dialog from library
    Given Marcus is on the learning library page
    When Marcus clicks the "+ New" button
    Then a create learning dialog opens
    And the text field is empty
    And the text field shows placeholder: "e.g., Always validate user input before processing"
    And no learning type is pre-selected
    And priority is defaulted to "medium"
    And "All agents" is selected for targeting

  Scenario: Create learning with all-agents targeting
    Given Marcus has opened the create dialog
    When Marcus enters text "Never use `any` type in TypeScript. Use `unknown` for truly unknown types."
    And Marcus selects type "instruction"
    And Marcus leaves targeting as "All agents"
    And Marcus clicks "Create Learning"
    Then the learning is created with target_agents as empty array (meaning all agents)
    And a success toast shows "Learning created and activated"
    And the learning appears in the Active tab with "All agents" badge

  Scenario: Create learning with specific agent targeting
    Given Marcus has opened the create dialog
    When Marcus enters text "Always include task ID in commit messages"
    And Marcus selects type "constraint"
    And Marcus sets priority to "high"
    And Marcus selects "Specific agents" and checks "mcp"
    And Marcus clicks "Create Learning"
    Then the learning is created with target_agents ["mcp"]
    And the learning card shows agent chip "mcp"

  Scenario: Create learning targeting multiple specific agents
    Given Marcus has opened the create dialog
    When Marcus enters text "Explain reasoning before presenting conclusions"
    And Marcus selects type "instruction"
    And Marcus selects "Specific agents"
    And Marcus checks "chat_agent" and "pm_agent"
    And Marcus clicks "Create Learning"
    Then the learning is created with target_agents ["chat_agent", "pm_agent"]
    And the card shows chips for both agents

  Scenario: Collision detected on creation
    Given Marcus has opened the create dialog
    When Marcus enters text "Use TypeScript strict mode always"
    And Marcus selects type "constraint"
    And Marcus clicks "Create Learning"
    Then a collision warning appears
    And the warning shows existing learning: "Always use TypeScript strict mode" (similarity: 89%)
    And Marcus sees options: "Go Back and Edit" and "Create Anyway"

  Scenario: Proceed despite collision
    Given Marcus sees a collision warning for a new learning
    When Marcus clicks "Create Anyway"
    Then the learning is created as active
    And the collision is logged but does not block creation

  Scenario: Go back to edit after collision warning
    Given Marcus sees a collision warning for a new learning
    When Marcus clicks "Go Back and Edit"
    Then the create dialog reappears with the previously entered text
    And Marcus can modify the text to differentiate from the existing learning

  Scenario: Form validation prevents empty submission
    Given Marcus has opened the create dialog
    When no text is entered
    Or no type is selected
    Then the "Create Learning" button remains disabled

  Scenario: Type descriptions help user choose
    Given Marcus has opened the create dialog
    Then each type option shows a description:
      | type        | description                                        |
      | constraint  | A hard rule agents must always follow              |
      | instruction | Guidance for how agents should approach work       |
      | precedent   | A pattern established by previous decisions        |
