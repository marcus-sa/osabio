Feature: Inline Pending Actions in Learning Library
  As a workspace owner browsing the learning library,
  I want to approve or dismiss pending learnings without leaving the library,
  so I can triage in context alongside active and dismissed learnings.

  # Traces to: Job 4 (Approval & Triage), Job 1 (Visibility & Audit)
  # Design decision: Feed = push notification layer, Library = pull management layer.
  # Both share approve/dismiss dialog components and API endpoints.

  Background:
    Given Marcus is logged into workspace "brain-v1"
    And the workspace has the following learnings:
      | text                                              | status           | type        | suggested_by    | confidence |
      | Always use RecordId objects from surrealdb SDK     | active           | constraint  | -               | -          |
      | Avoid module-level mutable singletons for caching | pending_approval | instruction | observer_agent  | 0.87       |
      | Use snake_case for database field names            | active           | instruction | -               | -          |

  Scenario: Pending cards show inline action buttons
    Given Marcus navigates to the learning library
    When the unfiltered list is displayed
    Then the pending learning card shows "Approve" and "Dismiss" buttons
    And the pending card shows suggesting agent "observer_agent"
    And the pending card shows confidence "87%"
    And active learning cards do NOT show "Approve" or "Dismiss" buttons

  Scenario: Approve pending learning from library
    Given Marcus is viewing the learning library
    When Marcus clicks "Approve" on "Avoid module-level mutable singletons for caching"
    And the approve dialog opens with editable text
    And Marcus clicks "Approve as Active" without editing
    Then the learning status changes to "active"
    And a success toast shows "Learning approved and activated"
    And the card's status badge updates to "active" in place
    And the "Approve" and "Dismiss" buttons are removed from the card

  Scenario: Approve with text edit from library
    Given Marcus opens the approve dialog for "Avoid module-level mutable singletons for caching"
    When Marcus edits the text to "Avoid module-level mutable singletons for caching — use dependency injection instead"
    And Marcus clicks "Approve as Active"
    Then the learning is saved with the edited text
    And the card displays the updated text

  Scenario: Collision warning during library approval
    Given there is an active learning "Do NOT use module-level mutable singletons for caching or shared state"
    And Marcus clicks "Approve" on "Avoid module-level mutable singletons for caching"
    Then the approve dialog shows a collision warning
    And the warning displays the similar active learning text
    And the warning shows the similarity percentage
    And Marcus can choose to approve anyway or cancel

  Scenario: Dismiss pending learning from library with reason
    Given Marcus clicks "Dismiss" on "Avoid module-level mutable singletons for caching"
    Then a dismiss dialog opens with a required reason field
    And the "Dismiss" button is disabled until a reason is entered
    When Marcus enters reason "Already covered by CLAUDE.md guidelines"
    And Marcus clicks "Dismiss"
    Then the learning status changes to "dismissed"
    And a success toast shows "Learning dismissed"
    And the reason is stored with the learning record

  Scenario: Cancel dialog returns to library unchanged
    Given Marcus has opened the approve dialog for a pending learning
    When Marcus clicks "Cancel"
    Then the dialog closes
    And the learning remains in "pending_approval" status
    And no changes are made to the card
