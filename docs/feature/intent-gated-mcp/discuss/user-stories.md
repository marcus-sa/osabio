<!-- markdownlint-disable MD024 -->

# User Stories: Intent-Gated MCP Tool Access

---

## US-01: Dynamic tools/list with Effective Scope

### Problem
A sandbox coding agent (e.g., "claude-coder-7f3a" working on billing-service for Rafael Oliveira) has no way to discover which governed MCP tools it can call and which require escalation. Without a dynamic tools/list, the agent either calls tools blindly (getting 403s) or avoids governed tools entirely, losing access to integrations like GitHub, Stripe, and Jira.

### Who
- Sandbox coding agent | Working on a task in an isolated session | Needs to discover available tools to plan its approach

### Solution
Dynamic MCP endpoint at `/mcp/agent/<session-name>` responds to tools/list by computing the effective scope from the session's linked intents, returning authorized tools as callable and gated tools with enriched descriptions instructing the agent to create an intent first.

### Domain Examples
#### 1: Agent with one authorized intent
Agent "claude-coder-7f3a" has an authorized intent for "github:create_pr" on repo "acme/billing-service". tools/list returns: github:create_pr (callable), stripe:create_refund (gated -- description enrichment: "This tool is gated. To use it, call the create_intent tool with provider 'stripe', action 'create_refund', and include your goal and reasoning. The intent will be evaluated against workspace policies."), plus Brain-native tools (create_intent, get_context).

#### 2: Agent with no intents (fresh session)
Agent "codex-worker-b2e1" just spawned for task "implement-rate-limiting". No intents exist. tools/list returns: only Brain-native tools (create_intent, get_context) plus all registered MCP tools marked as gated with intent instructions.

#### 3: Agent with multiple intents including composite
Agent "claude-coder-7f3a" has two authorized intents: one for "github:create_pr" and a composite for "stripe:list_charges" + "stripe:create_refund". tools/list returns all three Stripe/GitHub tools as callable, remaining registry tools as gated.

### UAT Scenarios (BDD)

#### Scenario: Authorized tool appears as callable
Given session "claude-coder-7f3a" has an authorized intent for "github:create_pr"
When the agent sends tools/list via the dynamic MCP endpoint
Then "github:create_pr" appears in the response with full tool definition
And the tool is not marked as gated

#### Scenario: Unauthorized tool appears as gated with instructions
Given session "claude-coder-7f3a" has no intent for "stripe:create_refund"
And "stripe:create_refund" exists in the mcp_tool registry
When the agent sends tools/list via the dynamic MCP endpoint
Then "stripe:create_refund" appears with gated indicator
And the tool description includes instructions to call create_intent

#### Scenario: Brain-native tools always present
Given any valid session with a proxy token
When the agent sends tools/list via the dynamic MCP endpoint
Then "create_intent" and "get_context" appear as callable tools
And they are not marked as gated

#### Scenario: Invalid proxy token rejected
Given a request with an expired or invalid proxy token
When the agent sends tools/list
Then the endpoint returns 401 Unauthorized

### Acceptance Criteria
- [ ] tools/list computes effective scope from session's gates edges and authorized intents
- [ ] Authorized tools returned with full MCP tool definition
- [ ] Gated tools returned with enriched description containing create_intent instructions
- [ ] Brain-native tools (create_intent, get_context) always included
- [ ] Invalid/expired proxy token returns 401

### Outcome KPIs
- **Who**: Sandbox coding agents
- **Does what**: Discover their effective tool scope on first tools/list call
- **By how much**: 100% of tools/list calls return within 500ms with correct scope
- **Measured by**: OTel span duration for tools/list handler
- **Baseline**: N/A (endpoint does not exist)

### Technical Notes
- Depends on: sandbox-agent-integration R2 (proxy_token with session field)
- Prerequisite: mcp_tool registry populated (upstream MCP server registry is a separate feature)
- Scope computation must be the SAME function used by tools/call (shared module)
- `gates` edge schema: `DEFINE TABLE gates TYPE RELATION FROM agent_session TO intent SCHEMAFULL;`
- tools/list response follows MCP protocol spec for ListToolsResult

