# US-GRC-03: Agent Coordinator with Context Injection

## Problem
Marcus Oliveira is a workspace admin who currently acts as the integration layer between agents. When Agent A confirms a decision, Agent B (working on a dependent task) continues with stale assumptions for minutes until Marcus manually notices the inconsistency and re-runs Agent B's work. Marcus spends significant time relaying context between agents that should be coordinating through the graph automatically.

## Who
- Workspace admin | Coordinates agent work | Wants agents to self-coordinate without human relay
- Chat Agent (orchestrator) | Dispatches subagents | Needs subagents to have current context
- Coding agents (MCP) | Work on assigned tasks | Need to know when task dependencies change mid-session

## Solution
Build an Agent Coordinator as a standalone always-on service (started with the server) that listens to observation events via LIVE SELECT and routes them to relevant agents using vector search. Observations already have embeddings. Agent descriptions are embedded when registered. The Coordinator runs a KNN query (observation embedding → agent description embeddings) to find semantically relevant agents, then invokes them. Include loop dampening to prevent cascading notification storms.

### Architecture Split
- **Coordinator** (this story): LIVE SELECT listener → vector search (observation embedding vs agent description embeddings) → invoke matched agents
- **Proxy context enrichment** (US-GRC-04): proxy vector searches for relevant recent graph changes using message embeddings → injects as XML

The Coordinator routes observations to agents via semantic similarity. The proxy enriches already-running agents with relevant recent changes. No `context_queue` table, no deterministic classifier — the graph is the single source of truth.

## Job Story Trace
- JS-GRC-02: Reactive Agent Wake-Up
- JS-GRC-03: Real-Time Conflict Detection
- Outcome #2: Minimize the likelihood of an agent working with stale context after another agent changes a dependency (Score: 17.4)

## Domain Examples

### 1: Conflict Observation Routes to Relevant Agents
The Observer creates a conflict-severity observation: "Task T-47 implementation contradicts confirmed decision D-99." The observation already has an embedding from the extraction pipeline. The Coordinator receives the event via LIVE SELECT and runs KNN: observation embedding vs agent description embeddings (scoped to active sessions in the workspace). Agent B's description ("Coding agent working on billing API migration") has high similarity (0.89). Agent B is invoked to re-evaluate its approach.

### 2: Outage Observation Routes by Semantic Match
An external webhook creates an observation: "Production API latency exceeding SLA (p99 > 2s)." The Coordinator runs KNN against agent description embeddings. Engineering Agent E's description ("Infrastructure and reliability engineering") matches at 0.92. Support Agent F's description ("Customer communication and incident response") matches at 0.85. Both are invoked — E to investigate, F to prepare customer updates.

### 3: Loop Dampening -- Cascading Observations
The Observer agent creates obs-1 targeting task:t-47. Peer review creates obs-2. Peer review of obs-2 creates obs-3. All within 45 seconds. The dampener detects 3 events from observer_agent on task:t-47 in 60 seconds. A fourth event is downgraded to "log" only. A meta-observation is created: "Cascading event loop dampened on task:t-47 (3 events in 45s from observer_agent)." This appears in Marcus's feed as a review item.

### 4: No Active Session -- Skip Agent Notification
Agent C completed its session on task:t-102 two hours ago. Task:t-102 depends_on decision:d-99. When decision:d-99 is confirmed, the Coordinator finds no active session for task:t-102 and does not generate a notification. The change is still visible in the feed (log level) and will be part of the context for Agent C's next session via the regular MCP context loader.

## UAT Scenarios (BDD)

### Scenario: Coordinator routes observation to semantically matched agent
Given Agent B has an active session (s-88) with description "Coding agent working on billing API migration"
And the Observer creates a conflict-severity observation "Task T-47 implementation contradicts confirmed decision D-99"
When the Coordinator receives the observation via LIVE SELECT
And runs KNN search: observation embedding vs agent description embeddings
Then Agent B is matched (similarity > threshold)
And the Coordinator invokes Agent B

