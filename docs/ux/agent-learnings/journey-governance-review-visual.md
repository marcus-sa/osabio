# Journey: Human Reviews Pending Learnings (Governance Flow)

## Overview
Tomas opens the governance feed after a week of active agent usage. Three learning suggestions have accumulated. He reviews, approves two, and dismisses one, then checks for conflicts in the learning library.

## Emotional Arc
- **Start**: Curious, slightly overwhelmed ("what accumulated this week?")
- **Middle**: Engaged, decisive ("I'm shaping how agents behave")
- **End**: Confident, in control ("the system is well-governed")

Pattern: **Confidence Building** (Uncertain -> Focused -> Confident)

---

## Flow Diagram

```
  [Tomas opens governance feed]
          |
          v
  +---------------------------+
  | Feed: 3 pending learnings |
  | (yellow tier cards)       |
  +---------------------------+
          |
          v
  +---------------------------+
  | Review each card:         |
  | - Read rule text          |
  | - Check evidence          |
  | - Check for conflicts     |
  +---------------------------+
          |
    +-----+-----+-----+
    |           |     |
    v           v     v
 [Approve]  [Edit] [Dismiss]
    |        & Approve  |
    v           |       v
  active     active  dismissed
          |
          v
  +---------------------------+
  | Learning library view     |
  | - All active learnings    |
  | - Conflict indicators     |
  | - Filter by agent/type    |
  +---------------------------+
          |
          v
  +---------------------------+
  | Resolve any conflicts     |
  | via supersession          |
  +---------------------------+
```

---

## Step-by-Step with Emotional Annotations

### Step 1: Feed Overview
**Emotional state**: Curious, slightly task-loaded
**Action**: Tomas views the governance feed filtered to learnings

```
+-- Governance Feed -- Learnings --------------------------------+
|                                                                |
|  Filter: [All] [Decisions] [Suggestions] [*Learnings*]        |
|                                                                |
|  3 pending learning suggestions                                |
|                                                                |
|  +----------------------------------------------------------+ |
|  | SUGGESTED LEARNING                           pending      | |
|  |                                                           | |
|  | "When creating SurrealDB queries with KNN and WHERE,     | |
|  |  split into two steps: KNN in a LET subquery, then       | |
|  |  filter in a second query."                               | |
|  |                                                           | |
|  | Observer | 91% confidence | For: code_agent              | |
|  | Evidence: 4 corrections (Feb 20 - Mar 10)                 | |
|  |                                                           | |
|  | [Approve]   [Edit & Approve]   [Dismiss]                  | |
|  +----------------------------------------------------------+ |
|                                                                |
|  +----------------------------------------------------------+ |
|  | SUGGESTED LEARNING                           pending      | |
|  |                                                           | |
|  | "Always include ORDER BY fields in the SELECT             | |
|  |  projection for SurrealDB v3.0 queries."                  | |
|  |                                                           | |
|  | Observer | 85% confidence | For: code_agent              | |
|  | Evidence: 2 corrections, 1 failed query (Mar 1 - Mar 9)   | |
|  |                                                           | |
|  | [Approve]   [Edit & Approve]   [Dismiss]                  | |
|  +----------------------------------------------------------+ |
|                                                                |
|  +----------------------------------------------------------+ |
|  | SUGGESTED LEARNING                           pending      | |
|  |                                                           | |
|  | "Prefer shorter task titles under 60 characters."         | |
|  |                                                           | |
|  | PM Agent | 62% confidence | For: chat_agent              | |
|  | Evidence: 2 edits to task titles (Mar 8 - Mar 12)         | |
|  |                                                           | |
|  | [Approve]   [Edit & Approve]   [Dismiss]                  | |
|  +----------------------------------------------------------+ |
+----------------------------------------------------------------+
```

**Design notes**:
- Feed filterable by entity type -- learnings get their own filter
- Cards sorted by confidence (highest first)
- Low-confidence suggestions visually distinct (lower position)

### Step 2: Evidence Drill-Down
**Emotional state**: Analytical, evaluating
**Action**: Tomas expands evidence for the first suggestion

```
+-- Evidence Detail ---------------------------------------------+
|                                                                |
|  "When creating SurrealDB queries with KNN and WHERE..."      |
|                                                                |
|  Evidence trail:                                               |
|                                                                |
|  Session Feb 20 (agent_session:x1y2z3)                        |
|    Tomas: "The vector search returns empty results when        |
|     you add a WHERE clause. Split the KNN into a LET."        |
|                                                                |
|  Session Feb 28 (agent_session:a4b5c6)                        |
|    Tomas: "Same bug again -- KNN + WHERE doesn't work         |
|     in SurrealDB v3.0. Use the two-step pattern."             |
|                                                                |
|  Session Mar 5 (agent_session:d7e8f9)                         |
|    Tomas: "We've been over this. Split KNN and WHERE           |
|     into separate queries."                                    |
|                                                                |
|  Session Mar 10 (agent_session:g0h1i2)                        |
|    Observation: code_agent generated single-query KNN+WHERE    |
|    that returned empty results. Auto-detected by Observer.     |
|                                                                |
|  Similar active learnings: None found                          |
|  Potential conflicts: None detected                            |
|                                                                |
|  [Approve]   [Edit & Approve]   [Dismiss]   [Back]            |
+----------------------------------------------------------------+
```