---

## US-02: Authorized tools/call with Upstream Forwarding

### Problem
Agent "claude-coder-7f3a" has an authorized intent to create a pull request on "acme/billing-service" but has no way to execute the tool call through Brain's governance pipeline. Without governed forwarding, the agent either can't use external tools at all or would need direct upstream access (bypassing governance).

### Who
- Sandbox coding agent | Has authorized intents for specific tools | Needs to execute tool calls that are forwarded to upstream MCP servers with trace recording

### Solution
tools/call on the dynamic MCP endpoint checks the effective scope, validates constraints, forwards the JSON-RPC call to the upstream MCP server, records a trace, and returns the result.

### Domain Examples
#### 1: GitHub PR creation succeeds
Agent "claude-coder-7f3a" calls tools/call for "github:create_pr" with repo "acme/billing-service", title "Add rate limiting", branch "feature/rate-limit". Scope check passes (intent authorizes github:create_pr for this repo). Call forwarded to GitHub MCP server. PR #247 created. Trace recorded. Agent receives PR URL.

#### 2: Stripe refund within bounds
Agent "claude-coder-7f3a" calls tools/call for "stripe:create_refund" with amount 3000 (cents), currency "usd", charge "ch_3T2M". Intent authorizes up to 5000 cents USD. Constraint check: 3000 <= 5000 (pass), "usd" == "usd" (pass). Forwarded to Stripe. Refund "re_9X1K" created. Trace recorded.

#### 3: Upstream server timeout
Agent "codex-worker-b2e1" calls tools/call for "jira:create_issue" with project "BILL", summary "Rate limiter config". Scope check passes. Forwarded to Jira MCP server. Server does not respond within 30 seconds. Agent receives 504 timeout. Trace recorded with status "timeout". Intent remains authorized for retry.

### UAT Scenarios (BDD)

#### Scenario: Authorized tool call forwarded and traced
Given session "claude-coder-7f3a" has an authorized intent for "github:create_pr"
When the agent calls tools/call for "github:create_pr" with repo "acme/billing-service"
Then the call is forwarded to the upstream GitHub MCP server
And the agent receives the tool result with PR details
And a trace record exists linking the call to the session and intent

#### Scenario: Tool call for unauthorized tool rejected
Given session "claude-coder-7f3a" has no intent authorizing "stripe:create_refund"
When the agent calls tools/call for "stripe:create_refund"
Then the agent receives a 403 error with code "intent_required"
And no call is forwarded to the upstream Stripe MCP server

#### Scenario: Upstream failure returns error and records trace
Given session "claude-coder-7f3a" has an authorized intent for "jira:create_issue"
When the agent calls tools/call for "jira:create_issue"
And the upstream Jira MCP server returns an error
Then the agent receives the error in MCP CallToolResult format
And a trace record is created with the error details

#### Scenario: Every tools/call produces a trace record
Given session "claude-coder-7f3a" makes 5 tool calls
When 3 succeed and 2 fail
Then 5 trace records exist in the graph
And each trace links to the session and the authorizing intent

### Acceptance Criteria
- [ ] tools/call checks effective scope using same computation as tools/list
- [ ] Authorized calls forwarded to upstream MCP server via JSON-RPC
- [ ] Tool result returned to agent in MCP CallToolResult format
- [ ] Every tools/call (success, failure, rejected) produces a trace record
- [ ] Trace links to session (invoked edge) and intent (authorized_by edge)
- [ ] Unauthorized tool calls return 403 intent_required (not forwarded)

### Outcome KPIs
- **Who**: Sandbox coding agents
- **Does what**: Complete governed tool calls end-to-end
- **By how much**: 95% success rate for authorized calls
- **Measured by**: Trace records: completed / (completed + failed + timeout)
- **Baseline**: 0% (no governed MCP access exists)

