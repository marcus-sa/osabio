Feature: Follow-Up Prompt to Running Agent
  As an engineering lead supervising a coding agent
  I want to send additional instructions to the agent while it is working
  So that I can steer the agent's work without aborting and restarting

  Background:
    Given a workspace with a task assigned to a coding agent

  # --- Happy Path ---

  # US-CS-002 AC: Submitting prompt delivers via POST (202)
  Scenario: Marcus sends a follow-up prompt to a working agent
    Given the agent session is active
    When Marcus sends the prompt "Please also add input validation for email"
    Then the prompt is accepted
    And the agent receives the instruction

  # US-CS-002 AC: Sending to idle session transitions to active
  Scenario: Marcus sends a prompt to an idle agent
    Given the agent session is idle
    When Marcus sends the prompt "Continue with the error handling"
    Then the prompt is accepted
    And the session transitions back to active

  # US-CS-002 AC: User messages appear as distinct blocks
  Scenario: User prompt appears as a distinct entry in the event stream
    When Marcus sends the prompt "Add unit tests for the parser"
    Then a user prompt event appears in the session stream
    And the event contains the prompt text "Add unit tests for the parser"

  # --- Error Paths ---

  # US-CS-002 AC: Input disabled for completed session
  Scenario: Prompt rejected for a completed session
    Given the agent session has completed
    When Marcus tries to send the prompt "Add more tests"
    Then the prompt is rejected because the session has ended

  # US-CS-002 AC: Input disabled for aborted session
  Scenario: Prompt rejected for an aborted session
    Given the agent session was aborted
    When Marcus tries to send the prompt "Fix the bug"
    Then the prompt is rejected because the session has ended

  # US-CS-002 AC: Input disabled for error session
  Scenario: Prompt rejected for a session in error state
    Given the agent session encountered an error
    When Marcus tries to send the prompt "Try again"
    Then the prompt is rejected because the session has ended

  # Edge: empty prompt
  Scenario: Empty prompt text is rejected
    Given the agent session is active
    When Marcus sends an empty prompt
    Then the prompt is rejected because feedback text is required

  # Edge: prompt to nonexistent session
  Scenario: Prompt to nonexistent session fails
    When Marcus sends a prompt to a session that does not exist
    Then the prompt is rejected because the session was not found

  # US-CS-002 AC: Prompt delivery fails when handle missing
  Scenario: Prompt fails gracefully when agent handle is missing
    Given the agent session exists but the server has lost the process handle
    When Marcus sends the prompt "Please continue"
    Then the prompt is rejected because the agent is unreachable
