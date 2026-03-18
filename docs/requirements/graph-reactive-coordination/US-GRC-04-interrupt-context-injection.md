# US-GRC-04: Proxy Context Enrichment via Vector Search

## Problem
Marcus Oliveira is a workspace admin whose coding agent (Agent B) sometimes works for 15+ minutes on a task whose foundational decision was just superseded by another agent. By the time Marcus notices the inconsistency, Agent B has produced significant work that must be discarded. Graph changes (decisions superseded, tasks blocked, conflict observations) are already in the graph, but the proxy does not surface them to running agents between session start and end.

## Who
- Workspace admin | Oversees agent coordination | Wants zero wasted agent work on provably invalid tasks
- Coding agents (MCP/CLI) | Work on assigned tasks | Need to know immediately when task foundation is invalidated

## Solution
Extend the LLM proxy's existing context injection pipeline (`proxy/context-injector.ts`) to find relevant recent graph changes using vector search. On each proxy request, the injector takes the current message content (or its embedding), runs KNN against recent graph entity embeddings (decisions, tasks, observations updated since `agent_session.last_request_at`), and injects semantically relevant changes as `<urgent-context>` (high similarity) or `<context-update>` (moderate similarity) XML blocks. After injection, `last_request_at` is updated. No separate `context_queue` table, no deterministic classifier — relevance is determined by semantic similarity against the graph.

## Job Story Trace
- JS-GRC-03: Real-Time Conflict Detection
- Outcome #2: Minimize the likelihood of an agent working with stale context (Score: 17.4)
- Outcome #3: Minimize the time between a conflict being created and the human being notified (Score: 14.8)

## Domain Examples

### 1: Decision Superseded -- Urgent Interrupt
Agent B (session:s-88) is generating a response about task "Migrate billing API" (task:t-47). At 4:10 PM, decision:d-55 "Use REST for billing API" is superseded by decision:d-99 "Standardize on tRPC." Agent B's current response completes at 4:10:03 PM. Before the next turn begins, the system injects:

```
[URGENT CONTEXT UPDATE - dependency invalidated]
Decision SUPERSEDED: "Use REST for billing API" (decision:d-55)
Superseded by: "Standardize on tRPC for all APIs" (decision:d-99)
Impact: Task "Migrate billing API" (task:t-47) depends on the superseded decision.
Recommendation: Pause current approach. Re-evaluate against the new decision.
```

Agent B's next response acknowledges the change and re-evaluates its approach.

### 2: Task Blocked -- Agent Notified of External Block
Agent C is working on task "Update API documentation" (task:t-102). At 2:15 PM, Marcus marks task:t-102 as "blocked" because the API design is being rethought. The classifier produces interrupt level for Agent C. Agent C's current response finishes. On the next turn:

```
[URGENT CONTEXT UPDATE - task status changed]
Task BLOCKED: "Update API documentation" (task:t-102)
Changed by: Marcus Oliveira
Reason: API design is being rethought
Recommendation: Pause documentation work. Await unblock or reassignment.
```

Agent C acknowledges and stops working on the blocked task.

### 3: Conflict Observation Targeting Active Task
The Observer creates a conflict-severity observation "Task T-47 implementation contradicts confirmed decision D-99" directly targeting task:t-47. Agent B has an active session on task:t-47. The classifier produces interrupt level. Agent B receives:

```
[URGENT CONTEXT UPDATE - conflict detected]
Observation: "Task T-47 implementation contradicts confirmed decision D-99"
Severity: conflict
Source: observer_agent
Impact: Your active task has a detected conflict with a confirmed decision.
Recommendation: Review the conflict and adjust your approach.
```

### 4: Interrupt During Streaming -- No Cancellation
Agent B is streaming a 2000-token response at 4:10 PM. The interrupt arrives at 4:10:01 PM. The streaming response continues normally -- all 2000 tokens are delivered. At 4:10:03 PM, the response completes. The interrupt context is then injected before the next turn. No tokens are lost, no streaming is interrupted.

## UAT Scenarios (BDD)

### Scenario: Interrupt injected on next turn after decision superseded
Given Agent B is actively processing task "Migrate billing API" (task:t-47)
And task:t-47 depends_on decision:d-55
When decision:d-55 is superseded by decision:d-99
Then Agent B's current response completes normally
And on Agent B's next turn, urgent context is injected
And the context includes: entity reference (decision:d-55), change type (superseded), superseding entity (decision:d-99), impact on task:t-47, and recommendation to re-evaluate

