Feature: Edit or Deactivate Active Learning
  As a workspace owner who identified a problematic learning,
  I want to edit its text or deactivate it,
  so I can correct agent behavior without disrupting other learnings.

  # Traces to: Job 2 (Correction), Job 3 (Scoping & Targeting)

  Background:
    Given Marcus is logged into workspace "brain-v1"
    And the workspace has the following active learnings:
      | text                                              | type        | priority | agents              | source |
      | Always use TypeScript strict mode                  | constraint  | high     | chat_agent, mcp     | human  |
      | Prefer functional composition over classes         | instruction | medium   | All agents          | agent  |
      | Database migrations must use transactions          | constraint  | high     | mcp                 | human  |

  Scenario: Open edit dialog with pre-populated fields
    Given Marcus has expanded the learning "Always use TypeScript strict mode"
    When Marcus clicks "Edit"
    Then an edit dialog opens
    And the text field contains "Always use TypeScript strict mode"
    And the type selector shows "constraint"
    And the priority selector shows "high"
    And target agents "chat_agent" and "mcp" are checked

  Scenario: Edit learning text and save
    Given Marcus has opened the edit dialog for "Always use TypeScript strict mode"
    When Marcus changes the text to "Always use TypeScript strict mode in all new files. Existing JS files should be migrated incrementally."
    And Marcus clicks "Save Changes"
    Then the learning text is updated in the database
    And a success toast shows "Learning updated successfully"
    And the learning card reflects the new text

  Scenario: Change target agents during edit
    Given Marcus has opened the edit dialog for "Always use TypeScript strict mode"
    When Marcus checks "pm_agent" in the target agents
    And Marcus clicks "Save Changes"
    Then the learning applies to: chat_agent, mcp, pm_agent
    And the card shows the updated agent chips

  Scenario: Change priority during edit
    Given Marcus has opened the edit dialog for "Prefer functional composition over classes"
    When Marcus changes priority from "medium" to "high"
    And Marcus clicks "Save Changes"
    Then the learning priority updates to "high"
    And the card shows the updated priority badge

  Scenario: Cancel edit preserves original
    Given Marcus has opened the edit dialog and made changes
    When Marcus clicks "Cancel"
    Then the dialog closes
    And the learning text and fields remain unchanged

  Scenario: Deactivate learning with confirmation
    Given Marcus has expanded the learning "Prefer functional composition over classes"
    When Marcus clicks "Deactivate"
    Then a confirmation dialog appears
    And the dialog shows: "This learning currently applies to: All agents"
    And the dialog explains: "Deactivating will stop this rule from being injected into agent prompts"
    And the dialog states: "The learning will be preserved and can be reactivated later"

  Scenario: Confirm deactivation
    Given Marcus is viewing the deactivation confirmation for "Prefer functional composition over classes"
    When Marcus clicks "Deactivate" in the dialog
    Then the learning status changes to "deactivated"
    And a success toast shows "Learning deactivated. Agents will no longer follow this rule."
    And the learning disappears from the Active tab
    And the Active tab count decrements by 1
    And the Deactivated tab count increments by 1

  Scenario: Deactivated learning visible in Deactivated tab
    Given Marcus has deactivated "Prefer functional composition over classes"
    When Marcus clicks the "Deactivated" tab
    Then the deactivated learning appears in the list
    And the card shows status "deactivated"
    And the card shows the deactivation date

  Scenario: Cancel deactivation
    Given Marcus is viewing the deactivation confirmation
    When Marcus clicks "Cancel"
    Then the dialog closes
    And the learning remains active
