Feature: Intent-Gated MCP Tool Access
  Coding agents in sandboxes access governed MCP tools through Brain's
  dynamic endpoint. Tool access is gated by intents evaluated against
  workspace policies, with optional human veto for high-risk operations.

  Background:
    Given workspace "Acme Engineering" has policies configured
    And a sandbox session exists for agent "claude-coder-7f3a"
    And the session has a valid proxy token linked via proxy_token.session

  # --- tools/list ---

  Scenario: tools/list returns authorized and gated tools
    Given session "claude-coder-7f3a" has an authorized intent for "github:create_pr"
    When the agent sends tools/list to the dynamic MCP endpoint
    Then the response includes "github:create_pr" as a callable tool
    And the response includes "stripe:create_refund" marked as gated
    And the gated tool description instructs the agent to call create_intent first
    And the response includes Brain-native tools "create_intent" and "get_context"

  Scenario: tools/list with no intents returns only Brain-native tools and gated tool listing
    Given session "claude-coder-7f3a" has no authorized intents
    When the agent sends tools/list to the dynamic MCP endpoint
    Then the response includes Brain-native tools "create_intent" and "get_context"
    And all registered MCP tools appear as gated with intent instructions

  Scenario: tools/list reflects newly authorized intent
    Given session "claude-coder-7f3a" initially has no authorized intents
    And the agent creates and gets authorized an intent for "github:list_repos"
    When the agent sends tools/list to the dynamic MCP endpoint
    Then the response includes "github:list_repos" as a callable tool

  # --- tools/call (authorized) ---

  Scenario: Authorized tool call succeeds
    Given session "claude-coder-7f3a" has an authorized intent for "github:create_pr"
    And the intent authorizes repository "acme/billing-service"
    When the agent calls tools/call for "github:create_pr" with repo "acme/billing-service"
    Then the call is forwarded to the upstream GitHub MCP server
    And the agent receives the pull request result
    And a trace record is created linking the call to the session and intent

  Scenario: Tool call within constraint bounds succeeds
    Given session "claude-coder-7f3a" has an authorized intent for "stripe:create_refund"
    And the intent authorizes amount up to 5000 cents in USD
    When the agent calls tools/call for "stripe:create_refund" with amount 3000 and currency "usd"
    Then the call is forwarded to the upstream Stripe MCP server
    And the refund result is returned to the agent

  Scenario: Tool call exceeding constraint bounds is rejected
    Given session "claude-coder-7f3a" has an authorized intent for "stripe:create_refund"
    And the intent authorizes amount up to 5000 cents in USD
    When the agent calls tools/call for "stripe:create_refund" with amount 7500 and currency "usd"
    Then the agent receives a 403 constraint_violation error
    And the error specifies "amount 7500 exceeds authorized maximum 5000"
    And a trace record is created with status "constraint_violated"

  # --- tools/call (gated -- intent required) ---

  Scenario: Gated tool call returns structured 403 with intent template
    Given session "claude-coder-7f3a" has no intent authorizing "stripe:create_refund"
    When the agent calls tools/call for "stripe:create_refund"
    Then the agent receives a 403 error with code "intent_required"
    And the error includes an action_spec_template for "stripe:create_refund"
    And the template includes the parameter schema for the tool

  # --- create_intent (auto-approve) ---

  Scenario: Agent creates intent that auto-approves
    Given workspace policy allows "github:list_repos" without human veto
    When the agent calls create_intent with goal "List repositories to find billing service"
    And action_spec provider "github" action "list_repos"
    Then an intent is created in draft status
    And the intent is auto-submitted to pending_auth
    And policy evaluation approves without veto requirement
    And the intent transitions to authorized
    And a gates edge links the session to the authorized intent
    And the agent receives status "authorized" with the intent ID

  # --- create_intent (veto required) ---

  Scenario: Agent creates intent requiring human veto
    Given workspace policy requires human veto for "stripe:create_refund"
    When the agent calls create_intent with goal "Refund customer $50 for defective widget"
    And action_spec provider "stripe" action "create_refund" params amount 5000 currency "usd"
    Then an intent is created and submitted
    And policy evaluation sets human_veto_required to true
    And the intent transitions to pending_veto
    And a gates edge links the session to the pending intent
    And the agent receives status "pending_veto"

  # --- yield-and-resume ---

  Scenario: Agent yields session on pending veto
    Given the agent received status "pending_veto" for an intent
    When the agent stops making tool calls
    Then the session status transitions to idle
    And the pending intent appears in the governance feed for workspace "Acme Engineering"

  Scenario: Human approves intent and observer resumes session
    Given session "claude-coder-7f3a" is idle with a pending_veto intent
    When human operator Carla Mendes approves the intent in the governance feed
    Then the intent transitions to authorized
    And the observer agent detects the authorized intent for the idle session
    And the observer triggers adapter.resumeSession for "claude-coder-7f3a"
    And the session transitions from idle to active
    And the agent can now call the previously-gated tool

  Scenario: Human vetoes intent
    Given session "claude-coder-7f3a" is idle with a pending_veto intent
    When human operator Carla Mendes vetoes the intent with reason "Amount too high for this customer"
    Then the intent transitions to vetoed
    And the observer detects the vetoed intent for the idle session
    And the observer triggers adapter.resumeSession for "claude-coder-7f3a"
    And the agent receives veto information and adapts its approach

  # --- Intent denied by policy ---

  Scenario: Policy denies intent outright
    Given workspace policy denies all access to provider "production-db"
    When the agent calls create_intent with action_spec provider "production-db" action "execute_query"
    Then the intent is created, submitted, and evaluated
    And policy evaluation returns deny
    And the intent transitions to vetoed with reason from policy
    And the agent receives status "vetoed" with the denial reason
    And no gates edge is created for the denied intent

  # --- Trace recording ---

  Scenario: All tool calls produce trace records
    Given session "claude-coder-7f3a" has authorized intents
    When the agent makes 3 tool calls (2 succeed, 1 fails upstream)
    Then 3 trace records are created in the graph
    And each trace links to the session via invoked edge
    And each trace includes tool name, arguments, result or error, and duration
    And the failed trace includes the upstream error details

  # --- Edge cases ---

  Scenario: Upstream MCP server timeout
    Given session "claude-coder-7f3a" has an authorized intent for "jira:create_issue"
    When the agent calls tools/call for "jira:create_issue"
    And the upstream Jira MCP server does not respond within 30 seconds
    Then the agent receives a 504 timeout error
    And a trace record is created with status "timeout"
    And the intent remains authorized (reusable for retry)

  Scenario: Composite intent authorizes multi-step chain
    Given session "claude-coder-7f3a" has an authorized composite intent
    And the intent authorizes both "stripe:list_charges" and "stripe:create_refund"
    When the agent calls tools/call for "stripe:list_charges"
    Then the call succeeds
    When the agent calls tools/call for "stripe:create_refund" within authorized constraints
    Then the call succeeds
    And both calls are traced under the same intent
