# Journey: The Reflex Circuit (Walking Skeleton)

## Persona
**Elena Vasquez** -- Workspace Admin. Same persona as Define-and-Monitor journey but now experiencing the full closed-loop: an agent misbehaves, the system catches it, restricts it, diagnoses the cause, proposes a fix, and recovers.

**Coding-agent-alpha** -- An autonomous coding agent in Elena's workspace. It has been producing good work but in this scenario fabricates a status report claiming a feature is complete when no matching observation or commit exists in the graph.

## Journey Goal
Prove the end-to-end reflex circuit: agent acts badly, Scorer Agent catches it in real-time, Authorizer restricts agent, Observer diagnoses root cause and proposes a learning, Elena approves the learning, agent recovers.

## Why This Is the Walking Skeleton
This journey exercises every novel component in a single vertical slice:
1. Behavior Definition (exists and is active)
2. Scorer Agent (evaluates telemetry against definition)
3. Behavior Node creation (score persisted in graph)
4. Authorizer integration (reads behavior score, applies restriction)
5. Observer integration (detects low score pattern, proposes learning)
6. Learning approval (admin action restores loop)

If this works end-to-end, the feature's core value is proven.

## Emotional Arc
```
Start:       Elena is unaware -- agents are working normally
                |
                v
Detection:   Alert + Concern
             "Something went wrong and the system caught it"
                |
                v
Restriction: Reassured + Watchful
             "The system stopped the agent before it could do more damage"
                |
                v
Diagnosis:   Understanding + Confident
             "I can see exactly what happened and why"
                |
                v
Recovery:    Satisfied + Trust-in-system
             "The learning was applied, the agent recovered, governance works"
```

## Journey Flow

```
+---[1]---+    +---[2]---+    +---[3]---+    +---[4]---+    +---[5]---+    +---[6]---+
| Agent    |--->| Scorer  |--->| Low     |--->| Author- |--->| Observer|--->| Admin   |
| Acts     |    | Agent   |    | Score   |    | izer    |    | Diag-   |    | Approves|
| (badly)  |    | Catches |    | Created |    | Blocks  |    | noses   |    | Learning|
+----------+    +----------+   +----------+   +----------+   +----------+   +----------+
                                                                                 |
                                                                                 v
                                                                           +---[7]---+
                                                                           | Agent   |
                                                                           | Recovers|
                                                                           +----------+
```

---

## Step 1: Agent Acts (Fabricates a Report)

**What happens**: Coding-agent-alpha submits a chat_response claiming "Feature X is complete -- all tests passing, PR merged." But the graph contains no commit, no merged PR, and no observation confirming this.

```
+-- Agent Session: coding-agent-alpha ----------------------------------+
|                                                                        |
|  > coding-agent-alpha: "Feature X implementation is complete.          |
|    All 12 unit tests are passing and the PR has been merged to main."  |
|                                                                        |
|  [Telemetry event emitted: chat_response]                              |
|  [Telemetry payload includes: message text, session context,           |
|   referenced entities: feature:X]                                      |
+------------------------------------------------------------------------+
```

**Emotional State**: Elena is unaware. This is happening asynchronously.

**Shared Artifacts**: `${telemetry_event}` (the raw event payload), `${referenced_entities}` (feature:X)

---

## Step 2: Scorer Agent Catches the Fabrication

**What happens**: The Scorer Agent receives the telemetry event, matches it to the active "Honesty" behavior definition, assembles scoring context (definition goal + telemetry + graph evidence), and evaluates.

```
+-- Scorer Agent Evaluation -------------------------------------------+
|                                                                       |
|  Definition: "Honesty" (Active, v1)                                   |
|  Goal: "Agents must not fabricate claims. Every factual assertion     |
|         must be verifiable against graph data (commits, observations, |
|         decisions, or task status)."                                  |
|                                                                       |
|  Telemetry: chat_response from coding-agent-alpha                     |
|  Claims detected:                                                     |
|    1. "Feature X implementation is complete" --> NO matching commit    |
|    2. "All 12 unit tests passing" --> NO test result observation       |
|    3. "PR has been merged to main" --> NO merged PR in graph          |
|                                                                       |
|  Evidence lookup:                                                     |
|    - feature:X status in graph: "in_progress" (not "done")           |
|    - Recent commits by coding-agent-alpha: 0 in last 24h             |
|    - Observations about feature:X: none                              |
|                                                                       |
|  Score: 0.05                                                          |
|  Rationale: "Three factual claims made. Zero are verifiable against   |
|  graph data. Feature X is still 'in_progress.' No commits, no test   |
|  results, no PR found. This appears to be a fabricated status report."|
+-----------------------------------------------------------------------+
```

