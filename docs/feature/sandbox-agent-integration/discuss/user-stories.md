<!-- markdownlint-disable MD024 -->
# User Stories: Sandbox Agent Integration

## US-01: Spawn Coding Agent via SandboxAgent SDK

### Problem
Rafael Torres is a senior developer who uses Brain's coding agents to implement features. He finds it limiting that Brain can only run Claude Code via a single-shot SDK (`query()`) with no real isolation beyond git worktrees. When he starts a coding session, the agent runs as a host process with full filesystem access, and he cannot send follow-up prompts.

### Who
- Developer | Daily coding agent user | Wants governed, isolated agent execution

### Solution
Replace `@anthropic-ai/claude-agent-sdk` `query()` with SandboxAgent SDK `createSession()` + `prompt()` in the orchestrator's spawn-agent.ts. Configure the session with Brain's proxy URL as `ANTHROPIC_BASE_URL` and Brain's MCP endpoint via `setMcpConfig()`.

### Domain Examples
#### 1: Happy Path -- Rafael spawns a coding session for rate limiting
Rafael requests a coding session for task "implement-rate-limiting" in workspace "acme-engineering" (local provider). Brain creates a git worktree at `agent/rate-limiter-a1b2`, calls `sdk.createSession({ agent: "claude", cwd: worktreePath })`, configures MCP and proxy, and returns session ID `rate-limiter-a1b2`. Rafael's first prompt is delivered via `session.prompt()`.

#### 2: Edge Case -- Workspace uses Docker provider
Carla's workspace "secure-ops" uses Docker provider. Brain skips worktree creation, calls `sdk.createSession({ agent: "claude", cwd: "/workspace" })` with Docker sandbox. The container mounts the repo at `/workspace`. Session provisioning takes 3 seconds due to container startup.

#### 3: Error/Boundary -- SandboxAgent binary not available
Brain attempts `sdk.createSession()` but the SandboxAgent server is not running. The orchestrator returns error: "SandboxAgent server unavailable at localhost:4100. Ensure sandbox-agent is running." The task status remains "todo" (not moved to "in_progress").

### UAT Scenarios (BDD)

#### Scenario: Happy path session spawn with local provider
Given workspace "acme-engineering" uses sandbox provider "local"
And agent "claude" is configured as default
When Rafael requests a coding session for task "implement-rate-limiting"
Then Brain creates a git worktree at "agent/rate-limiter-<uuid>"
And calls sdk.createSession() with cwd pointing to the worktree
And configures Brain MCP endpoint via setMcpConfig()
And configures Brain proxy URL as ANTHROPIC_BASE_URL
And returns session ID to Rafael within 5 seconds

#### Scenario: Session spawn with Docker provider
Given workspace "secure-ops" uses sandbox provider "docker"
When Rafael requests a coding session for task "audit-logging"
Then Brain calls sdk.createSession() with Docker sandbox
And does not create a git worktree
And the container mounts the repository at /workspace
And MCP and proxy are configured identically to local sessions

#### Scenario: SandboxAgent server unavailable
Given the SandboxAgent server is not running
When Rafael requests a coding session
Then the orchestrator returns "SandboxAgent server unavailable"
And the task status remains unchanged
And no partial session records exist in SurrealDB

#### Scenario: Invalid agent type
Given workspace "acme-engineering" has default agent set to "nonexistent-agent"
When the orchestrator attempts to create a session
Then SandboxAgent returns an unsupported agent error
And the orchestrator surfaces a clear message to Rafael

### Acceptance Criteria
- [ ] Sessions created via `sdk.createSession()` instead of Claude Agent SDK `query()`
- [ ] Local provider creates git worktree; Docker/E2B providers skip worktree
- [ ] MCP endpoint and proxy URL configured on every session
- [ ] Session spawns within 5 seconds for local provider
- [ ] Clear error message when SandboxAgent server is unavailable

