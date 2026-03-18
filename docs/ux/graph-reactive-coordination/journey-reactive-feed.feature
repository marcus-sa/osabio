Feature: Real-Time Governance Feed
  As a workspace admin monitoring agent activity,
  I want the governance feed to update in real-time when the graph changes,
  so I can act on governance items as they happen instead of polling.

  Background:
    Given Marcus Oliveira is a workspace admin for workspace "montreal"
    And the workspace has active agent sessions for chat_agent and observer_agent

  # --- Step 1: Feed connects with live updates ---

  Scenario: Feed establishes live SSE connection on page load
    When Marcus navigates to the governance feed for workspace "montreal"
    Then the feed page loads within 1 second
    And the connection indicator shows "Connected" with a live pulse
    And the feed displays items grouped by tier: blocking, review, awareness

  Scenario: Feed loads initial state via GET then subscribes to SSE
    Given the workspace has 2 blocking items and 4 review items
    When Marcus opens the governance feed
    Then the feed displays 2 blocking items and 4 review items
    And an SSE connection is established to /api/workspaces/montreal/feed/stream
    And subsequent graph changes are delivered via SSE without page refresh

  # --- Step 2: Real-time feed updates ---

  Scenario: New blocking decision appears in feed within 2 seconds
    Given Marcus has the governance feed open for workspace "montreal"
    And the feed currently shows 1 blocking item
    When the extraction pipeline creates a new provisional decision "Use event sourcing for audit trail" with confidence 0.92
    Then within 2 seconds a new blocking item appears in the feed
    And the item shows: "Provisional decision awaiting confirmation"
    And the blocking count updates to 2
    And the new item has a [NEW] visual indicator

  Scenario: Decision confirmation moves item from blocking to awareness
    Given Marcus has the governance feed open
    And the blocking tier contains decision "Standardize on tRPC for all APIs"
    When chat_agent confirms the decision via conversation C-12
    Then within 2 seconds the decision disappears from the blocking tier
    And a new awareness item appears: "Decision confirmed: Standardize on tRPC for all APIs"
    And the blocking count decreases by 1
    And the awareness item shows "Confirmed by chat_agent" with a timestamp

  Scenario: Task status change updates feed tier placement
    Given Marcus has the governance feed open
    And the review tier contains blocked task "Implement rate limiting"
    When Agent B completes the task and updates status to "done"
    Then within 2 seconds the task moves from review tier to awareness tier
    And the awareness item shows "Recently completed task"

  Scenario: Observation created by Observer appears in review tier
    Given Marcus has the governance feed open
    And the review tier currently has 3 items
    When the Observer agent creates a warning observation "Schema migration missing for new field"
    Then within 2 seconds a new review item appears
    And the item shows severity "warning" and source "observer_agent"
    And the review count increases to 4

  # --- Step 3: Cascading conflict detection ---

  Scenario: Decision confirmation triggers cascading conflict detection
    Given Marcus has the governance feed open
    And Agent B has an active session on task "Migrate billing API" (task:t-47)
    And task:t-47 has a depends_on edge to decision "API transport standard" (decision:d-99)
    When chat_agent confirms decision:d-99 with value "Standardize on tRPC"
    Then the Observer agent is triggered to verify decision:d-99
    And within 10 seconds a new review item appears: "Task at risk: Migrate billing API"
    And the item explains "Task depends on just-confirmed decision: API transport standard"
    And Agent B is queued to receive the conflict context on its next turn

  Scenario: Multiple agents affected by single decision change
    Given Marcus has the governance feed open
    And Agent B has an active session on task "Migrate billing API" depending on decision:d-99
    And Agent C has an active session on task "Update API documentation" depending on decision:d-99
    When decision:d-99 is confirmed with value "Standardize on tRPC"
    Then within 10 seconds the feed shows risk items for both affected tasks
    And both Agent B and Agent C are queued for context updates

  # --- Step 4: Acting on feed items ---

  Scenario: Acknowledging an observation notifies affected agent
    Given Marcus sees a review item "Task at risk: Migrate billing API to tRPC"
    And the item has actions: Acknowledge, Resolve, Discuss
    When Marcus clicks "Acknowledge" on the item
    Then the item status updates in-place to "Acknowledged by Marcus"
    And the Acknowledge button is replaced by Resolve and Discuss
    And Agent B receives an enqueue notification with the conflict context
    And the observation node in SurrealDB has status "acknowledged"

  Scenario: Resolving an observation removes it from review
    Given Marcus sees an acknowledged observation "Task at risk: Migrate billing API"
    When Marcus clicks "Resolve" on the item
    Then the item disappears from the review tier
    And the review count decreases by 1
    And the observation node in SurrealDB has status "resolved"

  # --- Step 5: Connection loss and recovery ---

  Scenario: Feed shows reconnection status on SSE disconnect
    Given Marcus has the governance feed open with an active SSE connection
    When the network connection drops
    Then within 3 seconds the connection indicator changes to "Reconnecting..."
    And a banner appears: "Connection lost. Changes since 3:55 PM will appear when reconnected."
    And the existing feed items remain visible (not cleared)

  Scenario: Feed recovers from connection loss without data loss
    Given Marcus has the governance feed open
    And Marcus last received event ID "evt-42"
    When the SSE connection drops for 30 seconds
    And during disconnection: 1 new observation and 1 task completion occur
    Then when the connection recovers, the feed shows "Reconnected. 2 updates received."
    And the new observation appears in the review tier with [NEW] badge
    And the completed task appears in the awareness tier
    And the connection indicator returns to "Connected"

  Scenario: Feed handles extended disconnection gracefully
    Given Marcus has the governance feed open
    When the SSE connection drops for 10 minutes
    Then when Marcus returns, the feed shows "Reconnecting..."
    And on reconnection a full feed refresh is triggered (not just delta)
    And the banner shows "Reconnected. Feed refreshed."

  # --- Property scenarios ---

  @property
  Scenario: Feed update latency stays within bounds
    Given the SSE connection is active for workspace "montreal"
    When any graph write completes in the workspace
    Then the corresponding feed event arrives at the client within 2 seconds at the 95th percentile
    And no feed event takes longer than 5 seconds

  @property
  Scenario: SSE connection remains stable during normal operation
    Given Marcus has the governance feed open
    Then the SSE connection sends a keep-alive every 15 seconds
    And the connection does not drop during 30 minutes of normal operation
    And memory usage for the SSE channel does not grow unbounded

  @property
  Scenario: Feed item ordering is consistent
    Given multiple graph changes occur within the same second
    Then feed items within a tier are always ordered by timestamp descending
    And no feed item appears in multiple tiers simultaneously
    And tier counts always match the actual number of items displayed
