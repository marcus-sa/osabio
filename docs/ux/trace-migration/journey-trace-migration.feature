Feature: Migrate subagent traces from embedded arrays to normalized trace table
  As the Brain platform
  Traces of subagent executions should be stored as graph-native trace records
  So that execution trees are independently queryable, traversable, and correlated with intent traces

  Background:
    Given the trace table exists with fields type, actor, workspace, session, parent_trace, tool_name, input, output, duration_ms, created_at
    And the spawns relation table exists with TYPE RELATION IN message OUT trace
    And the message table has no subagent_traces field

  # --- Write Path ---

  Scenario: Subagent invocation creates hierarchical trace records
    Given Elena Vasquez has an onboarded workspace "Riverside Bakery" with a project "Online Ordering"
    And Elena sends "Plan the online ordering feature: menu display, cart, and checkout"
    When the chat agent invokes the PM agent with intent "plan_work"
    And the PM agent executes 4 tool calls: search_entities, suggest_work_items, create_work_item, create_observation
    And the PM agent completes in 3200ms
    Then a trace record exists with:
      | field       | value              |
      | type        | subagent_spawn     |
      | tool_name   | invoke_pm_agent    |
      | duration_ms | 3200               |
      | workspace   | workspace:riverside|
    And 4 child trace records exist with parent_trace pointing to the root trace
    And child trace types are ["tool_call", "tool_call", "tool_call", "tool_call"]
    And child tool_names are ["search_entities", "suggest_work_items", "create_work_item", "create_observation"]
    And a spawns edge connects the assistant message to the root trace record

  Scenario: Text steps in subagent execution become message-type traces
    Given Marcus Henriksson has an onboarded workspace "DevOps Hub"
    And Marcus sends "Check project status for the CI pipeline feature"
    When the PM agent produces intermediate reasoning text between tool calls
    Then a child trace with type "message" exists under the root trace
    And the message trace input contains the reasoning text

  Scenario: Multiple subagent invocations on one message create separate trace trees
    Given Aisha Patel has an onboarded workspace "HealthTrack"
    And Aisha sends a complex message that triggers both PM agent and analytics agent
    When both subagents complete execution
    Then 2 root trace records exist with type "subagent_spawn"
    And 2 spawns edges connect the assistant message to each root trace
    And each root trace has its own child hierarchy

  # --- Read Path: Conversation Load ---

  Scenario: Conversation load returns traces reconstructed from graph
    Given Tomoko Nakamura has a conversation with 3 messages in workspace "Sushi Express"
    And the second assistant message has a spawns edge to a trace tree with 5 steps
    When loading the conversation via GET /api/workspaces/:wsId/conversations/:convId
    Then the response contains 3 messages
    And the second assistant message includes subagentTraces array with 1 entry
    And the trace entry has agentId "pm_agent"
    And the trace entry has 5 steps with correct type, toolName, and argsJson fields
    And the trace entry has totalDurationMs matching the root trace duration_ms

  Scenario: Messages without traces return no subagentTraces field
    Given Carlos Rodriguez has a conversation with only direct chat responses (no subagent invocation)
    When loading the conversation via GET /api/workspaces/:wsId/conversations/:convId
    Then no message in the response includes a subagentTraces field

  # --- Read Path: Branch Inheritance ---

  Scenario: Branched conversation inherits traces from ancestor messages
    Given Priya Sharma has a conversation in workspace "TechStartup" with PM agent traces on message #3
    And Priya branches a new conversation from message #3
    When loading messages with inheritance for the branched conversation
    Then inherited message #3 includes subagent_traces loaded from trace records via spawns edge
    And the trace structure matches what was originally persisted

  # --- Graph Forensics ---

  Scenario: Graph traversal returns call tree from message
    Given an assistant message message:abc has a spawns edge to trace:root1
    And trace:root1 has type "subagent_spawn" and tool_name "invoke_pm_agent"
    And trace:root1 has 3 children: trace:s1 (tool_call, search_entities), trace:s2 (message), trace:s3 (tool_call, create_observation)
    When querying "SELECT ->spawns->trace FROM message:abc"
    Then the result contains trace:root1

  Scenario: Child traces queryable by parent_trace
    Given trace:root1 exists with 3 child traces
    When querying "SELECT * FROM trace WHERE parent_trace = trace:root1 ORDER BY created_at ASC"
    Then 3 records are returned in chronological order
    And each record has the correct type and tool_name

  Scenario: Intent traces and message traces share the same table
    Given intent:i1 has trace_id pointing to trace:intent_root (type "intent_submission")
    And message:m1 has spawns edge to trace:msg_root (type "subagent_spawn")
    When querying "SELECT * FROM trace WHERE workspace = workspace:ws1"
    Then both trace:intent_root and trace:msg_root appear in results
    And they can be distinguished by their type field

  # --- Schema Cleanup ---

  Scenario: Migration removes embedded subagent_traces from message schema
    Given migration 0024 has been applied to the database
    When inspecting the message table schema with INFO FOR TABLE message
    Then no field definition for subagent_traces exists
    And no field definition for subagent_traces[*].agentId exists
    And no field definition for subagent_traces[*].steps exists

  # --- Error/Edge Cases ---

  Scenario: Trace persistence failure does not block message persistence
    Given the trace table is temporarily unavailable
    When the chat agent completes a response with PM agent traces
    Then the assistant message is still persisted with text content
    And an error is logged for the trace persistence failure
    And the message has no spawns edge (graceful degradation)

  Scenario: Empty subagent trace (zero steps) still creates root trace
    Given the PM agent is invoked but returns immediately with no tool calls
    When the trace is persisted
    Then a root trace record exists with type "subagent_spawn" and duration_ms > 0
    And zero child trace records exist for this root
    And the spawns edge connects the message to the root trace