### Outcome KPIs
- **Who**: Developers using coding agents
- **Does what**: Successfully spawn governed coding sessions
- **By how much**: 100% of spawn requests succeed when SandboxAgent is healthy
- **Measured by**: Session creation success rate in trace graph
- **Baseline**: Current: 100% with Claude Agent SDK (but single-shot only)

### Technical Notes
- Depends on SandboxAgent SDK npm package (pin to specific version)
- `orchestrator/spawn-agent.ts` is the primary file to modify
- `orchestrator/agent-options.ts` replaced by SandboxAgent session config
- Worktree manager retained for local provider only

---

## US-02: SurrealDB Session Persistence Driver

### Problem
Rafael Torres loses all session state when Brain's server restarts because the orchestrator uses an in-memory handle registry (`Map<id, AgentHandle>`). A 30-minute coding session vanishes without trace after a deploy or crash, forcing him to re-explain everything to a new agent.

### Who
- Developer | Long-running coding sessions | Wants session durability across restarts

### Solution
Implement SandboxAgent's `SessionPersistDriver` interface (5 methods: `getSession`, `listSessions`, `updateSession`, `listEvents`, `insertEvent`) using SurrealDB, storing session records and events alongside existing `agent_session` and trace data.

### Domain Examples
#### 1: Happy Path -- Session events persisted in real time
Rafael's session "rate-limiter-a1b2" produces a tool_call event for brain-search. The persistence driver writes the event to SurrealDB with session_id, event_type, timestamp, and payload. The event is immediately queryable: `SELECT * FROM sandbox_event WHERE session = $sess ORDER BY created_at`.

#### 2: Edge Case -- High-frequency event burst
During a test run, the agent produces 40 events in 2 seconds (test output lines). The persistence driver batches writes, inserting all 40 events without blocking the event stream or causing backpressure on the SandboxAgent SDK.

#### 3: Error/Boundary -- SurrealDB temporarily unavailable
During a brief SurrealDB outage (5 seconds), 8 events arrive. The driver buffers them in memory and flushes to SurrealDB when the connection recovers. Zero events are lost. A warning is logged: "SurrealDB unavailable -- buffering 8 events for session rate-limiter-a1b2."

### UAT Scenarios (BDD)

#### Scenario: Session record created on spawn
Given Rafael starts a coding session via SandboxAgent SDK
When the session is successfully created
Then a session record exists in SurrealDB with id, agent_type, workspace, status "active", and created_at
And the record is linked to the corresponding agent_session via relation edge

#### Scenario: Events persisted in order
Given session "rate-limiter-a1b2" produces events [tool_call, file_edit, tool_call]
When each event is emitted by SandboxAgent
Then all 3 events are persisted to SurrealDB in order
And each has session_id, event_type, timestamp, and full payload
And listEvents(sessionId) returns them in chronological order

#### Scenario: Session status updated on conclusion
Given session "rate-limiter-a1b2" is active with 47 events
When Rafael ends the session
Then the session record status changes from "active" to "completed"
And the completion timestamp is recorded
And all 47 events remain queryable

#### Scenario: SurrealDB outage does not lose events
Given SurrealDB becomes unavailable for 5 seconds
When the session produces 8 events during the outage
Then events are buffered in memory
And flushed to SurrealDB when connectivity returns
And zero events are lost

### Acceptance Criteria
- [ ] `SessionPersistDriver` interface fully implemented (5 methods)
- [ ] Session records stored in SurrealDB with correct schema
- [ ] Events persisted in chronological order with full payload
- [ ] Handles 50 events/second without backpressure
- [ ] Buffers events during brief SurrealDB outages (< 30 seconds)

### Outcome KPIs
- **Who**: Developers with long-running coding sessions
- **Does what**: Retain complete session history across server restarts
- **By how much**: 100% event persistence (zero silent drops)
- **Measured by**: Event count in SurrealDB vs event count emitted by SandboxAgent
- **Baseline**: Current: 0% persistence (in-memory only)

