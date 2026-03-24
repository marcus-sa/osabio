Feature: Platform Governance & Device Management

  Background:
    Given Brain is running with gateway endpoint at "/api/gateway"
    And a workspace "acme" exists with a platform engineer "identity:admin"

  # --- J3: Governed Agent Execution ---

  Scenario: Policy enforcement on agent work
    Given device "dev-agent-001" is connected with identity "identity:coder"
    And workspace "acme" has an active policy:
      | rule                  | value          |
      | max_risk_level        | medium         |
      | budget_limit_usd      | 10.00          |
      | allowed_agent_types   | code_agent     |
    When the agent submits work via the agent method
    Then Brain evaluates the intent against the policy graph
    And the intent is authorized with risk_level "low"
    And the orchestrator assigns the task

  Scenario: Policy denies high-risk intent
    Given device "dev-agent-002" is connected with identity "identity:junior"
    And workspace "acme" has a policy limiting "junior" tier to max_risk_level "low"
    When the agent submits work classified as risk_level "high"
    Then Brain denies the intent
    And sends agent.error with:
      | code    | policy_violation                            |
      | policy  | policy:restrict-junior                      |
      | reason  | risk_level "high" exceeds max "low"         |

  # --- J4: Native Trace Recording ---

  Scenario: Complete trace recorded for agent execution
    Given an agent session completes successfully via the gateway
    Then Brain records a hierarchical trace:
      | level | entity                    |
      | root  | intent                    |
      | child | agent_session             |
      | leaf  | tool_call (search_entities) |
      | leaf  | tool_call (create_decision) |
      | leaf  | llm_completion            |
    And the trace links to the originating gateway device
    And spend is recorded per-model with token counts

  Scenario: Trace audit by platform engineer
    Given agent session "session-001" completed with 5 tool calls
    When the platform engineer queries agent.history for "session-001"
    Then Brain returns the full trace tree with:
      | field       | value                     |
      | intent      | intent:abc                |
      | session     | agent_session:session-001 |
      | tool_calls  | 5                         |
      | decisions   | 1 created                 |
      | observations| 0                         |
      | total_tokens| 4500                      |
      | cost_usd    | 0.045                     |

  # --- J6: Multi-Agent Workspace Coordination ---

  Scenario: Multiple agents share context through graph
    Given device "dev-architect" connects as agent type "architect"
    And device "dev-coder" connects as agent type "code_agent"
    When the architect agent creates a decision "Use tRPC for all APIs"
    And the coder agent starts a new session
    Then the coder's graph context includes the decision "Use tRPC for all APIs"

  Scenario: Presence tracking across gateway connections
    Given device "dev-001" connects to workspace "acme"
    And device "dev-002" connects to workspace "acme"
    When a client sends a presence query
    Then Brain returns:
      | device    | status  | agent_type |
      | dev-001   | online  | code_agent |
      | dev-002   | online  | architect  |
    When device "dev-001" disconnects
    Then presence updates to show dev-001 as offline

  # --- J7: Model Routing and Spend Control ---

  Scenario: Model list returns configured providers
    Given workspace "acme" has models configured:
      | model_id              | provider    |
      | claude-sonnet-4-6     | openrouter  |
      | claude-haiku-4-5      | openrouter  |
    When a connected device sends model.list
    Then Brain returns the configured models
    And does NOT expose API keys

  Scenario: Per-agent spend tracking
    Given device "dev-agent-001" has completed 3 sessions today
    When the platform engineer queries spend for "dev-agent-001"
    Then Brain returns:
      | metric        | value   |
      | total_tokens  | 15000   |
      | cost_usd      | 0.15    |
      | budget_limit  | 10.00   |
      | budget_used   | 1.5%    |
