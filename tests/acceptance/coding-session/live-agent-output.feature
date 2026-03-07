Feature: Live Agent Output Stream
  As an engineering lead observing my coding agent
  I want to see the agent's work appear as streaming text with file change notifications
  So that I can understand what the agent is doing and intervene if needed

  Background:
    Given a workspace with a task assigned to a coding agent

  # --- Happy Path ---

  # US-CS-001 AC: Token events stream into output
  Scenario: Agent token events render as streaming text
    When the agent produces text output
    Then the output appears as streaming text in the session stream

  # US-CS-001 AC: File change events as inline notifications
  Scenario: File change events appear as inline notifications
    When the agent modifies a file "src/auth.ts"
    Then a file change notification appears in the session stream
    And the notification identifies the changed file

  # US-CS-001 AC: Status badge updates in real-time
  Scenario: Session status transitions are streamed to the user
    When the agent transitions from working to idle
    Then a status change event appears in the session stream
    And the new status is reflected in the session details

  # US-CS-001 AC: Files changed count updates
  Scenario: Files changed count increases as agent edits files
    When the agent modifies "src/login.ts"
    And the agent creates "src/validators.ts"
    Then the session reports 2 files changed

  # --- Error Paths ---

  # US-CS-001 AC: Stall warning after 30 seconds
  Scenario: Stall warning appears after 30 seconds of inactivity
    Given the agent has been silent for 30 seconds
    When the stall timeout elapses
    Then a stall warning is emitted to the session stream

  # Edge: stream interrupted
  Scenario: Session stream handles disconnection gracefully
    Given Marcus is observing the agent output stream
    When the stream connection is interrupted
    Then reconnecting shows the session's current status

  # Edge: rapid events
  @property
  Scenario: Event ordering is preserved regardless of arrival rate
    Given any sequence of agent events
    When the events are processed through the event bridge
    Then they arrive at the client in the same order they were produced