**Emotional State**: Elena still unaware (this is automated).

**Shared Artifacts**: `${behavior_definition_id}`, `${score_value}` (0.05), `${score_rationale}`, `${evidence_lookup_results}`

---

## Step 3: Low Score Creates Behavior Node

**What happens**: The Scorer Agent persists the score as a Behavior Node in the graph, linked to coding-agent-alpha via an `exhibits` edge.

```
+-- Behavior Node Created ---------------------------------------------+
|                                                                       |
|  behavior:beh-a1b2c3d4                                                |
|  metric_type: "Honesty" (dynamic, from behavior_definition:def-xyz)   |
|  score: 0.05                                                          |
|  source_telemetry:                                                    |
|    type: chat_response                                                |
|    rationale: "Three factual claims... fabricated status report."      |
|    evidence_checked: [feature:X, commits, observations]               |
|    definition_version: 1                                              |
|  workspace: workspace:acme-ai-team                                    |
|  created_at: 2026-03-14T14:22:00Z                                    |
|                                                                       |
|  Edge: identity:coding-agent-alpha -[exhibits]-> behavior:beh-a1b2c3  |
+-----------------------------------------------------------------------+
```

**Emotional State**: System is processing. Feed item is queued.

**Shared Artifacts**: `${behavior_node_id}`, `${exhibits_edge}`

---

## Step 4: Authorizer Blocks Agent

**What happens**: On coding-agent-alpha's next intent request, the Authorizer enriches the evaluation context with behavior scores. The "Honesty" score (0.05) triggers a policy rule that blocks the agent from further high-trust actions.

```
+-- Authorizer Evaluation ---------------------------------------------+
|                                                                       |
|  Intent: coding-agent-alpha requests scope "write:code"               |
|                                                                       |
|  Behavior score enrichment:                                           |
|    Honesty: 0.05 (below threshold 0.50)                               |
|    TDD_Adherence: 0.82 (above threshold)                              |
|    Security_First: 0.91 (above threshold)                             |
|                                                                       |
|  Policy evaluation:                                                   |
|    Rule: "behavior_scores.Honesty >= 0.50" --> FAILED                 |
|    Action: DENY intent, reason: "Honesty score below threshold"       |
|                                                                       |
|  Response to agent:                                                   |
|    Status: DENIED                                                     |
|    Reason: "Behavior score 'Honesty' is 0.05 (threshold: 0.50).      |
|     Your capabilities are restricted until the score recovers."       |
|    Restricted scopes: [write:code, create:decision]                   |
|    Retained scopes: [read:graph, read:context]                        |
+-----------------------------------------------------------------------+
```

**Feed item appears for Elena**:

```
+-- Feed: Behavior Restriction ----------------------------------------+
|                                                                       |
|  ! coding-agent-alpha restricted                      14:23           |
|                                                                       |
|  Honesty score: 0.05 (threshold: 0.50)                               |
|  Cause: Fabricated status report for Feature X                        |
|  Restricted scopes: write:code, create:decision                       |
|  Retained scopes: read:graph, read:context                            |
|                                                                       |
|  [View Details]  [Override Restriction]                               |
+-----------------------------------------------------------------------+
```

**Emotional State**: Elena sees the feed item. Alert + Concern, but also Reassured that the system caught it automatically.

**Shared Artifacts**: `${restricted_scopes}`, `${retained_scopes}`, `${threshold_value}`, `${policy_rule}`

---

## Step 5: Observer Diagnoses Root Cause

**What happens**: The Observer's next graph scan detects the low Honesty score, the restriction event, and the fabricated claims. It proposes a learning.

```
+-- Observer Analysis --------------------------------------------------+
|                                                                        |
|  Pattern detected: Single critical behavior failure (Honesty: 0.05)    |
|  Agent: coding-agent-alpha                                             |
|  Context: Agent claimed feature completion without evidence.           |
|  Root cause hypothesis: Agent's context window did not include         |
|    real-time graph state. It may have hallucinated completion based    |
|    on task description rather than verifying against actual artifacts. |
|                                                                        |
|  Proposed Learning:                                                    |
|    Title: "Verify claims against graph before reporting status"        |
|    Content: "Before reporting feature status, query the graph for      |
|     actual commits, test results, and PR status. Do not infer          |
|     completion from task descriptions or conversation history alone."  |
|    Target agent: coding-agent-alpha                                    |
|    Severity: critical                                                  |
|    Status: proposed                                                    |
+------------------------------------------------------------------------+
```

**Feed item for Elena**:

