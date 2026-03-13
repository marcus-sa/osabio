# Agent Learnings: Walking Skeleton Strategy

## Overview

Two walking skeletons prove the minimum viable E2E paths through the learning system. Together they answer: "Can a human create a behavioral rule, and will the right agents receive it?"

## Skeleton 1: Human Creates Learning and It Becomes Available to Agents

**User goal**: A human wants to teach their agents a new rule that will be followed in all future interactions.

**E2E path**: HTTP create -> SurrealDB persistence -> JIT loader -> agent context

```
Human creates constraint "Never use null"
  -> POST /api/workspaces/:id/learnings
    -> Learning persisted (status: active, source: human)
      -> listActiveLearnings returns it
        -> Agent receives rule in next session
```

**Observable outcomes**:
1. HTTP 201 response with learningId
2. Learning record in SurrealDB with status "active" (no approval needed for human-created)
3. Learning appears in active learning list for the workspace
4. Learning text, type, priority, and source fields are correctly persisted

**What it proves**: Schema works, HTTP endpoint works, persistence works, JIT loading works.

## Skeleton 2: Agent-Type Filtering Works

**User goal**: A human creates a rule that only applies to coding agents, and the chat agent does not receive it.

**E2E path**: DB seed -> JIT loader with agent type -> filtered result

```
Human creates instruction "Run tests before committing" (target: coding_agent)
  -> listActiveLearnings("coding_agent") returns it
  -> listActiveLearnings("chat_agent") does NOT return it
```

**Observable outcomes**:
1. Learning appears for coding_agent queries
2. Learning does NOT appear for chat_agent queries
3. Empty target_agents array would return learning for all agents (inverse test)

**What it proves**: Agent-type scoping works, workspace queries respect target_agents.

## Litmus Test Results

For each skeleton:

| Criterion | Skeleton 1 | Skeleton 2 |
|-----------|-----------|-----------|
| Title describes user goal? | Yes: "creates a learning rule and it becomes available to agents" | Yes: "not loaded for the chat agent" |
| Given/When use business language? | Yes: "workspace where a human works with coding agents" | Yes: "learning targeted specifically to coding agents" |
| Then describe user observations? | Yes: "learning is accepted", "immediately active" | Yes: "appears for coding agent", "does NOT appear for chat agent" |
| Non-technical stakeholder can confirm? | Yes: "I create a rule, agents follow it" | Yes: "I target a rule, only the right agents see it" |

## Implementation Sequence

1. Walking skeletons are the ONLY enabled tests initially
2. All milestone tests use `it.skip()`
3. Unskip one test at a time during implementation
4. Each unskipped test drives the next piece of implementation