### Technical Notes
- Depends on: US-01 (scope computation), upstream MCP server registry
- NFR: Brain overhead (scope computation + constraint check + trace write) must be <100ms. Total tools/call latency = Brain overhead + upstream MCP server response time. Upstream latency varies by provider and is outside Brain's control.
- Upstream MCP connection management: connection pooling or per-request connections (DESIGN wave decision)
- Trace schema: extends existing tool_call trace pattern from proxy/tool-trace-writer.ts
- JSON-RPC forwarding must preserve the original request id

---

## US-03: Gated Tool Escalation via create_intent

### Problem
Agent "claude-coder-7f3a" needs to issue a Stripe refund but the tool is not in its current scope. Without a self-service escalation mechanism, the agent is stuck -- it received a 403 but has no way to request access. A human would have to manually create the intent, defeating the purpose of autonomous operation.

### Who
- Sandbox coding agent | Encountered a gated tool it needs | Needs to self-escalate by creating an intent with goal, reasoning, and action specification

### Solution
A Brain-native MCP tool "create_intent" that the agent calls with goal, reasoning, and action_spec. The tool creates an intent, auto-submits it through the policy gate, and returns the result (authorized, pending_veto, or vetoed). On authorization, a `gates` edge links the intent to the session.

### Domain Examples
#### 1: Auto-approved intent (read operation)
Agent "claude-coder-7f3a" received 403 for "github:list_repos". Calls create_intent with goal "List repositories to find the billing service repo", reasoning "Task requires me to locate the correct repository before making changes", action_spec { provider: "github", action: "list_repos" }. Policy: read operations auto-approve. Intent created, evaluated, authorized. Gates edge created. Agent retries tools/call -- succeeds.

#### 2: Intent requiring human veto (financial operation)
Agent "claude-coder-7f3a" received 403 for "stripe:create_refund". Calls create_intent with goal "Refund customer Elena Vasquez $50 for defective widget order #4891", reasoning "Customer filed complaint, product confirmed defective, refund within policy limit", action_spec { provider: "stripe", action: "create_refund", params: { amount: 5000, currency: "usd" } }. Policy: financial writes require veto. Intent created, evaluated, pending_veto. Gates edge created. Agent receives pending_veto status.

#### 3: Intent denied by policy
Agent "codex-worker-b2e1" calls create_intent for "production-db:execute_query" with goal "Check order table for customer data". Policy: production database access denied for all agents. Intent created, evaluated, vetoed immediately with reason "Policy 'prod-db-lockout' denies all agent access to production-db provider". Agent receives vetoed status and adapts.

### UAT Scenarios (BDD)

#### Scenario: Auto-approved intent grants immediate access
Given workspace policy auto-approves "github:list_repos" for agents
When agent "claude-coder-7f3a" calls create_intent with provider "github" action "list_repos"
Then an intent is created with status authorized
And a gates edge links the session to the intent
And the agent receives { intent_id, status: "authorized" }

#### Scenario: Veto-required intent returns pending status
Given workspace policy requires human veto for "stripe:create_refund"
When agent "claude-coder-7f3a" calls create_intent with provider "stripe" action "create_refund" params { amount: 5000, currency: "usd" }
Then an intent is created with status pending_veto
And a gates edge links the session to the intent
And the agent receives { intent_id, status: "pending_veto" }

#### Scenario: Policy-denied intent returns vetoed with reason
Given workspace policy denies all access to provider "production-db"
When agent "codex-worker-b2e1" calls create_intent with provider "production-db" action "execute_query"
Then an intent is created and immediately vetoed
And the agent receives { intent_id, status: "vetoed", reason: "Policy denies access to production-db" }
And no gates edge is created

#### Scenario: create_intent includes action_spec from 403 template
Given agent received 403 intent_required with action_spec_template for "stripe:create_refund"
When the agent calls create_intent using the template fields plus its own goal and reasoning
Then the intent's action_spec matches the template structure
And the policy gate can evaluate the intent

