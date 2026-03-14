# Journey: Strategic Alignment Governance

## Overview
**Goal**: Ensure every agent intent traces to an active business objective, preventing organizational waste.
**Persona**: Elena Vasquez, Engineering Lead at a 12-person AI-native startup. Manages 4 autonomous coding agents and 2 management agents. Reports to board quarterly on AI ROI.
**Jobs Served**: J1 (Strategic Alignment), J4 (Cost Governance)

## Emotional Arc
```
Confident                                                    *
                                                          *     *
                                                       *           *
Focused                                             *
                                                 *
                                              *
Curious                                    *
                                        *
                                     *
Uncertain          *  *  *  *  *
                *
Anxious      *
          |---------|---------|---------|---------|---------|---------|
          Step 1    Step 2    Step 3    Step 4    Step 5    Step 6    Step 7
          Define    Create    Link      Author-  Monitor   Review    Audit
          Strategy  Object-   Intents   ize      Progress  Alignment Coherence
                    ives
```

## Journey Flow

```
+------------------------------------------------------------------+
|  STRATEGIC ALIGNMENT GOVERNANCE JOURNEY                           |
+------------------------------------------------------------------+

  [Elena opens Brain]
        |
        v
  +-- Step 1: Define Strategic Context --------------------------+
  | Elena reviews existing projects and decides on Q2 objectives |
  | She sees: 4 projects, 23 active tasks, 12 open decisions    |
  | Feeling: Anxious -- "Are my agents working on the right     |
  |          things? I can't tell."                              |
  +--------------------------------------------------------------+
        |
        v
  +-- Step 2: Create Objectives ---------------------------------+
  | Elena creates objective nodes via chat:                      |
  | "Our Q2 objective is to launch the MCP marketplace with     |
  |  10 listed integrations by June 30"                          |
  |                                                              |
  | Brain extracts:                                              |
  |   title: "Launch MCP Marketplace"                            |
  |   target_date: 2026-06-30                                    |
  |   success_criteria: ["10 listed integrations"]               |
  |   priority: 90                                               |
  |                                                              |
  | Feeling: Uncertain -> Curious -- "Interesting, it picked     |
  |          up the KPIs automatically"                          |
  +--------------------------------------------------------------+
        |
        v
  +-- Step 3: Link Intents to Objectives ------------------------+
  | When Coder-Alpha submits an intent:                          |
  |   goal: "Implement MCP tool discovery endpoint"              |
  |                                                              |
  | Authorizer evaluates:                                        |
  |   intent.goal -> semantic match -> objective:"Launch MCP     |
  |   Marketplace" (similarity: 0.87)                            |
  |   -> RELATE intent:xyz ->supports-> objective:mcp-launch     |
  |                                                              |
  | Feeling: Curious -> Focused -- "The system is connecting     |
  |          agent work to my objectives automatically"          |
  +--------------------------------------------------------------+
        |
        v
  +-- Step 4: Authorizer Flags Unaligned Work -------------------+
  | Coder-Beta submits intent:                                   |
  |   goal: "Refactor logging subsystem to use structured logs"  |
  |                                                              |
  | Authorizer evaluates:                                        |
  |   No active objective matches (best: 0.31 similarity)       |
  |   -> Creates observation:                                    |
  |     severity: warning                                        |
  |     text: "Intent has no supporting objective. Flagged as    |
  |            potential organizational waste."                   |
  |   -> Intent proceeds (warning mode, not blocking)            |
  |                                                              |
  | Feed card appears:                                           |
  | +----------------------------------------------------------+ |
  | | ! ALIGNMENT WARNING                                      | |
  | | Intent: "Refactor logging subsystem"                     | |
  | | Agent: Coder-Beta                                        | |
  | | Closest objective: "Infrastructure Reliability" (0.31)   | |
  | | Action: [Link to Objective] [Dismiss] [Create Objective] | |
  | +----------------------------------------------------------+ |
  |                                                              |
  | Feeling: Focused -- "Good, it caught the drift without      |
  |          blocking the agent"                                 |
  +--------------------------------------------------------------+
        |
        v
  +-- Step 5: Monitor Objective Progress ------------------------+
  | Elena opens the objective progress view:                     |
  |                                                              |
  | +----------------------------------------------------------+ |
  | | OBJECTIVE: Launch MCP Marketplace                        | |
  | | Target: June 30, 2026 | Priority: 90 | Status: active   | |
  | |                                                          | |
  | | Progress:                                                | |
  | | [=========>                    ] 34%                      | |
  | |                                                          | |
  | | Key Results:                                             | |
  | |   * 10 listed integrations ........... 3/10 (30%)        | |
  | |                                                          | |
  | | Supporting Intents (last 7 days): 14                     | |
  | | Aligned Agent Sessions: 23                               | |
  | | Unaligned Intents Flagged: 2                             | |
  | |                                                          | |
  | | Related: 3 features, 8 tasks, 2 decisions                | |
  | +----------------------------------------------------------+ |
  |                                                              |
  | Feeling: Focused -> Confident -- "I can see exactly where   |
  |          we stand against the objective"                     |
  +--------------------------------------------------------------+
        |
        v
  +-- Step 6: Review Strategic Alignment Report -----------------+
  | Monthly alignment summary:                                   |
  |                                                              |
  | +----------------------------------------------------------+ |
  | | STRATEGIC ALIGNMENT REPORT - March 2026                  | |
  | |                                                          | |
  | | Objectives:                                              | |
  | |   Launch MCP Marketplace .... 58% aligned compute        | |
  | |   Infrastructure Reliability  24% aligned compute        | |
  | |   Unaligned ................. 18% (47 intents)           | |
  | |                                                          | |
  | | Top Unaligned Categories:                                | |
  | |   Refactoring .............. 23 intents (no objective)   | |
  | |   Documentation ........... 14 intents (no objective)    | |
  | |   Exploration ............. 10 intents (exploratory OK)  | |
  | |                                                          | |
  | | Recommendation: Create "Code Health" objective to        | |
  | | capture refactoring work, or accept as overhead.         | |
  | +----------------------------------------------------------+ |
  |                                                              |
  | Feeling: Confident -- "Now I can explain our AI spend       |
  |          to the board with real data"                        |
  +--------------------------------------------------------------+
        |
        v
  +-- Step 7: Coherence Check -----------------------------------+
  | X-Ray auditor reports:                                       |
  |                                                              |
  | +----------------------------------------------------------+ |
  | | COHERENCE AUDIT - Objective Layer                        | |
  | |                                                          | |
  | | * Objective "Infrastructure Reliability" has 0           | |
  | |   supporting intents in 14 days (stale?)                 | |
  | | * Decision "Standardize on tRPC" (Feb 12) has no         | |
  | |   implementing task after 27 days                        | |
  | | * 3 tasks completed this week with no outcome            | |
  | |   observation recorded                                   | |
  | |                                                          | |
  | | Coherence Score: 0.74 (down from 0.81 last week)         | |
  | +----------------------------------------------------------+ |
  |                                                              |
  | Feeling: Confident -> Satisfied -- "The system tells me     |
  |          what needs attention. Nothing falls through cracks" |
  +--------------------------------------------------------------+
```