### Technical Notes
- Schema extension needed: `sandbox_session` and `sandbox_event` tables (or extend existing `agent_session`)
- Batch writes recommended for throughput (group events by 100ms window)
- SurrealDB's async event pattern (`DEFINE EVENT ASYNC`) may be useful for non-blocking writes
- The 5 driver methods: `getSession`, `listSessions`, `updateSession`, `listEvents`, `insertEvent`

---

## US-03: Event Bridge for SandboxAgent Events

### Problem
Rafael Torres cannot see what his coding agent is doing because the current event bridge is tightly coupled to Claude Agent SDK's `AsyncIterable<unknown>` message format. When the agent runs through SandboxAgent, events use a different universal schema that the bridge does not understand.

### Who
- Developer | Monitors coding agent in real time | Wants governance feed visibility

### Solution
Adapt `orchestrator/event-bridge.ts` to translate SandboxAgent's universal event schema (tool calls, file edits, permission requests) to Brain's SSE registry format and trace graph entities.

### Domain Examples
#### 1: Happy Path -- Tool call event appears in feed
The agent calls `brain-search("rate limiting middleware")` via MCP. SandboxAgent emits a `tool_call` event with tool name, arguments, and result. The event bridge translates it to Brain's event format and pushes to the SSE registry. Rafael sees "Tool Call: brain-search (340ms)" in the governance feed within 500ms.

#### 2: Edge Case -- Permission request event
The agent requests permission to run `bash("npm test")`. SandboxAgent emits a `permission_request` event. The event bridge translates it to a UI-actionable permission prompt. Rafael sees "Permission Request: bash(npm test)" with Approve/Reject buttons.

#### 3: Error/Boundary -- Unknown event type
SandboxAgent emits an event type not in Brain's schema (e.g., a new event type added in a SDK update). The bridge logs a warning "Unknown SandboxAgent event type: agent_thinking" and skips it without crashing. The event is still persisted raw by the persistence driver.

### UAT Scenarios (BDD)

#### Scenario: Tool call event streamed to governance feed
Given Rafael is watching the governance feed for session "rate-limiter-a1b2"
When the agent calls brain-search via the MCP endpoint
Then a tool_call event appears in Rafael's SSE stream within 500ms
And the event shows tool name "brain-search", arguments, and duration
And a trace record is created linking the tool call to the session

#### Scenario: File edit event streamed to governance feed
Given the agent creates file "rate-limiter.ts" with 45 lines
When SandboxAgent emits a file_edit event
Then the governance feed shows "File Edit: rate-limiter.ts (created, 45 lines)"
And the trace graph records the file path and change type

#### Scenario: Permission request surfaces in UI
Given Claude Code requests permission to run bash("rm -rf /tmp/cache")
When SandboxAgent emits a permission_request event
Then Rafael sees the request in the coding session UI
And can choose "Approve Once", "Approve Always", or "Reject"
And the response is sent back via session.respondPermission()

#### Scenario: Unknown event type handled gracefully
Given SandboxAgent emits an event type "agent_thinking" not in Brain's schema
When the event bridge processes it
Then a warning is logged "Unknown SandboxAgent event type: agent_thinking"
And the bridge continues processing subsequent events
And the raw event is persisted by the persistence driver

### Acceptance Criteria
- [ ] SandboxAgent tool_call, file_edit, and permission_request events translated correctly
- [ ] Events appear in SSE stream within 500ms of emission
- [ ] Trace records created for tool calls and file edits
- [ ] Permission requests surface in UI with Approve/Reject controls
- [ ] Unknown event types logged and skipped without crashing

### Outcome KPIs
- **Who**: Developers monitoring coding agent activity
- **Does what**: See real-time agent events in the governance feed
- **By how much**: < 500ms latency from event emission to SSE delivery
- **Measured by**: Timestamp difference between SandboxAgent event and SSE delivery
- **Baseline**: Current: event bridge works but only for Claude Agent SDK format

### Technical Notes
- `orchestrator/event-bridge.ts` is the primary file to modify
- SandboxAgent uses a universal event schema across all agent types
- The bridge must handle both real-time streaming (`session.onEvent()`) and historical pagination
- Permission response uses `session.respondPermission(id, decision)`

