Feature: Interactive Coding Session
  As a solo founder delegating coding to AI agents,
  I want to assign tasks, watch the agent work, guide it with prompts, and review its output,
  so I can multiply my development throughput while maintaining code quality.

  # Job 1: Delegate Coding Work with Confidence

  Scenario: Marcus assigns an agent to a ready task
    Given Marcus is viewing task "Add pagination to entity search" with status "ready"
    And workspace "Richmond" has repo path "/Users/marcus/conductor/workspaces/brain/richmond"
    When Marcus clicks "Assign Agent"
    Then the system creates a worktree branch "agent/add-pagination-to-entity-search"
    And the system spawns an OpenCode agent session
    And the agent status section transitions to "Spawning..."
    And an "Abort" button becomes available

  Scenario: Agent starts and live output begins streaming
    Given Marcus has assigned an agent to task "Add pagination to entity search"
    And the OpenCode server has started successfully
    When the agent sends its first response
    Then the status badge transitions from "Spawning" to "Working"
    And the agent output panel appears showing streaming text
    And a "Send Message" input appears below the output
    And Marcus sees the agent's first action within 5 seconds of assignment

  Scenario: Spawn fails and system rolls back cleanly
    Given Marcus has clicked "Assign Agent" on task "Add pagination to entity search"
    When the OpenCode server fails to start within 15 seconds
    Then the worktree "agent/add-pagination-to-entity-search" is removed
    And the agent session record is deleted from the database
    And the task status returns to "ready"
    And an error message shows "Agent failed to start. Please try again."
    And the "Assign Agent" button becomes available again

  Scenario: Assignment blocked when repo path is not configured
    Given Marcus is viewing task "Add pagination to entity search" with status "ready"
    And workspace "Richmond" does not have a repo path configured
    When Marcus views the agent status section
    Then a banner shows "Repository path is not configured for this workspace"
    And an inline form allows setting the repo path
    And the "Assign Agent" button is disabled until the repo path is set

  Scenario: Assignment blocked when another session is active
    Given Marcus has an active agent session on task "Fix login redirect"
    When Marcus tries to assign an agent to task "Add pagination to entity search"
    Then the system returns an error "Agent already active on another task"
    And the "Assign Agent" button re-enables

  # Job 1: Live Monitoring

  Scenario: Marcus watches the agent read files and make changes
    Given Marcus has an active agent session on task "Add pagination to entity search"
    When the agent reads "entity-search-route.ts" and begins editing
    Then the output shows "Reading entity-search-route.ts..."
    And when the agent saves the file, an inline notification shows "entity-search-route.ts modified"
    And the "files changed" count in the status bar increments to 1

  Scenario: Agent output auto-scrolls during active streaming
    Given Marcus is watching the agent output stream
    And the output has accumulated more content than the visible area
    When the agent produces new output
    Then the panel auto-scrolls to show the latest content
    And Marcus can scroll up to review earlier output without disrupting the stream

  Scenario: Stall detection warns Marcus when agent stops responding
    Given Marcus has an active agent session that has been working for 3 minutes
    When no events are received for 30 seconds
    Then a warning appears "Agent may be stalled (no activity for 30s)"
    And the "Abort" button remains available

  # Job 2: Course-Correct a Working Agent

  Scenario: Marcus redirects the agent mid-task
    Given Marcus is watching the agent work on task "Add pagination to entity search"
    And the agent output shows "I'll create a new pagination helper function in utils/pagination.ts"
    When Marcus types "Use the existing paginate() function from app/src/shared/query-helpers.ts instead" in the message input
    And clicks "Send"
    Then Marcus's message appears in the output as a visually distinct user message
    And the input field clears and re-enables
    And the agent responds acknowledging the guidance
    And the agent continues working with the corrected approach

  Scenario: Marcus provides additional instructions to an idle agent
    Given the agent session on task "Add pagination to entity search" has status "idle"
    And the message input is still available
    When Marcus types "Also add cursor-based pagination as an alternative to offset pagination"
    And clicks "Send"
    Then the session status transitions from "idle" to "active"
    And the agent begins working on the additional request
    And the agent output continues streaming in the same panel

  Scenario: Follow-up prompt is rejected for a completed session
    Given the agent session has status "completed"
    When Marcus views the session panel
    Then the message input is disabled
    And a note explains "Session has ended. Review the changes or start a new session."

  Scenario: Follow-up prompt is rejected for an aborted session
    Given the agent session has status "aborted"
    When Marcus views the session panel
    Then the message input is disabled
    And a note explains "Session was aborted."

  # Job 3: Review and Accept Agent Work

  Scenario: Marcus reviews the diff with full context
    Given the agent has completed work on task "Add pagination to entity search"
    And the agent modified "entity-search-route.ts" (+12 -3), "use-entity-search.ts" (+8 -2), and "contracts.ts" (+4 -0)
    When Marcus clicks "Review" in the agent status section
    Then the review page shows the task title "Add pagination to entity search"
    And the Diff tab shows a unified diff for each modified file
    And the Agent Log tab shows the full conversation including Marcus's course correction
    And the session header shows "3 files changed" and the session duration

  Scenario: Marcus accepts the agent's changes
    Given Marcus is on the review page for task "Add pagination to entity search"
    And the changes look correct
    When Marcus clicks "Accept"
    Then the task status changes to "done"
    And the session status changes to "completed"
    And a confirmation shows "Changes accepted. Task marked as done."
    And the worktree branch is preserved for merge

  Scenario: Marcus rejects with specific feedback
    Given Marcus is on the review page for task "Add pagination to entity search"
    And the response type in "contracts.ts" was not updated to include pagination fields
    When Marcus clicks "Reject with Feedback"
    And enters "Update the SearchResponse type in contracts.ts to include total, limit, and offset fields"
    And clicks "Send Feedback & Resume Agent"
    Then the feedback is delivered to the agent as a follow-up prompt
    And the session status changes to "active"
    And Marcus is navigated back to the live session view
    And the agent begins addressing the feedback

  Scenario: Marcus aborts a session during review
    Given Marcus is on the review page for a session that produced incorrect changes
    When Marcus clicks "Abort"
    Then the session status changes to "aborted"
    And the task status returns to "ready"
    And the worktree is removed
    And Marcus is navigated back to the task detail view

  # Error and Edge Cases

  Scenario: SSE connection drops and recovers
    Given Marcus is watching the agent output stream
    When the SSE connection is lost
    Then a warning shows "Connection lost"
    And the status badge shows "Error"

  Scenario: Agent exceeds maximum step count
    Given Marcus has an active agent session
    When the agent has edited more than 100 files
    Then the stall detector aborts the session
    And a warning shows "Agent exceeded maximum step count"
    And the task status returns to "ready"

  @property
  Scenario: Agent output renders within acceptable latency
    Given the event bridge is transforming OpenCode events to Brain stream events
    Then agent token events render in the browser within 200ms of emission from OpenCode
    And file change notifications appear within 200ms of the file.edited event
    And status transitions reflect within 200ms of the session.updated event

  @property
  Scenario: Session state is consistent across all views
    Given an active agent session exists
    Then the orchestrator status in the database matches the status badge in the UI
    And the files changed count in the database matches the count in the status bar
    And the session ID is consistent across all API calls and SSE events