## Shared Artifacts

| Artifact | Source | Displayed As | Consumers |
|----------|--------|-------------|-----------|
| `${objective_id}` | `objective` table (SurrealDB) | Record ID | Feed cards, progress view, alignment report, supports edge |
| `${objective_title}` | `objective.title` field | Text string | Feed cards, progress view, chat responses, alignment report |
| `${objective_progress}` | Computed from supporting intents/tasks | Percentage | Progress view, alignment report |
| `${alignment_score}` | Computed: intent-objective similarity | Float 0-1 | Authorizer evaluation, feed warning cards |
| `${intent_id}` | `intent` table (SurrealDB) | Record ID | Supports edge, authorization flow, feed cards |
| `${identity_name}` | `identity.name` field | Text string | Feed cards, behavior scores, alignment report |

## Error Paths

| Error | User Sees | Recovery |
|-------|-----------|----------|
| No objectives exist when intent submitted | Feed card: "No objectives defined. Agent work is untracked." | Link to create first objective |
| Objective target_date passed | Objective status transitions to "expired" | Prompt to retire or extend |
| Semantic matching fails (all scores < 0.2) | Warning observation created with "no match" | Manual linking via feed card action |
| Multiple objectives match equally (ambiguous) | Feed card shows top 3 matches, asks Elena to confirm | One-click link to correct objective |

## Integration Points

| From Step | To Step | Data Passed | Validation |
|-----------|---------|-------------|------------|
| 2 -> 3 | Objective record ID + title | Objective exists and is active |
| 3 -> 4 | Supports edge + similarity score | Score threshold met or warning created |
| 3 -> 5 | Aggregated intent count per objective | At least 1 supporting intent exists |
| 5 -> 6 | Per-objective metrics | All active objectives included |
| 6 -> 7 | Coherence patterns | Audit queries return valid results |
