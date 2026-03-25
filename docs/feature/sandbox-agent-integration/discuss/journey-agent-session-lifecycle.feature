Feature: Agent Session Lifecycle via SandboxAgent SDK
  As a developer using Brain's governed coding agents,
  I want sandbox-isolated, multi-turn, auto-restoring agent sessions,
  so I can iterate on coding tasks safely with full governance and observability.

  Background:
    Given workspace "acme-engineering" exists with sandbox provider "docker"
    And agent type "claude" is configured as the default
    And Brain proxy is available at "https://brain.internal/proxy/llm/anthropic"
    And Brain MCP base URL is "https://brain.internal/mcp/agent"

  # --- Job 1: Sandbox Isolation ---

  Scenario: Agent session runs in Docker container isolation
    Given Carla Mendes configured workspace "acme-engineering" with Docker provider
    When the orchestrator spawns a session for task "implement-rate-limiting"
    Then the Claude Code agent runs inside a Docker container
    And the agent cannot access the host filesystem outside its mounted workspace
    And the agent's network is restricted to Brain proxy and MCP endpoints

  Scenario: Agent session runs in local worktree when provider is "local"
    Given workspace "dev-local" uses sandbox provider "local"
    When the orchestrator spawns a session for task "fix-login-bug"
    Then Brain creates a git worktree at "agent/fix-login-bug-<uuid>"
    And the session's cwd points to the worktree path
    And no container isolation is applied

  # --- Job 2: Agent Portability ---

  Scenario: Workspace admin switches default agent type
    Given workspace "acme-engineering" uses agent type "claude"
    When Carla changes the default agent type to "codex"
    And Rafael starts a new coding session
    Then the session uses Codex instead of Claude Code
    And the same MCP endpoint serves governed tools to Codex
    And events stream in the same universal format

  # --- Job 3: Multi-Turn Sessions ---

  Scenario: Developer sends follow-up prompt to existing session
    Given Rafael Torres has an active session "rate-limiter-a1b2" with Claude Code
    And the agent has already created rate-limiter.ts from the first prompt
    When Rafael sends "Use SurrealDB for distributed state instead of in-memory"
    Then the follow-up is delivered to the same session without respawning
    And the agent modifies rate-limiter.ts with SurrealDB counter logic
    And new events append to the existing trace in the governance feed

  Scenario: Follow-up prompt preserves full conversation context
    Given Rafael has sent 3 prompts to session "rate-limiter-a1b2"
    When he sends "Run the tests and fix any failures"
    Then the agent has context from all 3 previous prompts
    And it runs tests related to the rate limiter implementation
    And test results appear in the event stream

  Scenario: Prompt endpoint no longer returns 409 for active sessions
    Given session "rate-limiter-a1b2" is actively processing
    When Rafael sends a follow-up prompt via POST .../prompt
    Then the prompt is queued for delivery after current processing completes
    And the response status is 202 Accepted
    And Rafael does not receive a 409 Conflict

  # --- Job 4: Session Restoration ---

  Scenario: Session auto-restores after network interruption
    Given Rafael's session "rate-limiter-a1b2" has 23 persisted events in SurrealDB
    And the session has been active for 8 minutes
    When the network connection to the Docker sandbox is lost
    Then the SDK creates a fresh session in the sandbox
    And rebinds session ID "rate-limiter-a1b2" to the new runtime ID
    And replays 23 events (8,400 characters) as context
    And Rafael sees "Session temporarily interrupted. Restored automatically."
    And subsequent prompts work without re-setup

  Scenario: Session restoration after server restart
    Given Rafael's session "rate-limiter-a1b2" has 47 events persisted in SurrealDB
    When the Brain server restarts
    Then the session can be resumed via sdk.resumeSession()
    And the agent reconstructs context from persisted events
    And Rafael can continue prompting without re-explaining the task

  # --- Job 5: Dynamic MCP Endpoint Governance ---

  Scenario: MCP endpoint serves only granted tools
    Given agent "claude-rate-limiter" has grants for [github, slack, brain-search]
    And upstream MCP servers expose 15 total tools
    When the coding agent calls tools/list on Brain's MCP endpoint
    Then only tools from [github, slack, brain-search] are returned
    And tools from non-granted servers (jira, confluence) are not listed

  Scenario: MCP tool call goes through policy evaluation
    Given agent "claude-rate-limiter" calls github:create-branch via MCP endpoint
    When the MCP endpoint receives the tools/call request
    Then Brain evaluates the tool call against the policy graph
    And the call is approved (github grant is active)
    And OAuth credentials for GitHub are injected by Brain's credential broker
    And the tool call result is returned to the agent
    And a trace record is created with policy evaluation result

  Scenario: MCP tool call rejected by policy
    Given agent "claude-rate-limiter" attempts to call admin:delete-workspace
    And admin tools are not in the agent's effective toolset
    When the MCP endpoint receives the tools/call request
    Then Brain rejects the call with "Tool not in agent's granted scope"
    And the rejection is recorded in the trace graph
    And the agent receives an error response

  # --- Job 5: Permission Handling ---

  Scenario: Permission request surfaces in UI for user decision
    Given Claude Code requests permission to run bash("rm -rf /tmp/cache")
    When SandboxAgent emits a permission request event
    Then Rafael sees the permission request in the coding session UI
    And he can choose "Approve Once", "Approve Always", or "Reject"
    And his decision is sent back to the agent via session.respondPermission()

  Scenario: Permission auto-approved within agent's granted scope
    Given agent "claude-rate-limiter" has bash execution in its grant scope
    When Claude Code requests permission to run bash("npm test")
    Then the orchestrator auto-approves the permission request
    And the approval is recorded in the trace graph
    And Rafael is not interrupted

  # --- Job 6: SurrealDB Session Persistence ---

  Scenario: Session events persisted to SurrealDB in real time
    Given a coding session "rate-limiter-a1b2" is active
    When the agent produces a tool_call event for brain-search
    Then the event is written to SurrealDB via the session persistence driver
    And the event record includes session_id, event_type, timestamp, and payload
    And the event is queryable in the knowledge graph

  Scenario: Session record updated on status change
    Given session "rate-limiter-a1b2" is in status "active"
    When Rafael ends the session
    Then the session record in SurrealDB updates to status "completed"
    And the completion timestamp is recorded
    And the session summary (prompts, tool calls, files) is computed and stored

  # --- Job 7: Event Streaming ---

  Scenario: SandboxAgent events bridge to SSE registry
    Given Rafael is watching the governance feed for session "rate-limiter-a1b2"
    When the agent produces a file_edit event for rate-limiter.ts
    Then the event bridge translates it to Brain's event format
    And the event appears in Rafael's SSE stream within 500ms
    And the governance feed shows "File Edit: rate-limiter.ts (45 lines)"

  Scenario: Tool call events include governance context
    Given the agent calls brain-search via the MCP endpoint
    When the event bridge processes the tool_call event
    Then the governance feed shows the tool name, policy result, and duration
    And the trace graph links the tool call to the session and task

  # --- Job 8: Workspace Configuration ---

  Scenario: Workspace admin configures Docker sandbox provider
    Given Carla Mendes is an admin of workspace "acme-engineering"
    When she navigates to Workspace Settings > Agent Execution
    And selects "Docker" as the sandbox provider
    And sets the Docker image to "brain-agent-sandbox:latest"
    And saves the configuration
    Then new agent sessions use Docker containers
    And the configuration is persisted to the workspace record in SurrealDB

  # --- Error Paths ---

  Scenario: Sandbox provider fails to create session
    Given workspace uses E2B provider but the E2B API key is expired
    When the orchestrator attempts to spawn a session
    Then the orchestrator returns a clear error: "Sandbox provider E2B failed: authentication expired"
    And suggests: "Update E2B API key in workspace settings"
    And the task status remains unchanged (not marked as in-progress)

  Scenario: MCP endpoint unavailable during tool call
    Given the Brain server is temporarily unavailable
    When the coding agent calls tools/list on the MCP endpoint
    Then the agent receives a connection timeout error
    And the agent retries the tool call after a brief delay
    And if retries exhaust, the agent reports the failure in its output

  Scenario: Session persistence driver write failure
    Given SurrealDB is temporarily unavailable
    When the session persistence driver attempts to write an event
    Then the event is buffered in memory
    And a retry is attempted when SurrealDB becomes available
    And no events are lost during the outage