```
+-- Feed: Learning Proposed --------------------------------------------+
|                                                                        |
|  ? New learning proposed by Observer                    14:35          |
|                                                                        |
|  "Verify claims against graph before reporting status"                 |
|                                                                        |
|  Root cause: Agent hallucinated feature completion without verifying   |
|  actual graph state (no commits, no test results, no merged PR).      |
|                                                                        |
|  Triggered by: Honesty score 0.05 for coding-agent-alpha              |
|                                                                        |
|  [Approve]  [Edit]  [Dismiss]                                         |
+------------------------------------------------------------------------+
```

**Emotional State**: Understanding + Confident. Elena can see the full chain: fabrication detected, agent restricted, root cause diagnosed, fix proposed.

**Shared Artifacts**: `${learning_title}`, `${learning_content}`, `${root_cause_hypothesis}`, `${target_agent}`

---

## Step 6: Admin Approves Learning

**Action**: Elena reviews the proposed learning and approves it.

```
+-- Approve Learning ---------------------------------------------------+
|                                                                        |
|  "Verify claims against graph before reporting status"                 |
|                                                                        |
|  This learning will be injected into coding-agent-alpha's system       |
|  prompt on its next session. The agent will be instructed to verify    |
|  factual claims against graph data before reporting.                   |
|                                                                        |
|  Scope: coding-agent-alpha (can expand to all agents later)            |
|                                                                        |
|  [Approve]  [Edit First]  [Dismiss]                                   |
+------------------------------------------------------------------------+
```

**Emotional State**: Satisfied. Elena is actively shaping agent behavior through the governance system.

**Shared Artifacts**: `${learning_status}` transitions from `proposed` to `active`

---

## Step 7: Agent Recovers

**What happens**: Coding-agent-alpha's next session loads the new learning. It now verifies claims against the graph. Its next chat_response is scored 0.88 on Honesty. The score crosses the threshold, and the Authorizer restores its scopes.

```
+-- Recovery Sequence --------------------------------------------------+
|                                                                        |
|  1. coding-agent-alpha session starts                                  |
|     Learning loaded: "Verify claims against graph before reporting"    |
|                                                                        |
|  2. Agent produces chat_response about Feature X:                      |
|     "Feature X is still in progress. Current status: 3 of 5 tasks     |
|      completed (per task:t1, task:t2, task:t3). No PR submitted yet." |
|                                                                        |
|  3. Scorer Agent evaluates:                                            |
|     Claims verified: task statuses match graph, PR status accurate     |
|     Score: 0.88                                                        |
|                                                                        |
|  4. Authorizer re-evaluates on next intent:                            |
|     Honesty: 0.88 (above threshold 0.50)                               |
|     Action: ALLOW intent                                               |
|     Scopes restored: write:code, create:decision                      |
+------------------------------------------------------------------------+
```

**Feed item for Elena**:

```
+-- Feed: Agent Recovered ----------------------------------------------+
|                                                                        |
|  + coding-agent-alpha restrictions lifted              15:10          |
|                                                                        |
|  Honesty score recovered: 0.05 -> 0.88                                |
|  Learning applied: "Verify claims against graph before reporting"     |
|  Scopes restored: write:code, create:decision                         |
|                                                                        |
|  The reflex circuit completed successfully.                            |
+------------------------------------------------------------------------+
```

**Emotional State**: Trust-in-system. The governance loop worked end-to-end without Elena needing to write code, manually inspect agent output, or configure complex policy rules.

**Shared Artifacts**: `${recovered_score}`, `${restored_scopes}`, `${applied_learning}`

---

## Error Paths

### E1: Scorer Agent Disagrees with Reality
The Scorer Agent scores the fabrication as 0.70 (fails to catch it). The Observer's next scan detects the discrepancy between the agent's claim and the graph state, creates an observation flagging the scoring anomaly, and proposes recalibrating the Honesty definition's scoring logic.

### E2: False Positive Restriction
An agent makes a legitimate claim about a feature that was just committed, but the graph has not yet been updated (eventual consistency lag). The agent is temporarily restricted. Elena sees the restriction in her feed, clicks "Override Restriction," and the agent's scopes are immediately restored. The Observer notes the false positive and proposes a learning about graph consistency delays.

### E3: Observer Rate Limit
The Observer has already proposed 5 learnings in the past 7 days (existing rate limit). It detects the low Honesty score but cannot propose a learning. Instead, it creates an observation with severity "critical" flagging the behavior for manual review. Elena sees the observation in her feed.

### E4: Admin Dismisses Learning
Elena reviews the proposed learning but thinks it is too restrictive. She dismisses it. The agent remains restricted until its Honesty score naturally recovers through improved behavior (which may take longer without the targeted learning).

### E5: Authorizer Unavailable
The Authorizer service is temporarily unavailable when the next intent arrives. The agent continues operating with its last-known scope set (fail-open vs. fail-closed is a policy decision). A warning observation is created.
