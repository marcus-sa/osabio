Feature: Event Stream Wiring
  As an engineering lead
  I want agent events to flow from the coding agent through the server to my browser
  So that I can observe the agent's work in real-time without polling

  Background:
    Given a workspace with a task assigned to a coding agent

  # --- Happy Path ---

  # US-CS-003 AC: Event iteration starts after spawn
  Scenario: Agent events flow through to the session event stream
    When the agent produces activity events
    Then the events appear in the session's live stream

  # US-CS-003 AC: Session becomes active after first event
  Scenario: Session transitions to active after first agent event
    Given the session status is "spawning"
    When the first agent event arrives
    Then the session status transitions to "active"

  # US-CS-003 AC: Stall detector starts after event bridge wired
  Scenario: Stall monitoring begins after agent session starts
    When the event stream is wired to the session
    Then stall detection monitoring is active for the session

  # --- Error Paths ---

  # US-CS-003 AC: Event stream errors update session status
  Scenario: Event stream error updates session to error status
    When the agent's event stream encounters an error
    Then the session status changes to "error"
    And an error event is emitted to the live stream

  # US-CS-003 AC: Event iteration stops on terminal status
  Scenario: Event iteration stops when session reaches terminal status
    When the session is completed
    Then no further events are processed from the agent stream

  Scenario: Event iteration stops when session is aborted
    When the session is aborted by the user
    Then no further events are processed from the agent stream

  # Edge case: stream subscription for invalid session
  Scenario: Subscribing to a nonexistent session stream fails
    Given a stream identifier that does not correspond to any session
    When a user tries to subscribe to that stream
    Then the subscription is rejected because no matching session exists
