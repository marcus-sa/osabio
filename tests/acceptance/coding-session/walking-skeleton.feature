Feature: Live Coding Session
  As an engineering lead using Brain
  I want to observe my coding agent working in real-time, send follow-up instructions, and review its conversation log
  So that I can supervise agent work interactively without switching to a terminal

  Background:
    Given a workspace with a project and a task ready for work

  # US-CS-003 + US-CS-001 + US-CS-002
  @walking_skeleton
  Scenario: Marcus assigns a task, observes agent output, and sends a follow-up prompt
    When Marcus assigns the task to a coding agent
    Then the agent session starts and events begin streaming

    When Marcus opens the live output for the session
    Then agent activity appears as streaming text

    When Marcus sends a follow-up prompt "Please also add input validation"
    Then the prompt is accepted and the agent continues working

  # US-CS-003 + US-CS-004
  @walking_skeleton
  Scenario: Marcus reviews the agent conversation log after work completes
    Given Marcus has a task assigned to a coding agent
    And the agent has completed its work

    When Marcus opens the review for the completed session
    Then the review includes the agent conversation log
    And the log shows the chronological trail of agent activity

  # US-CS-001 + US-CS-003 (error path)
  @walking_skeleton
  Scenario: Agent error stops the session and notifies Marcus
    Given Marcus has a task assigned to a coding agent

    When the agent encounters an error during its work
    Then the session status shows an error occurred
    And Marcus is notified of the failure through the event stream