#### Scenario: Gates edge enables subsequent tools/call
Given agent "claude-coder-7f3a" received authorized status from create_intent for "github:list_repos"
When the agent calls tools/call for "github:list_repos"
Then the effective scope includes the new intent
And the call is forwarded to the upstream GitHub MCP server

### Acceptance Criteria
- [ ] create_intent tool available as Brain-native MCP tool on every session
- [ ] Accepts goal (string), reasoning (string), action_spec (provider, action, params)
- [ ] Creates intent in draft, auto-submits to pending_auth, runs policy evaluation
- [ ] Returns intent_id and final status (authorized, pending_veto, or vetoed)
- [ ] On authorized: gates edge created linking session to intent
- [ ] On pending_veto: gates edge created, agent informed to yield
- [ ] On vetoed: no gates edge, reason included in response

### Outcome KPIs
- **Who**: Sandbox coding agents
- **Does what**: Self-escalate for gated tools via create_intent
- **By how much**: 90% of 403 intent_required responses followed by create_intent call
- **Measured by**: Intent creation count / 403 response count per session
- **Baseline**: 0% (no escalation mechanism exists)

### Technical Notes
- Depends on: existing intent system (intent-queries, status-machine, policy-gate, authorizer)
- create_intent is a Brain-native MCP tool (not an upstream tool) -- always available
- Intent's `authorization_details` derived from action_spec (same mapping as research doc Finding 2)
- The tool should create AND submit in one call (draft -> pending_auth is internal)

---

## US-04: Human Veto Flow for Pending Intents

### Problem
Agent "claude-coder-7f3a" created an intent to refund customer Elena Vasquez $50, and the policy requires human approval. The intent is in pending_veto state but operator Carla Mendes has no way to see, review, and act on it. Without surfacing pending intents to humans, the agent is permanently blocked.

### Who
- Human operator (Carla Mendes) | Manages a workspace with coding agents | Needs to review and approve/veto high-risk tool call requests from agents

### Solution
Pending intents surface in the existing governance feed with full context (goal, reasoning, tool details, risk score). The operator can approve or veto through the existing intent approval endpoints. The intent state transition triggers downstream effects (scope update, observer resume).

### Domain Examples
#### 1: Operator approves refund intent
Carla sees in the feed: "Agent claude-coder-7f3a requests: Refund customer Elena Vasquez $50 for defective widget order #4891. Tool: stripe:create_refund. Risk: 25/100. Reasoning: Customer filed complaint, product confirmed defective." Carla approves. Intent transitions to authorized.

#### 2: Operator vetoes intent with reason
Carla sees: "Agent codex-worker-b2e1 requests: Delete GitHub repository acme/legacy-billing. Tool: github:delete_repo. Risk: 85/100." Carla vetoes with reason: "Repository still has active dependents. Discuss with team first." Intent transitions to vetoed.

#### 3: Veto window expires without action
Agent "claude-coder-7f3a" created intent for "github:create_pr" with 30-minute veto window. 30 minutes pass with no human action. Intent auto-approves per workspace configuration.

### UAT Scenarios (BDD)

#### Scenario: Pending intent surfaces in governance feed
Given agent "claude-coder-7f3a" created intent for "stripe:create_refund" with pending_veto status
When operator Carla Mendes views the governance feed for workspace "Acme Engineering"
Then the feed includes the pending intent with goal, reasoning, tool details, and risk score

#### Scenario: Operator approves intent
Given a pending_veto intent for "stripe:create_refund" amount 5000 USD
When Carla Mendes approves the intent
Then the intent transitions to authorized
And the intent's authorization_details are finalized

#### Scenario: Operator vetoes intent with reason
Given a pending_veto intent for "github:delete_repo"
When Carla Mendes vetoes with reason "Repository has active dependents"
Then the intent transitions to vetoed
And the veto reason is stored on the intent record