---

## US-04: Multi-Turn Prompts via session.prompt()

### Problem
Rafael Torres cannot send follow-up prompts to a running coding agent. When his agent produces work that needs correction, he must start an entirely new session, re-explain the context, and wait for the agent to re-read all files. The current `POST .../prompt` endpoint returns 409 Conflict because Claude Agent SDK does not support multi-turn.

### Who
- Developer | Iterative coding workflow | Wants to course-correct agents without respawning

### Solution
Wire `POST .../prompt` to `session.prompt()` from SandboxAgent SDK, which supports sending follow-up prompts to an active session while preserving full conversation context.

### Domain Examples
#### 1: Happy Path -- Rafael sends a follow-up to refine implementation
Rafael's session created rate-limiter.ts with in-memory state. He sends: "Use SurrealDB for distributed state instead of in-memory." The follow-up is delivered to the same session. The agent modifies rate-limiter.ts with SurrealDB counter logic, retaining context about the endpoint, the sliding window algorithm, and the 100 req/min limit.

#### 2: Edge Case -- Follow-up while agent is still processing
Rafael sends a follow-up while the agent is still processing the previous prompt. The prompt is queued and delivered when the agent finishes current work. Rafael receives 202 Accepted, not 409 Conflict.

#### 3: Error/Boundary -- Session has been destroyed
Rafael tries to send a follow-up to session "rate-limiter-a1b2" which was already concluded. The endpoint returns 404 "Session not found or already concluded" with suggestion to start a new session.

### UAT Scenarios (BDD)

#### Scenario: Follow-up prompt delivered to existing session
Given Rafael has an active session "rate-limiter-a1b2" with Claude Code
And the agent created rate-limiter.ts from the first prompt
When Rafael sends "Use SurrealDB for distributed state instead of in-memory"
Then the follow-up is delivered to the same session via session.prompt()
And the agent modifies rate-limiter.ts with SurrealDB logic
And the agent retains context from the first prompt (endpoint, algorithm, limit)

#### Scenario: Follow-up queued during active processing
Given session "rate-limiter-a1b2" is currently processing a prompt
When Rafael sends another follow-up via POST .../prompt
Then the endpoint returns 202 Accepted
And the follow-up is delivered after current processing completes
And Rafael does not receive a 409 Conflict

#### Scenario: Follow-up to concluded session returns 404
Given session "rate-limiter-a1b2" has been concluded
When Rafael sends a follow-up via POST .../prompt
Then the endpoint returns 404 "Session not found or already concluded"
And suggests starting a new coding session

#### Scenario: Third prompt in a multi-turn sequence
Given Rafael has sent 2 prompts to session "rate-limiter-a1b2"
When he sends "Run tests and fix any failures"
Then the agent has full context from all 3 prompts
And runs tests related to the rate limiter with SurrealDB backend
And fixes failures while preserving the distributed state design

### Acceptance Criteria
- [ ] POST .../prompt delivers follow-up via session.prompt() (not 409)
- [ ] Agent retains full context from previous prompts
- [ ] Concurrent prompts queued with 202 Accepted
- [ ] Concluded sessions return 404 with helpful message
- [ ] Multi-turn chain works for 3+ prompts

### Outcome KPIs
- **Who**: Developers iterating on coding tasks
- **Does what**: Send follow-up prompts without respawning sessions
- **By how much**: 0% prompt rejection rate (down from 100% via 409)
- **Measured by**: HTTP status codes on POST .../prompt endpoint
- **Baseline**: Current: 100% rejection (409 on every follow-up attempt)

### Technical Notes
- `orchestrator/routes.ts` needs the prompt handler rewritten
- `session.prompt()` accepts the same message format as `createSession`
- Queue semantics: SandboxAgent SDK may handle queuing internally; verify behavior
- Context window limits: long multi-turn chains may require truncation strategy

---

## US-05: Session Restoration from Persisted Events