### Step 3: Batch Review Completion
**Emotional state**: Satisfied, efficient
**Action**: After reviewing all three

```
+-- Review Summary ----------------------------------------------+
|                                                                |
|  Learning review complete:                                     |
|                                                                |
|  Approved (2):                                                 |
|    "KNN + WHERE two-step pattern" -- code_agent                |
|    "ORDER BY in SELECT projection" -- code_agent               |
|                                                                |
|  Dismissed (1):                                                |
|    "Shorter task titles" -- too subjective, low confidence      |
|                                                                |
|  Active learnings in workspace: 8 total                        |
|  No conflicts detected.                                        |
|                                                                |
|  [View Learning Library]                                       |
+----------------------------------------------------------------+
```

### Step 4: Learning Library (Curation View)
**Emotional state**: In control, surveying
**Action**: Tomas opens the full learning library

```
+-- Learning Library --------------------------------------------+
|                                                                |
|  Workspace: Osabio Development | 8 active learnings            |
|                                                                |
|  Filter: [All] [Active] [Superseded] [Dismissed]              |
|  Agent:  [All] [code_agent] [chat_agent] [pm_agent]           |
|  Type:   [All] [Constraint] [Instruction] [Precedent]         |
|                                                                |
|  +----------------------------------------------------------+ |
|  | Constraint | code_agent, chat_agent          active       | |
|  | "Never use null for domain data values..."                | |
|  | Created by: Tomas Eriksson | Mar 5                        | |
|  |                                     [Edit] [Deactivate]   | |
|  +----------------------------------------------------------+ |
|  | Constraint | code_agent                      active       | |
|  | "KNN + WHERE two-step pattern..."                         | |
|  | Source: Observer (approved by Tomas) | Mar 13              | |
|  |                                     [Edit] [Deactivate]   | |
|  +----------------------------------------------------------+ |
|  | Instruction | code_agent                     active       | |
|  | "Always use --no-verify when committing..."               | |
|  | Created by: Tomas Eriksson | Feb 15                       | |
|  |                                     [Edit] [Deactivate]   | |
|  +----------------------------------------------------------+ |
|  | Precedent | code_agent                       active       | |
|  | "Billing uses integer cents, not float dollars..."        | |
|  | Created by: Tomas Eriksson | Jan 20                       | |
|  |                                     [Edit] [Deactivate]   | |
|  +----------------------------------------------------------+ |
|                                                                |
|  Conflict check: No conflicts detected among active learnings  |
|                                                                |
|  +----------------------------------------------------------+ |
|  | Superseded (2 learnings)                                  | |
|  | "Use snake_case for DB fields" -- superseded Mar 1        | |
|  | "Limit PR size to 200 lines" -- superseded Feb 20         | |
|  +----------------------------------------------------------+ |
+----------------------------------------------------------------+
```

**Design notes**:
- Library view shows all learnings with filters
- Active/superseded/dismissed states clearly distinguished
- Conflict detection runs on the active set
- Supersession chain preserves history
- Edit and Deactivate available for each learning

---

## Error Paths

### E1: Conflict Detected in Library
Two active learnings contradict each other.

```
+-- Conflict Detected ------------------------------------------+
|                                                                |
|  Potential conflict between active learnings:                  |
|                                                                |
|  Learning A (Constraint, active):                              |
|  "Never use null for domain data values."                      |
|                                                                |
|  Learning B (Instruction, active):                             |
|  "Return null from API endpoints when resource not found."     |
|                                                                |
|  Semantic similarity: 0.78 | Category: potential contradiction |
|                                                                |
|  Resolution options:                                           |
|  [Supersede A with B]  [Supersede B with A]                    |
|  [Edit both to clarify scopes]  [Mark as non-conflicting]      |
+----------------------------------------------------------------+
```

### E2: No Pending Learnings
Tomas opens the feed but nothing is pending.

```
+-- Governance Feed -- Learnings --------------------------------+
|                                                                |
|  No pending learning suggestions.                              |
|                                                                |
|  8 active learnings in workspace.                              |
|  Last suggestion reviewed: 3 days ago.                         |
|                                                                |
|  [View Learning Library]   [Create Learning]                   |
+----------------------------------------------------------------+
```
