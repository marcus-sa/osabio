# Journey: Reactive Agent Coordination

## Emotional Arc
**Start**: Isolated (agents work in silos) -> **Middle**: Connected (agents react to each other's outputs) -> **End**: Trustworthy (agents self-correct without human relay)

Pattern: **Confidence Building** -- progressive trust that agents coordinate through the graph, not through the human.

---

## Flow Diagram

```
Agent A writes graph change
       |
       v
  LIVE SELECT fires
       |
       v
+------+-------+
| Event         |
| Classifier    |
+------+-------+
       |
       +--- interrupt ---> Agent Coordinator
       |                      |
       |                      +-- graph traverse: who is affected?
       |                      |
       |                      +-- for each affected agent:
       |                      |     active session? inject context
       |                      |     idle? enqueue for next session
       |                      |
       |                      +-- loop detection: has this entity
       |                           triggered > N events in T seconds?
       |                           yes -> dampen (log only)
       |
       +--- enqueue ------> Agent Context Queue
       |                      |
       |                      +-- store in per-agent queue
       |                      +-- agent reads queue on next tool turn
       |                      +-- queue has TTL (stale items expire)
       |
       +--- log ----------> Feed SSE + Audit Log
```

---

## Step 1: Graph Change Triggers Classification

```
Graph Write Event:
  table: decision
  id: d-99
  transition: status "provisional" -> "confirmed"
  workspace: montreal
  timestamp: 2026-03-17T15:43:12Z

Event Classifier Output:
  notification_levels:
    - target: feed
      level: log
      reason: "Decision status change is feed-worthy"
    - target: observer
      level: log
      reason: "Decision confirmation triggers Observer verification"
    - target: agents_with_dependency
      level: enqueue
      reason: "Active agents may have stale context"
```

**Emotional state**: N/A (system-internal step, not user-facing)

**Classification rules** (determining notification level):

| Entity Change | Feed Level | Agent Level | Observer Level |
|--------------|-----------|-------------|----------------|
| Decision confirmed/superseded | log | enqueue (if dependency) | log (verify) |
| Task status -> blocked | log | interrupt (if assigned agent active) | log |
| Task status -> done | log | enqueue (if dependent tasks exist) | log (verify) |
| Observation created (conflict severity) | log | interrupt (if active agent affected) | -- |
| Observation created (warning/info) | log | enqueue | -- |
| New question (high priority) | log | enqueue | -- |
| Agent session ended | log | enqueue (if shared task) | log (trace analysis) |

---

## Step 2: Coordinator Resolves Affected Agents

```
Coordinator Input:
  entity: decision:d-99
  change: status -> "confirmed"
  workspace: montreal

Graph Traversal:
  1. Find edges: task -[depends_on]-> decision:d-99
     Result: [task:t-47, task:t-102]

  2. Find active sessions on those tasks:
     SELECT * FROM agent_session
     WHERE task_id IN [task:t-47, task:t-102]
     AND orchestrator_status = "active"
     Result: [session:s-88 (Agent B, task:t-47)]

  3. Check loop dampening:
     decision:d-99 events in last 60s: 1
     Threshold: 3
     Result: not dampened

Coordinator Output:
  notifications:
    - agent_session: s-88
      level: enqueue
      context: "Decision d-99 confirmed: Standardize on tRPC.
                Your task t-47 (Migrate billing API) depends on this.
                Review your current approach."
      entity_ref: decision:d-99
```

**Emotional state for Marcus** (seeing the feed consequence): Confident ("The system figured out who cares about this change without me telling it")

---

## Step 3: Agent Receives Context Injection

### Enqueue Level (Phase 4)

Agent B is mid-session on task:t-47. On its next tool-use turn:

```
Agent B System Context (injected before next turn):
+-------------------------------------------------------------------+
| CONTEXT UPDATE (received during active session)                    |
|                                                                    |
| Decision confirmed: "Standardize on tRPC for all APIs"            |
| Entity: decision:d-99                                              |
| Confirmed by: chat_agent via conversation C-12                     |
| Timestamp: 2026-03-17T15:43:12Z                                   |
|                                                                    |
| Impact on your task:                                               |
|   Task: "Migrate billing API" (task:t-47)                          |
|   Dependency: task:t-47 -[depends_on]-> decision:d-99              |
|   Action needed: Review your current approach against the          |
|   confirmed decision.                                              |
|                                                                    |
| This is an informational update. Continue your current task        |
| but factor this change into your next reasoning step.              |
+-------------------------------------------------------------------+
```

### Interrupt Level (Phase 5)

For hard conflicts (e.g., Agent B's task depends on a decision that was just *superseded*):

```
Agent B System Context (injected immediately):
+-------------------------------------------------------------------+
| URGENT CONTEXT UPDATE -- ACTIVE WORK MAY BE INVALID               |
|                                                                    |
| Decision SUPERSEDED: "Use REST for billing API"                    |
| Entity: decision:d-55                                              |
| Superseded by: decision:d-99 "Standardize on tRPC for all APIs"   |
| Timestamp: 2026-03-17T15:43:12Z                                   |
|                                                                    |
| Your task "Migrate billing API" (task:t-47) depends on the        |
| superseded decision. Your current work may be based on invalid     |
| assumptions.                                                       |
|                                                                    |
| Recommended: Pause current approach. Re-evaluate task:t-47         |
| against the new decision before continuing.                        |
+-------------------------------------------------------------------+
```

**Emotional state for Marcus**: Relieved ("The system interrupted the agent before it wasted more time on invalid work")

---

## Step 4: Loop Detection and Dampening

```
Scenario: Cascading updates risk infinite loop

  10:01:00 - Decision d-99 confirmed
  10:01:02 - Observer creates observation obs-1 (conflict with t-47)
  10:01:04 - Coordinator notifies Agent B about obs-1
  10:01:08 - Agent B updates task t-47 status to "blocked"
  10:01:10 - Task t-47 status change fires LIVE SELECT
  10:01:11 - Event Classifier: task blocked -> log for feed
  10:01:12 - Feed updated. Chain complete.

  NO LOOP: Each entity changes state once. Event classifier
  checks if the source entity has already been processed in
  this cascade chain.

  LOOP SCENARIO (dampened):
  10:01:00 - Agent A writes observation obs-1
  10:01:02 - Observer peer-reviews obs-1, creates obs-2
  10:01:04 - Observer peer-reviews obs-2, creates obs-3  <-- dampened

  Dampening rule:
    IF same source_agent has created > 3 observations
    targeting the same entity in 60 seconds
    THEN level = log only (no further agent notifications)
    AND create a meta-observation: "Cascading observation loop
    detected on ${entity}, dampened after 3 iterations"
```

**Emotional state for Marcus**: Reassured ("The system has guardrails against runaway agent behavior")

---

## Integration Checkpoints

| Checkpoint | Validates | Phase |
|------------|-----------|-------|
| LIVE SELECT delivers event to classifier within 500ms | Foundation reactive pipeline | Phase 3 |
| Classifier produces correct notification level for each entity type | Classification rules | Phase 3 |
| Graph traversal finds affected agents via dependency edges | Coordinator dependency resolution | Phase 4 |
| Enqueue notification appears in agent context on next turn | Agent context queue delivery | Phase 4 |
| Interrupt notification injected mid-turn | Mid-conversation injection | Phase 5 |
| Loop dampening activates after threshold exceeded | Loop prevention | Phase 4 |
| Dampened cascade produces meta-observation | Loop observability | Phase 4 |