#### Scenario: Veto window expiry auto-approves
Given a pending_veto intent with a 30-minute veto window
When 30 minutes pass without human action
Then the intent auto-transitions to authorized

### Acceptance Criteria
- [ ] Pending intents appear in governance feed with full context
- [ ] Approve endpoint transitions intent from pending_veto to authorized
- [ ] Veto endpoint transitions intent with reason from pending_veto to vetoed
- [ ] Veto window expiry auto-approves (configurable per workspace)
- [ ] Intent state changes are observable by downstream systems (observer, scope computation)

### Outcome KPIs
- **Who**: Human operators
- **Does what**: Approve or veto pending intents within the veto window
- **By how much**: 80% of pending_veto intents resolved by humans before timeout
- **Measured by**: Intent state transitions: (human_approved + human_vetoed) / total pending_veto
- **Baseline**: N/A (no veto flow for MCP tools exists)

### Technical Notes
- Depends on: existing intent approval endpoints (intent-routes.ts), governance feed infrastructure
- Veto window duration configurable per workspace (existing veto-manager.ts)
- Feed card should show: agent name, task context, tool name, parameters, risk score, reasoning
- Existing intent approve/veto endpoints may need minor extension for MCP-specific context display

---

## US-05: Observer Resume Trigger for Idle Sessions

### Problem
Agent "claude-coder-7f3a" yielded execution while waiting for human approval of a Stripe refund intent. Carla approved the intent, but the agent is still idle -- nothing tells it to resume. Without an automated resume mechanism, a human would have to manually re-prompt the agent, breaking the autonomous workflow.

### Who
- Observer agent | Scans graph for actionable patterns | Needs to detect authorized intents for idle sessions and trigger resume

### Solution
Observer includes a new scan pattern: find intents that transitioned to authorized (or vetoed) where the linked session (via gates edge) is idle. When found, the observer calls adapter.resumeSession to wake the agent.

### Domain Examples
#### 1: Approved intent triggers resume
Agent "claude-coder-7f3a" is idle. Carla approved its stripe:create_refund intent 10 seconds ago. Observer's next scan finds: intent authorized + session idle via gates edge. Observer calls adapter.resumeSession("claude-coder-7f3a"). Session transitions to active. Agent receives prompt context about the approved intent and retries the tool call.

#### 2: Vetoed intent triggers resume with veto context
Agent "codex-worker-b2e1" is idle. Carla vetoed its github:delete_repo intent. Observer scan finds: intent vetoed + session idle. Observer calls adapter.resumeSession with context about the veto. Agent receives veto information and adapts its approach.

#### 3: Multiple pending intents, one approved
Agent "claude-coder-7f3a" has two pending intents (stripe:create_refund and stripe:list_charges). Carla approves stripe:create_refund. Observer detects one authorized intent for the idle session and triggers resume. The agent can now call stripe:create_refund; stripe:list_charges remains pending.

### UAT Scenarios (BDD)

#### Scenario: Observer detects authorized intent and resumes session
Given session "claude-coder-7f3a" is in idle status
And its pending_veto intent just transitioned to authorized
When the observer performs a graph scan
Then the observer detects the authorized intent linked to the idle session
And calls adapter.resumeSession for "claude-coder-7f3a"
And the session transitions from idle to active

#### Scenario: Observer resumes session after veto
Given session "codex-worker-b2e1" is in idle status
And its pending_veto intent just transitioned to vetoed
When the observer performs a graph scan
Then the observer detects the vetoed intent linked to the idle session
And calls adapter.resumeSession with veto context
And the session transitions from idle to active

#### Scenario: Observer does not resume non-idle sessions
Given session "claude-coder-7f3a" is in active status (not idle)
And an intent linked to it transitions to authorized
When the observer performs a graph scan
Then the observer does NOT call adapter.resumeSession
And the session remains active (agent will discover new scope on next tools/list)