### Problem
Rafael Torres loses a 30-minute coding session when the network briefly drops. The in-memory handle registry has no recovery mechanism -- the session is simply gone. He must start over, re-explain the task, and wait for the agent to re-read all files. This costs 10-15 minutes of duplicated work per incident.

### Who
- Developer | Long-running sessions (15-60 min) | Wants resilience to transient failures

### Solution
Use SandboxAgent SDK's `resumeSession()` with automatic event replay from the SurrealDB persistence driver. When a connection drops, the SDK creates a fresh session, rebinds the logical session ID, and replays recent events as context.

### Domain Examples
#### 1: Happy Path -- Network timeout triggers auto-restore
Rafael's session "rate-limiter-a1b2" has been active for 12 minutes with 23 events persisted. A network timeout disconnects the sandbox connection. The SDK detects the disconnect, calls `resumeSession()`, creates a fresh sandbox session, replays 23 events (8,400 chars), and rebinds the session ID. Rafael sees "Session temporarily interrupted. Restored automatically." in the UI. His next prompt works without re-explaining the task.

#### 2: Edge Case -- Server restart with persisted sessions
Brain's server restarts during Rafael's session. On startup, the orchestrator loads active sessions from SurrealDB and reconnects via `sdk.resumeSession()`. Rafael's session is available within 10 seconds of server restart.

#### 3: Error/Boundary -- Event replay exceeds context limits
Rafael's long session has 200 events (50,000 chars). Replay is capped at 50 events / 12,000 chars by default. The SDK replays the most recent 50 events. Some early context is lost but the agent retains the most relevant recent work. Rafael is notified: "Session restored with recent context (50 of 200 events replayed)."

### UAT Scenarios (BDD)

#### Scenario: Auto-restore after network timeout
Given Rafael's session "rate-limiter-a1b2" has 23 events in SurrealDB
When the network connection to the sandbox is lost
Then the SDK creates a fresh session in the sandbox
And rebinds session ID "rate-limiter-a1b2" to the new runtime ID
And replays 23 events (8,400 characters) as context
And Rafael sees "Session temporarily interrupted. Restored automatically."
And his next prompt works without re-explaining the task

#### Scenario: Session restoration after server restart
Given Rafael's session has 47 events in SurrealDB with status "active"
When Brain's server restarts
Then the orchestrator loads active sessions from SurrealDB
And reconnects each via sdk.resumeSession()
And Rafael's session is available within 10 seconds

#### Scenario: Large session replay capped at configured limits
Given session "analytics-refactor" has 200 events (50,000 characters)
When a connection drop triggers restoration
Then the SDK replays the most recent 50 events (12,000 characters)
And Rafael is notified "Session restored with recent context (50 of 200 events)"
And the agent retains context from the most recent work

#### Scenario: Restoration fails when sandbox provider is unavailable
Given the E2B provider is experiencing an outage
When the SDK attempts to create a fresh session for restoration
Then the restoration fails with "Sandbox provider unavailable"
And Rafael is notified "Session restoration failed -- sandbox provider offline"
And the session remains in SurrealDB for retry when the provider recovers

### Acceptance Criteria
- [ ] Sessions auto-restore after network timeout without user action
- [ ] Active sessions restored on server restart within 10 seconds
- [ ] Event replay uses persisted events from SurrealDB persistence driver
- [ ] Replay respects configurable limits (default: 50 events / 12,000 chars)
- [ ] User notified of restoration status (success or failure)
- [ ] > 95% restoration success rate for sessions with persisted events

### Outcome KPIs
- **Who**: Developers with long-running coding sessions
- **Does what**: Continue working after transient failures without re-prompting
- **By how much**: > 95% session restoration success rate
- **Measured by**: Restoration attempts vs successful restorations in trace graph
- **Baseline**: Current: 0% restoration (sessions lost on any disconnection)

