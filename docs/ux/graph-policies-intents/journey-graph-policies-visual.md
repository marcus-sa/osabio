# Journey: Graph Policies & Intents Visualization

Epic: `graph-policies-intents`
Date: 2026-03-11

## Journey Overview

```
Rena opens         Rena sees policy     Carlos notices       Amara checks
workspace graph    nodes connected      intent node in       awareness tier
     |             to identities        "executing" state    for vetoed intents
     v                  v                    v                    v
[1. GRAPH LOAD] --> [2. POLICY NODES] --> [3. INTENT NODES] --> [4. FEED ITEMS]
   Curious            Oriented             Alert               Reassured
```

## Emotional Arc

- **Start**: Curious/uncertain -- "I need to understand governance topology"
- **Middle**: Alert/focused -- "I can see the connections and spot issues"
- **End**: Confident/reassured -- "Governance is visible and working"

---

## Step 1: Graph Loads with Policy & Intent Nodes

**Action**: Rena opens the workspace graph view (existing Reagraph force-directed layout)

```
+-- Knowledge Graph ------------------------------------------------+
|                                                                    |
|                    [Workspace: Brain]                               |
|                    /       |        \                               |
|                   /        |         \                              |
|          [Project:       [Project:    [Policy: Agent               |
|           Alpha]          Beta]        Budget Guard]               |
|           /    \            |            /        \                 |
|     [Task:   [Feature:   [Task:   [Identity:  [Identity:          |
|      Fix       Auth]      Deploy]  ci-agent]   dev-agent]         |
|      Bug]                                                          |
|                                                                    |
|  Legend:  (Project) (Feature) (Task) (Decision)                    |
|           (Policy) (Intent) (Person/Identity)                      |
+--------------------------------------------------------------------+
```

**Emotional state**: Curious -> Oriented
**Shared artifacts**: GraphEntityTable type, EntityKind union, graph-theme colors

---

## Step 2: Policy Nodes Show Governance Topology

**Action**: Rena sees policy nodes connected via `governing` edges to identity nodes and `protects` edges to workspace nodes

```
+-- Policy Detail (on hover/click) ---------------------------------+
|                                                                    |
|  [Policy] Agent Budget Guard                                       |
|  Status: active    Version: 3                                      |
|                                                                    |
|  Connections:                                                      |
|    governing -> ci-agent (identity)                                |
|    governing -> dev-agent (identity)                               |
|    protects  -> Brain (workspace)                                  |
|    supersedes -> Agent Budget Guard v2 (policy, deprecated)        |
|                                                                    |
+--------------------------------------------------------------------+
```

**Emotional state**: Oriented -> Confident
**Key insight**: Rena can see at a glance that both CI and dev agents are governed by the budget policy. If an identity had no `governing` edge, it would appear as an orphan in the graph.

---

## Step 3: Intent Nodes Show Authorization Flow

**Action**: Carlos sees intent nodes in the graph connected to tasks via `triggered_by` and to agent sessions via `gates`

```
+-- Graph (intent visible) -----------------------------------------+
|                                                                    |
|  [Task: Deploy to staging]                                         |
|        |                                                           |
|        | triggered_by                                              |
|        v                                                           |
|  [Intent: "Deploy v2.1 to staging"]                                |
|  Status: executing   Priority: 45                                  |
|        |                                                           |
|        | gates                                                     |
|        v                                                           |
|  [Agent Session: deploy-agent-0312]                                |
|  Status: running                                                   |
|                                                                    |
+--------------------------------------------------------------------+
```

**Emotional state**: Alert -> In control
**Key insight**: Carlos traces the path from task to intent to agent session. He can see the intent is in `executing` state, confirming the agent has been authorized to proceed.

---

## Step 4: Vetoed Intents in Feed Awareness Tier

**Action**: Amara checks the governance feed and sees recently-vetoed intents in the awareness tier

```
+-- Governance Feed -------------------------------------------------+
|                                                                    |
|  BLOCKING (2)                                                      |
|    [Intent] Scale database replicas   pending_veto                 |
|    [!] Intent awaiting human review (risk 78)                      |
|    [ Approve ] [ Veto ] [ Discuss ]                                |
|                                                                    |
|  REVIEW (3)                                                        |
|    ...existing items...                                            |
|                                                                    |
|  AWARENESS (5)                                                     |
|    [Intent] Delete staging environment   vetoed                    |
|    Vetoed 6 hours ago -- risk exceeded budget threshold             |
|    [ Discuss ]                                                     |
|                                                                    |
|    [Task] Fix login bug   completed                                |
|    Recently completed task                                         |
|                                                                    |
+--------------------------------------------------------------------+
```

**Emotional state**: Uncertain -> Reassured
**Key insight**: Amara sees the vetoed intent with its reason. She does not need to search for it -- it appeared passively in the feed. The 24h window means it will age out, keeping the feed clean.

---

## Integration Checkpoints

1. `EntityKind` type must include `"policy"` -- currently missing (only `"intent"` exists)
2. `GraphEntityTable` type must include `"intent"` and `"policy"` -- currently excludes both
3. `graph-theme.ts` already handles `"intent"` (maps to feature color) but needs `"policy"` case
4. `KIND_LABELS` in `EntityBadge.tsx` needs `"intent"` and `"policy"` entries
5. `feed-queries.ts` needs `listRecentlyVetoedIntents` query (awareness tier)
6. `feed-route.ts` needs to call vetoed intents query and map to awareness items
7. Graph queries (`queries.ts`) need to include intent and policy tables in graph traversal
8. `EntityActionRequest.action` union needs `"veto"` -- already present in `GovernanceFeedAction` but verify routing
