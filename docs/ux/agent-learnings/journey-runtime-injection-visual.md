# Journey: Learning Injection at Agent Runtime (Consumption Flow)

## Overview
A coding agent starts a new MCP session in the Osabio workspace. The system selects relevant active learnings, respects the token budget, resolves priority ordering, and injects them into the system prompt.

## Emotional Arc
- **Start**: Neutral (system process)
- **Middle**: Seamless (learnings selected and injected)
- **End**: Confident (agent operates with accumulated wisdom, human sees correct behavior)

Pattern: **Confidence Building** -- but experienced by the human observing agent behavior, not by the agent itself.

---

## Flow Diagram

```
  [Agent session starts]
          |
          v
  +---------------------------+
  | Load workspace context    |
  | (existing: projects,      |
  |  decisions, observations, |
  |  questions, suggestions)  |
  +---------------------------+
          |
          v
  +---------------------------+
  | Query active learnings    |
  | for this agent type       |
  | in this workspace         |
  +---------------------------+
          |
          v
  +---------------------------+
  | Priority sort:            |
  | 1. Human-created          |
  | 2. Agent-suggested        |
  | Within each: by priority  |
  +---------------------------+
          |
          v
  +---------------------------+
  | Token budget check:       |
  | Max ~500 tokens for       |
  | learnings section         |
  +---------------------------+
          |
          v
  +---------------------------+
  | Conflict resolution:      |
  | If contradictory rules,   |
  | human-created wins        |
  +---------------------------+
          |
          v
  +---------------------------+
  | Inject into system prompt |
  | as "Active Learnings"     |
  | section                   |
  +---------------------------+
          |
          v
  [Agent operates with learnings]
```

---

## Step-by-Step

### Step 1: Learning Query
**Actor**: System (prompt builder)
**Action**: Query active learnings scoped to this agent and workspace

```
Query logic (conceptual):
  SELECT * FROM learning
  WHERE workspace = $workspace
    AND status = 'active'
    AND ($agent_type IN target_agents OR target_agents CONTAINS 'all')
  ORDER BY
    source = 'human' DESC,     -- human-created first
    priority DESC,              -- high priority first
    created_at ASC              -- older learnings first (established rules)
```

### Step 2: Token Budget Enforcement
**Actor**: System (prompt builder)
**Action**: Fit learnings within token budget

```
Budget allocation:
  Total system prompt budget: ~4000 tokens (varies by model)
  Learning section budget: ~500 tokens (~15% of prompt)

  Selection algorithm:
  1. Include all human-created learnings (they fit first)
  2. Fill remaining budget with agent-suggested learnings by priority
  3. If budget exceeded, truncate lowest-priority agent-suggested learnings
  4. Log which learnings were included vs excluded

Example for code_agent session:
  Budget: 500 tokens
  Available learnings: 8 active (5 human, 3 agent-suggested)
  Included: 5 human (320 tokens) + 2 agent-suggested (150 tokens) = 470 tokens
  Excluded: 1 agent-suggested ("Prefer shorter task titles" -- lowest priority)
```

### Step 3: System Prompt Injection
**Actor**: System (prompt builder)
**Action**: Format learnings as a prompt section

```
+-- System Prompt Section ---------------------------------------+
|                                                                |
|  ## Workspace Learnings                                        |
|                                                                |
|  These rules were established by your workspace. Follow them   |
|  in all interactions.                                          |
|                                                                |
|  ### Constraints (must follow)                                 |
|  - Never use null for domain data values. Represent absence    |
|    with omitted optional fields (field?: Type) only.           |
|  - When creating SurrealDB queries with KNN and WHERE, split   |
|    into two steps: KNN in a LET subquery, then filter in a     |
|    second query.                                               |
|  - Always include ORDER BY fields in the SELECT projection     |
|    for SurrealDB v3.0 queries.                                 |
|                                                                |
|  ### Instructions (follow when applicable)                     |
|  - Always use --no-verify when committing. The pre-commit      |
|    hook requires osabio init which is not available in worktree  |
|    environments.                                               |
|  - Always use -s (GPG sign) when committing.                   |
|                                                                |
|  ### Precedents (reference for similar situations)             |
|  - Billing calculations use integer cents (not floating point  |
|    dollars) to avoid rounding errors.                          |
|  - In the past, schema changes were handled as breaking --     |
|    no data migration scripts needed.                           |
|                                                                |
+----------------------------------------------------------------+
```

**Design notes**:
- Learnings grouped by type for clarity
- Constraints framed as imperatives ("must follow")
- Instructions framed as conditional ("when applicable")
- Precedents framed as reference material ("for similar situations")
- Section header explains provenance ("established by your workspace")

### Step 4: Injection Points by Agent Type

| Agent | Injection Point | File |
|-------|----------------|------|
| Chat agent | `buildSystemPrompt()` | `app/src/server/chat/context.ts` |
| PM agent | `buildPmSystemPrompt()` | `app/src/server/agents/pm/prompt.ts` |
| Coding agents (MCP) | Context packet builder | `cli/src/context-builder.ts` |
| Observer agent | Context loader | `app/src/server/agents/observer/context-loader.ts` |

Each injection point calls the same shared function:
```
loadActiveLearnings(surreal, workspaceRecord, agentType) -> LearningSection
```

### Step 5: Human Verification
**Emotional state**: Confident, trusting
**Action**: Tomas notices the agent correctly avoids null

```
+-- Coding Session (Tomas observes) ----------------------------+
|                                                                |
|  Tomas: "Add an optional billing period to the invoice."       |
|                                                                |
|  Agent: "I'll add the billing period as an optional property:  |
|                                                                |
|    billingPeriod?: string                                      |
|                                                                |
|  Note: Following workspace convention, I'm using an optional   |
|  property rather than `string | null` to represent absence."   |
|                                                                |
+----------------------------------------------------------------+
```

**Design notes**:
- Agent may reference the learning when it directly applies
- This builds trust that learnings are working
- No need to cite the learning every time -- only when relevant

---

## Error Paths

### E1: No Active Learnings
New workspace with no learnings yet.

- Learning section is omitted from prompt entirely (no empty section)
- No impact on agent behavior

### E2: Token Budget Exhausted by Human Learnings
30+ human-created learnings exceed the 500-token budget.

- All human learnings included (budget is soft for human-created)
- Agent-suggested learnings excluded with log warning
- Observation created: "Learning token budget exceeded. Consider consolidating learnings."
- Surfaces in governance feed for Tomas

### E3: Conflicting Active Learnings at Injection Time
Two learnings contradict each other (conflict detection missed at creation).

- Human-created learning takes priority over agent-suggested
- If both human-created, the newer one takes priority
- Observation logged: "Conflicting learnings detected at injection time"
- Both included but conflict noted in prompt section