### Acceptance Criteria
- [ ] Observer scan pattern: find intents with recent state change (authorized or vetoed) linked to idle sessions via gates edge
- [ ] On match: observer calls adapter.resumeSession(sessionId) with context
- [ ] Resume prompt includes information about the intent decision (approved tool + constraints, or veto reason)
- [ ] Observer does not resume already-active sessions
- [ ] Observer scan runs on configurable interval (existing observer scheduling)

### Outcome KPIs
- **Who**: Idle sessions waiting on veto
- **Does what**: Resume within 60 seconds of intent authorization
- **By how much**: 95% of sessions resume within 60s
- **Measured by**: Time delta: intent.updated_at (authorized) to session status change (idle -> active)
- **Baseline**: N/A

### Technical Notes
- Depends on: US-04 (intent approval), existing observer infrastructure, adapter.resumeSession
- Observer query: `SELECT in.id AS session_id, out.id AS intent_id, out.status FROM gates WHERE in.status = "idle" AND out.status IN ["authorized", "vetoed"] AND out.updated_at > $last_scan`
- Resume prompt should tell the agent: "Your intent for [tool] was [approved/vetoed]. [If approved: you can now call the tool. If vetoed: reason was X.]"
- Edge case: observer crash between detection and resume -- idempotent resume (calling resume on already-active session is a no-op)
- Fallback: if observer is unavailable, human operator can manually re-prompt the session via existing prompt endpoint. Observer resume is the automated happy path, not the only path.

---

## US-06: Constraint Enforcement on tools/call

### Problem
Agent "claude-coder-7f3a" has an authorized intent for stripe:create_refund with amount up to 5000 cents USD. But nothing stops the agent from calling create_refund with amount 7500 -- the authorization_details say 5000 but the actual call says 7500. Without constraint enforcement, policy evaluation at intent time is meaningless because the agent can exceed its authorization at call time.

### Who
- Sandbox coding agent | Has authorized intent with constraints | Needs tool calls validated against authorized bounds before upstream forwarding

### Solution
tools/call validates the arguments against the matching authorization_details entry's constraints before forwarding. Numeric constraints enforce upper bounds. String constraints enforce exact match. Violations return 403 constraint_violation.

### Domain Examples
#### 1: Amount within bounds passes
Agent calls stripe:create_refund with amount 3000, currency "usd". Intent authorizes up to 5000 USD. Check: 3000 <= 5000 (pass), "usd" == "usd" (pass). Call forwarded.

#### 2: Amount exceeding bounds rejected
Agent calls stripe:create_refund with amount 7500, currency "usd". Intent authorizes up to 5000 USD. Check: 7500 > 5000 (fail). 403 returned: "amount 7500 exceeds authorized maximum 5000". Call NOT forwarded. Trace recorded as constraint_violated.

#### 3: Currency mismatch rejected
Agent calls stripe:create_refund with amount 3000, currency "eur". Intent authorizes USD only. Check: "eur" != "usd" (fail). 403 returned: "currency 'eur' does not match authorized 'usd'". Call NOT forwarded.

### UAT Scenarios (BDD)

#### Scenario: Numeric constraint within bounds
Given an authorized intent for "stripe:create_refund" with constraint amount <= 5000
When the agent calls tools/call with amount 3000
Then the call is forwarded to the upstream Stripe MCP server

#### Scenario: Numeric constraint exceeded
Given an authorized intent for "stripe:create_refund" with constraint amount <= 5000
When the agent calls tools/call with amount 7500
Then the agent receives 403 constraint_violation
And the error includes "amount 7500 exceeds authorized maximum 5000"
And no call is forwarded upstream

#### Scenario: String constraint exact match
Given an authorized intent with constraint currency = "usd"
When the agent calls tools/call with currency "usd"
Then the call is forwarded

#### Scenario: String constraint mismatch
Given an authorized intent with constraint currency = "usd"
When the agent calls tools/call with currency "eur"
Then the agent receives 403 constraint_violation
And the error includes "currency 'eur' does not match authorized 'usd'"