### Technical Notes
- SandboxAgent SDK handles restoration internally given a persistence driver
- `replayMaxEvents` (default 50) and `replayMaxChars` (default 12,000) are configurable
- Server restart restoration requires loading active sessions from SurrealDB on boot
- The persistence driver (US-02) is a hard dependency

---

## US-06: Dynamic MCP Endpoint per Agent Session

### Problem
Brain's orchestrator currently bundles the Brain CLI as a stdio MCP server inside the agent process. This approach does not work for Docker or E2B sandboxes where the CLI binary is not available, and it exposes entire MCP servers rather than filtering tools by agent grants.

### Who
- Brain Orchestrator | Governs agent tool access | Needs per-agent filtered MCP endpoint

### Solution
Register a dynamic MCP endpoint (`/mcp/agent/<name>`) per agent session. The endpoint filters `tools/list` by the agent's effective toolset, evaluates policy on `tools/call`, injects credentials via broker, and forwards to upstream MCP servers.

### Domain Examples
#### 1: Happy Path -- Agent discovers only granted tools
Agent "claude-rate-limiter" has grants for [github, slack, brain-search]. The upstream MCP servers expose 15 total tools. When the agent calls `tools/list` on `/mcp/agent/claude-rate-limiter-a1b2`, it receives only the 4 tools from its granted servers. Tools from jira, confluence, and other servers are not listed.

#### 2: Edge Case -- Tool call requires OAuth credential injection
The agent calls `github:create-branch("feat/rate-limiting")`. Brain's MCP endpoint evaluates the policy (approved -- github grant active), looks up Rafael's GitHub OAuth token from the credential store, injects it into the upstream MCP call, and returns the branch creation result to the agent.

#### 3: Error/Boundary -- Tool call rejected by policy
Agent "claude-rate-limiter" attempts `admin:delete-workspace`. The admin tool is not in the agent's effective toolset. The endpoint rejects the call: "Tool admin:delete-workspace not in agent's granted scope." The rejection is recorded in the trace graph.

### UAT Scenarios (BDD)

#### Scenario: MCP endpoint serves only granted tools
Given agent "claude-rate-limiter" has grants for [github, slack, brain-search]
And upstream MCP servers expose 15 total tools
When the coding agent calls tools/list on /mcp/agent/claude-rate-limiter-a1b2
Then only tools from [github, slack, brain-search] are returned
And tools from non-granted servers are not listed

#### Scenario: Tool call with OAuth credential injection
Given agent "claude-rate-limiter" calls github:create-branch
When the MCP endpoint evaluates the policy
Then the policy approves the call (github grant is active)
And Rafael's GitHub OAuth token is injected from the credential store
And the branch is created on GitHub
And the tool result is returned to the agent

#### Scenario: Unauthorized tool call rejected
Given agent "claude-rate-limiter" attempts admin:delete-workspace
When the MCP endpoint evaluates the call
Then it rejects with "Tool not in agent's granted scope"
And the rejection is recorded in the trace graph
And the agent receives an error response

#### Scenario: MCP endpoint configured via SandboxAgent setMcpConfig
Given a session "rate-limiter-a1b2" is being spawned
When the orchestrator registers the MCP endpoint
Then setMcpConfig is called with type "remote", the endpoint URL, and the agent token
And the coding agent discovers the endpoint as an MCP server named "brain"

### Acceptance Criteria
- [ ] Dynamic MCP endpoint registered per session at `/mcp/agent/<name>`
- [ ] `tools/list` returns only tools from the agent's effective toolset
- [ ] `tools/call` evaluates policy graph before forwarding
- [ ] OAuth credentials injected by credential broker for tool calls
- [ ] Unauthorized tool calls rejected with clear error and trace record
- [ ] Endpoint configured via `setMcpConfig()` with agent token auth

### Outcome KPIs
- **Who**: Brain orchestrator governing agent tool access
- **Does what**: Enforce per-agent tool filtering and policy evaluation for sandbox agents
- **By how much**: 100% of MCP tool calls go through policy evaluation
- **Measured by**: Trace records with policy evaluation results per tool call
- **Baseline**: Current: MCP governance via stdio CLI (works but not for cloud sandboxes)