### Scenario: Coordinator routes observation to multiple agents by semantic match
Given Agent E has an active session with description "Infrastructure and reliability engineering"
And Agent F has an active session with description "Customer communication and incident response"
When the Coordinator receives an observation "Production API latency exceeding SLA"
And runs KNN search against active agent description embeddings
Then both Agent E and Agent F are matched (similarity > threshold)
And both agents are invoked

### Scenario: Coordinator skips agents below similarity threshold
Given Agent G has an active session with description "Marketing content creation"
When the Coordinator receives an observation "Database connection pool exhausted"
And runs KNN search against active agent description embeddings
Then Agent G is not matched (similarity < threshold)
And no agent is invoked

### Scenario: Coordinator skips agents without active sessions
Given Agent C completed its session two hours ago
And Agent C's description embedding would match the observation
When the Coordinator receives the observation via LIVE SELECT
Then the KNN search is scoped to active sessions only
And Agent C is not invoked
And the observation remains in the graph for future session context loading

### Scenario: Loop dampening activates after threshold
Given the Observer creates obs-1, obs-2, obs-3 all targeting task:t-47 within 45 seconds
When obs-4 targeting task:t-47 triggers the event classifier
Then the dampener forces notification level to "log" for task:t-47 events
And a meta-observation is created: "Cascading event loop dampened on task:t-47"
And the meta-observation is visible in Marcus's governance feed

### Scenario: Dampening resets after window expires
Given dampening was activated on task:t-47 at 10:01:00
When a new event for task:t-47 arrives at 10:02:05 (65 seconds later)
Then the dampener has reset
And the event is classified normally

## Acceptance Criteria
- [ ] Activator receives observation events via DEFINE EVENT webhook (POST endpoint)
- [ ] Activator uses LLM classification (fast model) to determine which agents should act on the observation (ADR-061)
- [ ] LLM receives observation text + severity + all registered agent descriptions for the workspace
- [ ] Observations targeting entities with active agent sessions are skipped (proxy handles those — ADR-059)
- [ ] Adding a new agent type requires no rule changes — LLM judges capability from description
- [ ] Activated sessions stored with `triggered_by` pointing to the observation (polymorphic record reference)
- [ ] Loop dampening: >3 events on same entity from same source in 60 seconds triggers dampening
- [ ] Dampened events are logged but do not trigger agent activations
- [ ] Meta-observation created when dampening activates (visible in feed)

## Technical Notes
- **Activator is a POST endpoint** (`/api/internal/activator/observation`), called by a SurrealDB `DEFINE EVENT` webhook on observation CREATE. Same pattern as the 8 existing observer webhooks.
- **DEFINE EVENT trigger**: `DEFINE EVENT activator_observation_created ON observation WHEN $event = "CREATE" AND $after.source_agent != "agent_activator" THEN { http::post(...) } ASYNC RETRY 3;`
- **Active coverage check**: Before LLM classification, the activator checks if the observation's target entity already has an active agent session. If so, it skips — the proxy handles enriching active sessions via its own vector search (US-GRC-04).
- **LLM classification** (ADR-061): Loads all registered agent descriptions (text) for the workspace. Sends observation text + severity + agent list to a fast model (Haiku). LLM returns which agents should be activated and why. Agent IDs validated against registered agents.
- **`triggered_by` field**: Polymorphic `option<record<observation | task | decision | question>>` on `agent_session`. Records which entity caused the activator to start this session.
- **No `context_queue` table, no deterministic classifier, no KNN**: the graph is the delivery mechanism. LLM judgment replaces both rule tables and vector similarity.
- Loop dampening state is per-workspace, per-entity, per-source-agent. Implemented as in-memory sliding window counter.
- Phase: 4 (Agent Activator -- depends on Phase 3 foundation)

## Dependencies
- Existing DEFINE EVENT webhook pattern (observer-route.ts, 8 existing webhooks)
- Existing agent session lifecycle (orchestrator/session-lifecycle.ts)
- `agent` table with `description` field (text, for LLM classification)
- Fast LLM model (Haiku) for classification — uses existing `extractionModel` from runtime deps