### Acceptance Criteria
- [ ] Numeric constraints enforce upper bounds (requested <= authorized)
- [ ] String constraints enforce exact match (requested == authorized)
- [ ] Constraint violation returns 403 with specific field-level error details
- [ ] Constraint-violating calls are NOT forwarded to upstream
- [ ] Trace recorded with status "constraint_violated" for violations
- [ ] Reuses existing rar-verifier.ts constraint enforcement logic

### Outcome KPIs
- **Who**: Sandbox coding agents
- **Does what**: Receive clear constraint violation errors before calls reach upstream
- **By how much**: 100% of constraint violations caught before upstream forwarding
- **Measured by**: Zero upstream calls with parameters exceeding authorized constraints
- **Baseline**: N/A

### Technical Notes
- Depends on: US-02 (tools/call pipeline), existing rar-verifier.ts
- Reuse `verifyOperationScope` from rar-verifier.ts -- same numeric/string constraint logic
- Constraint fields are a subset of tool parameters (defined by policy, not all params)
- Missing constraint fields in the call should be treated as "unconstrained" (not as violation)

---

## US-07: Composite Intents for Multi-Step Tool Chains

### Problem
Agent "claude-coder-7f3a" needs to search Stripe charges and then issue a refund -- two tool calls that form a logical chain. Without composite intents, the agent must create two separate intents (each going through policy evaluation and potentially human veto), turning a simple "search then refund" workflow into a multi-step approval process with two yield-and-resume cycles.

### Who
- Sandbox coding agent | Planning a multi-step workflow involving multiple tools from the same provider | Needs to authorize the full chain in a single intent

### Solution
create_intent accepts an action_spec with multiple BrainAction entries in authorization_details. The policy gate evaluates the composite as a unit. Once authorized, all tools in the chain are in the effective scope.

### Domain Examples
#### 1: Search-then-refund chain authorized
Agent calls create_intent with goal "Find charge for customer Elena Vasquez and issue $50 refund", authorization_details: [{ action: "stripe:list_charges" }, { action: "stripe:create_refund", constraints: { amount: 5000, currency: "usd" } }]. Policy evaluates the composite: list_charges is read (low risk), create_refund is financial (requires veto). Composite gets veto requirement from highest-risk action. Intent approved after veto. Both tools now in scope.

#### 2: Homogeneous read chain auto-approved
Agent calls create_intent with goal "Gather project context", authorization_details: [{ action: "github:list_repos" }, { action: "github:get_repo" }, { action: "jira:list_issues" }]. All read operations. Policy auto-approves. Three tools in scope immediately.

#### 3: Composite with one denied action
Agent calls create_intent with authorization_details: [{ action: "github:create_pr" }, { action: "production-db:execute_query" }]. Policy denies production-db access. Entire composite is vetoed. Agent must split into separate intents.

### UAT Scenarios (BDD)

#### Scenario: Composite intent authorizes multiple tools
Given workspace policy allows both "stripe:list_charges" and "stripe:create_refund"
When agent "claude-coder-7f3a" creates a composite intent with both actions
Then the intent is evaluated as a unit
And both tools appear in the effective scope after authorization

#### Scenario: Composite evaluated at highest risk level
Given "stripe:list_charges" is auto-approve and "stripe:create_refund" requires veto
When the agent creates a composite intent with both actions
Then the intent requires human veto (driven by highest-risk action)

#### Scenario: One denied action vetoes entire composite
Given policy denies "production-db:execute_query"
When the agent creates a composite intent including "github:create_pr" and "production-db:execute_query"
Then the entire composite is vetoed
And the denial reason references the denied action

### Acceptance Criteria
- [ ] create_intent accepts multiple BrainAction entries in authorization_details
- [ ] Policy gate evaluates composite as a unit (highest risk determines handling)
- [ ] Authorized composite adds ALL actions to effective scope
- [ ] Denied composite rejects ALL actions (atomic -- no partial authorization)
- [ ] Composite intents produce single trace record (not per-action)