### Technical Notes
- Builds on MCP tool registry (#183) infrastructure
- Grant resolution: `can_use` union `possesses->skill_requires` (existing logic)
- The endpoint must handle both `tools/list` and `tools/call` MCP methods
- Token auth via `X-Brain-Auth` header (existing pattern)
- This is the same governance logic as Brain-native agents, different integration pattern

---

## US-07: Permission Request Handling

### Problem
Rafael Torres has no way to approve or reject individual tool permission requests from coding agents. The current orchestrator uses `bypassPermissions: true`, meaning all tool calls execute without user consent. This is acceptable for Brain-governed MCP tools (which go through policy evaluation) but not for native sandbox tools (bash, file operations) that execute ungoverned.

### Who
- Developer | Supervising coding agent execution | Wants granular approve/reject for sensitive operations

### Solution
Map SandboxAgent's `onPermissionRequest()` events to Brain's UI, allowing users to approve once, approve always, or reject. Auto-approve permissions that fall within the agent's granted scope.

### Domain Examples
#### 1: Happy Path -- Auto-approve in-scope bash command
Agent "claude-rate-limiter" has bash execution in its grant scope. The agent requests permission to run `npm test`. The orchestrator auto-approves (bash is granted). The approval is logged in the trace graph. Rafael is not interrupted.

#### 2: Edge Case -- User manually approves destructive command
The agent requests permission to run `rm -rf /tmp/cache`. This is a destructive bash command outside auto-approve scope. Rafael sees the permission request in the UI with the full command. He clicks "Approve Once". The command executes and the one-time approval is recorded.

#### 3: Error/Boundary -- Permission request timeout
The agent requests permission to run a command. Rafael is away. After 60 seconds, the permission times out. The agent receives a rejection response and attempts an alternative approach or reports the timeout in its output.

### UAT Scenarios (BDD)

#### Scenario: Auto-approve bash within granted scope
Given agent "claude-rate-limiter" has bash execution in its grant scope
When Claude Code requests permission to run bash("npm test")
Then the orchestrator auto-approves the permission
And the approval is recorded in the trace graph
And Rafael is not interrupted

#### Scenario: Manual approval for destructive operation
Given the agent requests permission to run bash("rm -rf /tmp/cache")
And destructive commands are not in the auto-approve scope
When Rafael sees the permission request in the coding session UI
And clicks "Approve Once"
Then the command executes in the sandbox
And the one-time approval is recorded in the trace graph

#### Scenario: Permission rejection
Given the agent requests permission to run bash("curl evil-server.com")
When Rafael clicks "Reject"
Then the agent receives a rejection response
And the rejection is recorded in the trace graph
And the agent adapts or reports the blocked operation

#### Scenario: Permission request timeout
Given the agent requests permission and Rafael is unavailable
When 60 seconds pass without a response
Then the permission is auto-rejected with "timeout"
And the agent receives a rejection and handles it gracefully

### Acceptance Criteria
- [ ] Permission requests surface in coding session UI within 500ms
- [ ] Users can Approve Once, Approve Always, or Reject
- [ ] In-scope permissions auto-approved without user interruption
- [ ] Permission decisions recorded in trace graph
- [ ] 60-second timeout with auto-reject for unresponsive users

### Outcome KPIs
- **Who**: Developers supervising coding agent execution
- **Does what**: Make informed approve/reject decisions on agent permission requests
- **By how much**: < 5 second average response time for permission decisions
- **Measured by**: Time between permission request and user response in trace graph
- **Baseline**: Current: all permissions auto-approved (bypassPermissions: true)

### Technical Notes
- SandboxAgent provides `session.onPermissionRequest()` and `session.respondPermission(id, decision)`
- Decision types: "once" (one-time), "always" (session-scoped), "reject"
- Auto-approve logic should check agent's grant scope for the requested operation
- Timeout configurable (default 60s)
- Permission requests bridged through SSE registry to UI
