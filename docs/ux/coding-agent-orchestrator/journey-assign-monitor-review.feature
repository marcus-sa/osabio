Feature: Coding Agent Orchestrator
  As an engineering lead using Brain
  I want to assign engineering tasks to a coding agent
  So that routine coding work gets done while I focus on higher-value activities

  Background:
    Given a workspace with an active project
    And an opencode server is running and reachable
    And the Brain MCP server is configured in opencode

  # Job 1: Assign Task to Coding Agent

  Scenario: Assign a ready task to a coding agent
    Given a task exists with status "ready" and a description
    And the task belongs to a project
    When I click "Assign to Agent" on the task card
    Then an opencode session is created
    And the task context is injected into the session via MCP
    And the task prompt is sent to the agent
    And the task status changes to "in_progress"
    And an agent_session record is created linking to the task

  Scenario: Cannot assign a task without sufficient context
    Given a task exists with status "ready" but no description
    When I click "Assign to Agent" on the task card
    Then I see a message "Task needs a description before agent assignment"
    And no opencode session is created
    And the task status remains "ready"

  Scenario: OpenCode server is unreachable
    Given a task exists with status "ready" and a description
    And the opencode server is not reachable
    When I click "Assign to Agent" on the task card
    Then I see an error "Cannot connect to coding agent server"
    And the task status remains "ready"

  # Job 2: Monitor Agent Progress

  Scenario: View real-time agent activity
    Given a task is assigned to a coding agent
    And the agent is actively working
    When I view the task detail page
    Then I see a live activity feed
    And the feed shows key events: file changes, tool calls, status updates
    And new events appear without page refresh

  Scenario: Agent encounters a blocker
    Given a task is assigned to a coding agent
    When the agent cannot proceed due to missing information
    Then the agent creates an observation with severity "warning"
    And the task status changes to "blocked"
    And I see a notification that the agent is blocked
    And the observation appears in the task activity feed

  # Job 3: Review and Accept Agent Output

  Scenario: Review completed agent work
    Given a task was assigned to a coding agent
    And the agent has completed its work
    When I view the task detail page
    Then I see the git diff of files changed
    And I see the agent session trace showing reasoning and tool calls
    And I see any observations the agent created during work

  Scenario: Accept agent output
    Given a task has completed agent work ready for review
    When I click "Accept" on the review
    Then the task status changes to "done"
    And the agent_session is marked as completed

  Scenario: Reject agent output and send feedback
    Given a task has completed agent work ready for review
    When I click "Request Changes" and provide feedback
    Then the feedback is sent as a follow-up prompt to the opencode session
    And the task status changes back to "in_progress"
    And the agent resumes work with the feedback context