### Outcome KPIs
- **Who**: Sandbox coding agents
- **Does what**: Complete multi-tool chains with a single intent
- **By how much**: Agents with multi-tool needs create 1 composite intent instead of N individual intents
- **Measured by**: Ratio of composite intents / total intents for multi-tool sessions
- **Baseline**: N/A

### Technical Notes
- Depends on: US-03 (create_intent), existing authorization_details array support
- The intent table already supports `authorization_details: BrainAction[]` -- this is about allowing multiple entries
- Policy gate evaluation: iterate all BrainAction entries, take the most restrictive result
- If one action is denied and others are allowed, the composite is denied (fail-closed)

---

## US-08: Operational Hardening (Timeouts, Retries, Dedup)

### Problem
Under production load with concurrent coding agents, the dynamic MCP endpoint needs to handle upstream timeouts, duplicate intent creation, and scope computation performance. Without hardening, intermittent failures degrade agent productivity and missing dedup creates noisy intent backlogs.

### Who
- Platform operations team | Running multiple concurrent sandbox sessions | Needs the MCP governance pipeline to be reliable under production conditions

### Solution
Add upstream timeout handling with configurable limits, intent deduplication (same session + same action_spec = reuse existing intent), and scope computation caching (invalidated on intent state change).

### Domain Examples
#### 1: Upstream timeout with retry
Agent calls github:create_pr. Upstream GitHub MCP server does not respond in 30 seconds. Agent receives 504 timeout. Intent remains authorized. Agent retries -- second attempt succeeds.

#### 2: Duplicate intent dedup
Agent receives 403 for stripe:create_refund, calls create_intent. Intent created (pending_veto). Agent's retry loop calls create_intent again with same action_spec. System detects duplicate (same session + same provider + same action + same params). Returns existing intent ID and current status instead of creating new intent.

#### 3: Scope cache hit
Agent calls tools/list. Scope computed from 5 authorized intents (3 gates edges, 8 BrainAction entries). Result cached. Agent calls tools/list again 2 seconds later. Cache hit -- no database query. Agent creates new intent. Cache invalidated. Next tools/list recomputes.

### UAT Scenarios (BDD)

#### Scenario: Upstream timeout returns 504
Given an authorized tool call to an upstream MCP server
When the upstream does not respond within the configured timeout (30s)
Then the agent receives a 504 Gateway Timeout
And a trace record is created with status "timeout"
And the authorizing intent remains in authorized status

#### Scenario: Duplicate intent creation returns existing intent
Given session "claude-coder-7f3a" already has a pending_veto intent for "stripe:create_refund" with amount 5000
When the agent calls create_intent with the same provider, action, and params
Then the system returns the existing intent ID and current status
And no new intent is created

#### Scenario: Scope cache invalidated on intent state change
Given the scope cache contains the current effective scope for a session
When an intent linked to the session transitions to authorized
Then the scope cache entry is invalidated
And the next tools/list or tools/call recomputes the scope

### Acceptance Criteria
- [ ] Upstream timeout configurable per tool/provider (default 30s)
- [ ] Timeout returns 504 with trace recorded
- [ ] Intent dedup: same session + same action_spec returns existing intent
- [ ] Scope cache keyed by session ID, invalidated on gates edge changes
- [ ] Retried tool calls succeed without re-authorization (intent stays authorized)

### Outcome KPIs
- **Who**: All governed tool calls
- **Does what**: Complete reliably under production conditions
- **By how much**: Zero dropped tool calls from timeout/retry failures
- **Measured by**: Trace records: timeout count / total calls < 1%
- **Baseline**: N/A

### Technical Notes
- Depends on: US-01 through US-07
- Scope cache: simple Map<sessionId, { scope, timestamp }> with TTL or event-driven invalidation
- Intent dedup: query `SELECT * FROM intent WHERE session = $session AND action_spec = $spec AND status NOT IN ["vetoed", "failed"]`
- Upstream timeout: AbortController with configurable timeout per mcp_tool registry entry
