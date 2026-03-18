Feature: Reactive Agent Coordination
  Agents automatically receive context updates when graph changes
  affect their active work, eliminating human relay of information
  between agents.

  Background:
    Given workspace "montreal" has reactive coordination enabled
    And LIVE SELECT queries are active on decision, task, observation, and agent_session tables

  # --- Event Classification ---

  Scenario: Decision confirmation classified as enqueue for dependent agents
    Given Agent B has an active session on task "Migrate billing API" (task:t-47)
    And task:t-47 has a depends_on edge to decision:d-99
    When decision:d-99 transitions from "provisional" to "confirmed"
    Then the event classifier produces:
      | target               | level   | reason                                    |
      | feed                 | log     | Decision status change is feed-worthy     |
      | observer             | log     | Decision confirmation triggers verification |
      | agent_session:s-88   | enqueue | Active task depends on changed decision   |

  Scenario: Decision superseded classified as interrupt for dependent agents
    Given Agent B has an active session on task "Migrate billing API" (task:t-47)
    And task:t-47 has a depends_on edge to decision:d-55
    When decision:d-55 transitions from "confirmed" to "superseded"
    Then the event classifier produces notification level "interrupt" for agent_session:s-88
    And the reason includes "dependency superseded -- active work may be invalid"

  Scenario: Task blocked triggers interrupt for assigned agent
    Given Agent C has an active session assigned to task "Update API docs" (task:t-102)
    When task:t-102 transitions from "in_progress" to "blocked"
    Then the event classifier produces notification level "interrupt" for Agent C's session

  Scenario: Low-severity observation classified as log only
    Given Agent A creates an info-severity observation "Code style inconsistency in module X"
    When the event classifier processes the observation creation
    Then notification level is "log" for the feed
    And no agent notifications are generated

  # --- Coordinator Dependency Resolution ---

  Scenario: Coordinator finds affected agents via graph traversal
    Given the graph contains:
      | from       | edge        | to           |
      | task:t-47  | depends_on  | decision:d-99 |
      | task:t-102 | depends_on  | decision:d-99 |
    And Agent B has an active session on task:t-47
    And Agent C completed its session on task:t-102 two hours ago
    When the coordinator resolves affected agents for decision:d-99
    Then Agent B is identified as affected (active session)
    And Agent C is not identified (no active session)

  Scenario: Coordinator handles entity with no dependencies
    Given decision:d-200 has no incoming depends_on edges
    When the coordinator resolves affected agents for decision:d-200
    Then no agents are identified as affected
    And the event is routed to feed only

  Scenario: Coordinator traverses multi-hop dependencies
    Given the graph contains:
      | from        | edge        | to            |
      | task:t-50   | depends_on  | feature:f-10  |
      | feature:f-10| belongs_to  | project:p-1   |
    And Agent D has an active session on task:t-50
    And decision:d-99 belongs_to project:p-1
    When the coordinator resolves affected agents for decision:d-99 with depth 2
    Then Agent D is identified as potentially affected (indirect dependency)
    And the notification level is "enqueue" (not interrupt, because indirect)

  # --- Enqueue Delivery ---

  Scenario: Agent reads enqueued context update on next tool turn
    Given Agent B has an active session on task "Migrate billing API"
    And the coordinator enqueued context update: "Decision d-99 confirmed: Standardize on tRPC"
    When Agent B makes its next tool call (search_entities)
    Then the context update is prepended to Agent B's system context
    And the update is clearly labeled as "[CONTEXT UPDATE - received during active session]"
    And Agent B's tool call proceeds normally after context injection

  Scenario: Stale enqueued context is discarded after TTL
    Given the coordinator enqueued a context update for Agent B at 10:00 AM
    And the TTL for context queue items is 30 minutes
    When Agent B makes a tool call at 10:45 AM
    Then the context update is not injected (expired)
    And the queue item is logged as "discarded: TTL expired"

  Scenario: Multiple enqueued updates are batched
    Given the coordinator enqueued 3 context updates for Agent B within 10 seconds
    When Agent B makes its next tool call
    Then all 3 updates are delivered as a single batched context injection
    And updates are ordered chronologically
    And the batch is labeled "[3 CONTEXT UPDATES - received during active session]"

  # --- Interrupt Delivery ---

  Scenario: Interrupt context injected on next agent turn
    Given Agent B is actively processing task "Migrate billing API"
    And decision:d-55 (which task:t-47 depends on) was just superseded
    When the coordinator sends an interrupt notification
    Then Agent B's current generation completes normally
    And on Agent B's next turn the interrupt context is injected
    And the context includes:
      | field            | value                                          |
      | urgency          | URGENT                                         |
      | entity           | decision:d-55                                  |
      | change           | superseded by decision:d-99                    |
      | impact           | Task t-47 depends on superseded decision       |
      | recommendation   | Pause and re-evaluate task approach             |

  Scenario: Interrupt does not cancel agent's current generation
    Given Agent B is mid-generation (streaming response tokens)
    When an interrupt notification arrives
    Then Agent B's current response stream is not cancelled
    And the interrupt is queued for injection on the next turn
    And no tokens are lost from the current response

  # --- Loop Detection ---

  Scenario: Cascading observation loop is dampened after threshold
    Given the Observer agent is processing events for task:t-47
    When the Observer creates observations obs-1, obs-2, obs-3 targeting task:t-47 within 60 seconds
    Then on the 4th event targeting task:t-47, the dampener activates
    And notification level is forced to "log" for all task:t-47 events for 60 seconds
    And a meta-observation is created: "Cascading event loop dampened on task:t-47 (4 events in 60s from observer_agent)"
    And the meta-observation appears in Marcus's feed as a review item

  Scenario: Dampening resets after time window expires
    Given dampening was activated on task:t-47 at 10:01:00
    And the dampening window is 60 seconds
    When a new event for task:t-47 arrives at 10:02:05
    Then the dampener has reset (window expired)
    And the event is classified normally (not dampened)

  Scenario: Different entities are tracked independently
    Given the Observer creates 3 observations targeting task:t-47 in 60 seconds
    And the Observer creates 1 observation targeting task:t-102 in the same window
    When the dampener evaluates task:t-102
    Then task:t-102 is not dampened (only 1 event)
    And task:t-47 remains dampened (3 events)

  # --- Properties ---

  @property
  Scenario: No agent coordination loops in normal operation
    Given workspace "montreal" has 5 active agent sessions
    When 10 graph changes occur within 30 seconds
    Then no agent receives more than 3 context injections total
    And no meta-observation about dampening is created (no loops triggered)

  @property
  Scenario: Context injection does not degrade agent response quality
    Given Agent B receives a context injection mid-session
    Then Agent B's subsequent responses reference the injected context appropriately
    And Agent B does not repeat or contradict information from the injection
    And the injection does not cause Agent B to lose track of its primary task

  @property
  Scenario: Coordinator graph traversal scales with entity count
    Given workspace "montreal" has 500 tasks, 200 decisions, and 50 active sessions
    When a decision is confirmed affecting 10 dependent tasks
    Then the coordinator resolves all 10 affected tasks within 200ms
    And identifies the 3 with active sessions within 250ms total
