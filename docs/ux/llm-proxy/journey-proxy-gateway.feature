Feature: LLM Proxy Gateway
  As the syscall boundary of the agent OS, the LLM proxy mediates all LLM API
  calls between agents and model providers, providing identity resolution,
  policy enforcement, cost attribution, and graph-native trace capture
  transparently.

  # --- Step 1: Configure Proxy + Policies ---

  Scenario: Admin configures workspace budget limits
    Given Marcus Olsson is the admin of workspace "brain-v1"
    And the LLM proxy is running on port 4100
    When Marcus sets the daily budget limit to $50.00 for the workspace
    And Marcus sets the daily budget limit to $20.00 for project "auth-service"
    Then the budget limits are persisted to workspace settings
    And the proxy enforces the new limits on subsequent LLM calls

  Scenario: Admin configures model access policies
    Given Marcus Olsson is the admin of workspace "brain-v1"
    When Marcus creates a policy allowing "coding-agent" to use models "claude-sonnet-4, claude-haiku-3.5"
    And Marcus creates a policy allowing "observer" to use only model "claude-haiku-3.5"
    Then the policies are written to the policy graph with status "active"
    And the proxy evaluates these policies on every LLM call

  # --- Step 2: Connect Agent ---

  Scenario: Developer connects Claude Code via brain init
    Given Priya Chandrasekaran has Claude Code installed
    And the Brain proxy is running at "http://localhost:4100"
    When Priya runs "brain init" in her project directory
    Then ANTHROPIC_BASE_URL is set to "http://localhost:4100/proxy/llm/anthropic"
    And X-Brain-Workspace header is configured with workspace ID "brain-v1"
    And a confirmation message shows proxy routing is active

  Scenario: Developer scopes session to a task
    Given Priya has connected Claude Code to the Brain proxy
    When Priya runs "brain start task:implement-oauth"
    Then X-Brain-Task header is configured with task ID "implement-oauth"
    And subsequent LLM calls are attributed to task "implement-oauth"

  # --- Step 3: Authenticate ---

  Scenario: Proxy extracts identity from Claude Code metadata
    Given Claude Code sends a request with metadata.user_id "user_a1b2c3_account_550e8400-e29b-41d4-a716-446655440000_session_6ba7b810-9dad-11d1-80b4-00c04fd430c8"
    And the request includes header X-Brain-Workspace "brain-v1"
    When the proxy receives the request
    Then the proxy resolves session ID "6ba7b810-9dad-11d1-80b4-00c04fd430c8"
    And the proxy resolves account ID "550e8400-e29b-41d4-a716-446655440000"
    And the proxy resolves workspace "brain-v1"

  Scenario: Proxy handles missing metadata gracefully
    Given an agent sends a request without metadata.user_id
    And the request includes header X-Brain-Workspace "brain-v1"
    When the proxy receives the request
    Then the proxy attributes the call to workspace "brain-v1" only
    And the trace is created with session_id omitted
    And the request is forwarded normally

  # --- Step 4: Authorize ---

  Scenario: Proxy authorizes a request within policy and budget
    Given workspace "brain-v1" has a daily budget of $50.00
    And today's spend is $12.40
    And the policy allows "coding-agent" to use "claude-sonnet-4"
    When a coding-agent requests model "claude-sonnet-4"
    Then the proxy authorizes the request
    And the request is forwarded to Anthropic within 10ms of receipt

  Scenario: Proxy blocks request exceeding budget
    Given workspace "brain-v1" has a daily budget of $50.00
    And today's spend is $49.80
    When a coding-agent requests model "claude-sonnet-4"
    Then the proxy returns HTTP 429
    And the error body includes "budget_exceeded"
    And the error body includes the current spend "$49.80" and limit "$50.00"
    And the error body includes remediation "Contact workspace admin to increase daily budget"

  Scenario: Proxy blocks request for unauthorized model
    Given the policy allows "observer" to use only "claude-haiku-3.5"
    When the observer agent requests model "claude-opus-4"
    Then the proxy returns HTTP 403
    And the error body includes "policy_violation"
    And the error body includes the policy reference "policy:model-access-prod-v2"
    And the error body includes remediation "Use claude-haiku-3.5 or request Opus access from workspace admin"

  Scenario: Proxy enforces rate limits
    Given the rate limit for workspace "brain-v1" is 60 requests per minute
    And 60 requests have been made in the current minute
    When another request arrives
    Then the proxy returns HTTP 429
    And the error body includes "rate_limit_exceeded"
    And the Retry-After header indicates when the next request will be accepted

  # --- Step 5: Forward to Upstream ---

  Scenario: Proxy forwards non-streaming request transparently
    Given a valid authorized request for model "claude-sonnet-4" with stream=false
    When the proxy forwards the request to Anthropic
    Then the response is relayed with the original status code
    And the response body is unmodified
    And the Content-Type header matches the upstream response

  Scenario: Proxy forwards streaming request with SSE passthrough
    Given a valid authorized request for model "claude-sonnet-4" with stream=true
    When the proxy forwards the request to Anthropic
    Then SSE events are relayed to the client as raw bytes
    And no buffering occurs between upstream and client
    And the time-to-first-token overhead is less than 50ms
    And message_start, content_block_delta, message_delta, and message_stop events all pass through

  Scenario: Proxy handles upstream failure gracefully
    Given a valid authorized request
    And Anthropic's API is unreachable
    When the proxy attempts to forward the request
    Then the proxy returns HTTP 502
    And the error body includes "upstream_unreachable"
    And the error body distinguishes proxy failure from Anthropic failure

  Scenario: Proxy preserves tool use and extended thinking
    Given Claude Code sends a request with tools defined and stream=true
    When the model responds with tool_use content blocks
    Then all content_block_start, content_block_delta (input_json_delta), and content_block_stop events pass through unmodified
    And the stop_reason "tool_use" is relayed correctly
    And Claude Code can process tool results and send the next request normally

  # --- Step 6: Capture Trace + Cost ---

  Scenario: Proxy captures trace for streaming response
    Given Priya's Claude Code session made a request for model "claude-sonnet-4"
    And the request is attributed to task "implement-oauth" in workspace "brain-v1"
    When the streaming response completes with 12340 input tokens and 2100 output tokens
    Then an trace node is created in the graph with model "claude-sonnet-4"
    And the trace records input_tokens=12340, output_tokens=2100
    And the trace records cost_usd computed from Sonnet 4 pricing ($3.00/$15.00 per million)
    And an edge "agent_session -> invoked -> trace" is created
    And an edge "trace -> attributed_to -> task:implement-oauth" is created
    And an edge "trace -> scoped_to -> workspace:brain-v1" is created

  Scenario: Proxy captures cache token metrics
    Given a streaming response includes cache_creation_input_tokens=5000 and cache_read_input_tokens=8200
    When the proxy computes cost
    Then cache creation tokens are priced at the cache write rate ($3.75/M for Sonnet 4)
    And cache read tokens are priced at the cache read rate ($0.30/M for Sonnet 4)
    And the trace records both cache token counts for efficiency analysis

  Scenario: Proxy updates spend counters atomically
    Given workspace "brain-v1" daily spend is $12.40
    And project "auth-service" spend is $8.30
    And task "implement-oauth" spend is $4.20
    When a call completes with cost $0.068
    Then workspace daily spend becomes $12.468
    And project spend becomes $8.368
    And task spend becomes $4.268
    And all counter updates complete within the same async batch

  Scenario: Trace capture does not block response delivery
    Given a streaming response is being relayed to Claude Code
    When the stream completes
    Then the client connection is closed before graph writes begin
    And trace capture runs asynchronously via inflight tracking
    And proxy restart before trace write completes does not lose the trace data

  # --- Step 7: Monitor Spend + Anomalies ---

  Scenario: Admin views spend breakdown by project
    Given Marcus navigates to the LLM Proxy spend overview
    When the dashboard loads
    Then Marcus sees today's total spend with progress bar against daily limit
    And a table shows per-project spend for today and month-to-date
    And the table includes call count per project
    And all figures are derived from trace graph aggregation

  Scenario: Admin views spend breakdown by agent session
    Given Marcus navigates to the session cost view
    When the dashboard loads
    Then Marcus sees each agent session with total cost, model used, and duration
    And sessions are sorted by cost descending
    And Marcus can drill into any session to see individual LLM traces

  Scenario: Anomaly detection flags unusual spending
    Given Priya's session "auth-refactor" has made 342 LLM calls in 2.1 hours
    And the average session rate is 100 calls per 2 hours
    When the anomaly detector evaluates the session
    Then an observation is created with severity "warning"
    And the observation text describes the anomaly: "3x average call rate, possible debugging loop"
    And the observation appears in Marcus's dashboard with [Investigate] and [Dismiss] actions

  Scenario: Budget threshold alert fires
    Given workspace "brain-v1" has a daily budget of $50.00 with alert at 80%
    When daily spend reaches $40.00
    Then an alert fires indicating 80% of daily budget consumed
    And the alert is visible in the Brain dashboard
    And the alert includes current spend rate projection for remaining hours

  # --- Step 8: Audit Provenance ---

  Scenario: Auditor traces provenance chain for a specific LLM call
    Given Elena Vasquez queries the audit view for trace "trace:tr-2026-0315-001"
    When the trace detail loads
    Then Elena sees the model, token counts, cost, latency, and stop reason
    And Elena sees the provenance chain:
      | From                                  | Edge           | To                              |
      | intent:deploy-auth                    | authorized_by  | policy:model-access-v2          |
      | intent:deploy-auth                    | executed_in    | agent_session:priya-auth-42     |
      | agent_session:priya-auth-42           | invoked        | trace:tr-2026-0315-001     |
      | trace:tr-2026-0315-001           | attributed_to  | task:implement-oauth            |
      | trace:tr-2026-0315-001           | scoped_to      | workspace:brain-v1              |
    And Elena can export the provenance chain as JSON

  Scenario: Auditor queries all LLM calls for a project in a date range
    Given Elena queries "all LLM traces for project auth-service between 2026-03-01 and 2026-03-15"
    When the query executes
    Then results return within 2 seconds
    And each result includes model, tokens, cost, session reference, and policy reference
    And Elena can export the results as a CSV report

  Scenario: Auditor verifies all calls were policy-authorized
    Given Elena runs the authorization compliance check for workspace "brain-v1" for March 2026
    When the check completes
    Then every trace is verified to have a governing policy edge
    And any traces without policy authorization are flagged as "unverified"
    And a compliance summary shows authorized vs unverified call counts

  # --- Property Scenarios ---

  @property
  Scenario: Proxy latency overhead remains under threshold
    Given the proxy is handling normal load
    Then the time-to-first-token overhead added by the proxy is less than 50ms at the 95th percentile
    And the policy check latency is less than 10ms at the 99th percentile

  @property
  Scenario: Every LLM call has a trace in the graph
    Given the proxy has been running for any period
    Then every successfully forwarded LLM call has a corresponding trace node
    And every trace has at minimum: model, input_tokens, output_tokens, cost_usd, latency_ms
    And every trace has an edge to its workspace

  @property
  Scenario: Spend counters are consistent with trace data
    Given spend counters exist for workspace, project, and task scopes
    Then the sum of trace.cost_usd for a given scope equals the spend counter value
    And any discrepancy triggers a self-healing reconciliation