### Scenario: Interrupt does not cancel streaming response
Given Agent B is mid-generation (streaming response, 1500 of 2000 tokens sent)
When an interrupt notification arrives for decision:d-55 superseded
Then all 2000 tokens of the current response are delivered
And the interrupt is queued for the next turn
And no error or truncation occurs in the current response

### Scenario: Task blocked triggers interrupt to assigned agent
Given Agent C has an active session on task "Update API documentation" (task:t-102)
When Marcus marks task:t-102 as "blocked"
Then the classifier produces notification level "interrupt" for Agent C's session
And Agent C receives urgent context: "Task BLOCKED: Update API documentation"
And Agent C's next response acknowledges the block

### Scenario: Conflict observation triggers interrupt to task agent
Given Agent B has an active session on task:t-47
And the Observer creates a conflict-severity observation targeting task:t-47
When the event classifier processes the observation
Then the classifier produces notification level "interrupt" for Agent B's session
And Agent B receives urgent context with the conflict details

### Scenario: Multiple interrupts are consolidated
Given Agent B has 2 pending interrupt-level events (decision superseded + conflict observation)
When Agent B's current response completes
Then both interrupts are delivered as a single consolidated urgent context block
And the block is labeled "[2 URGENT CONTEXT UPDATES]"
And each update is clearly separated within the block

## Acceptance Criteria
- [ ] Proxy uses vector search: message embedding → KNN against recent graph entity embeddings (updated since `last_request_at`)
- [ ] High similarity matches injected as `<urgent-context>` (before `<brain-context>`)
- [ ] Moderate similarity matches injected as `<context-update>` (after `<brain-context>`)
- [ ] Configurable similarity thresholds for urgent vs context-update levels
- [ ] Current agent generation is NEVER cancelled
- [ ] Context injected before the next agent turn begins
- [ ] Injected context includes: entity reference, change description, impact on current task, recommendation
- [ ] `agent_session.last_request_at` updated after each proxy request
- [ ] Multiple agents on related tasks see the same graph changes (no per-session duplication)
- [ ] Interrupt delivery is reflected in Marcus's governance feed (blocking tier item)

## Technical Notes
- **Proxy-side only**: This story modifies `proxy/context-injector.ts` and `proxy/anthropic-proxy-route.ts`. No changes to the Coordinator or LIVE SELECT infrastructure.
- **Vector search query**: Use the two-step KNN pattern (per CLAUDE.md KNN + WHERE bug):
  ```sql
  -- Step 1: KNN candidates from recent entities
  LET $candidates = SELECT id, embedding, updated_at,
    vector::similarity::cosine(embedding, $msg_embedding) AS similarity
  FROM decision, task, observation
  WHERE embedding <|20, COSINE|> $msg_embedding;

  -- Step 2: Filter by workspace + recency
  SELECT * FROM $candidates
  WHERE workspace = $ws AND updated_at > $last_request_at
  ORDER BY similarity DESC LIMIT $limit;
  ```
- **Similarity thresholds**: High similarity (e.g., > 0.85) → `<urgent-context>`. Moderate (e.g., 0.65-0.85) → `<context-update>`. Below threshold → skip.
- **Injection format**: Urgent items → `<urgent-context>` XML block (before `<brain-context>`). Context updates → `<context-update>` XML block (after `<brain-context>`).
- **Timestamp update**: After injection, `UPDATE agent_session SET last_request_at = time::now() WHERE id = $sess` — fire-and-forget via `deps.inflight.track()`.
- **MCP context endpoint**: Also extend `POST /api/mcp/:workspaceId/context` to include relevant changes as `urgent_updates` and `context_updates` arrays (same query, structured instead of XML).
- **Feed notification**: When the proxy delivers an urgent context, emit an SSE feed event so Marcus sees "Agent B notified of conflict" in the governance feed.
- **Never cancel**: The proxy only runs on new API calls. Current streaming responses are never interrupted. This is inherent to the design — no special handling needed.
- Phase: 5 (Delivery — proxy enrichment is independent of coordinator routing)

## Dependencies
- `agent_session.last_request_at` field (new, added in Phase 4 migration)
- Existing embedding infrastructure (extraction pipeline already produces embeddings for graph entities)
- Existing proxy context injection pipeline (`proxy/context-injector.ts`)
- Existing MCP context endpoint (`mcp/mcp-route.ts`)
