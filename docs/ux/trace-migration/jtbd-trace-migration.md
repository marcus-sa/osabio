# JTBD Analysis: Migrate subagent_traces to trace table

## Job Classification

- **Job Type**: Brownfield (Improve Existing System)
- **Workflow**: `baseline -> roadmap -> split -> execute -> review`
- **Discovery needed**: No -- system understood, problem identified, scope clear

## Job Story: Forensic Trace Queryability

**When** an agent, developer, or frontend consumer needs to inspect or traverse the execution history of a subagent invocation,
**I want to** query trace data as independent graph-native records with parent-child hierarchy,
**so I can** traverse execution trees, correlate traces across messages and intents, and render call trees without parsing embedded arrays.

### Functional Job
Query, traverse, and correlate subagent execution traces as first-class graph entities -- not opaque blobs buried inside message records.

### Emotional Job (Developer/Operator)
Feel confident that execution forensics are complete, queryable, and structurally sound -- no hidden state in denormalized blobs.

### Social Job
Demonstrate to the team that the system's observability is production-grade: traces are graph-native, independently addressable, and visible to any consumer.

## Forces Analysis

### Demand-Generating
- **Push**: Embedded `subagent_traces` on `message` are denormalized blobs -- not independently queryable, invisible to graph traversal, cannot be correlated with `intent.trace_id` or the existing `trace` table. Two trace systems exist in parallel with no connection.
- **Pull**: A unified `trace` table with parent-child hierarchy enables `SELECT ->spawns->trace.{type, tool_name, duration_ms} FROM message:xyz` -- graph-native forensic queries, consistent with intent traces, independently addressable records.

### Demand-Reducing
- **Anxiety**: Migration touches the hot path (chat agent onFinish), SSE streaming, conversation loading, branch inheritance, and the acceptance test. Breaking any link silently loses trace data.
- **Habit**: The embedded pattern is well-established across 7 files. Frontend renders from `subagentTraces` on the message contract. Changing the wire format requires coordinated updates.

### Assessment
- Switch likelihood: **High** -- the trace table already exists, the gap is clear, and no backward compat is needed (project policy).
- Key blocker: Coordinated update across write path (chat-route), read paths (workspace-routes, branch-chain), contract types, and acceptance test.
- Key enabler: The `trace` table schema from migration 0023 already supports `subagent_spawn` type with `parent_trace` hierarchy.
- Design implication: The migration is a horizontal refactoring -- every touchpoint must move together in a single coherent change.

## Outcome Statements

1. **Minimize** the number of trace storage mechanisms in the system (from 2 to 1)
2. **Minimize** the time it takes to query the complete call tree of a subagent invocation
3. **Minimize** the likelihood that trace data is invisible to graph traversal queries
4. **Maximize** the likelihood that a developer can correlate message traces with intent traces using standard graph queries

## Affected Touchpoints (Codebase Inventory)

| Touchpoint | File | Role |
|-----------|------|------|
| Schema (embedded) | `schema/migrations/0013_message_subagent_traces.surql` | Defines embedded fields on message |
| Schema (trace table) | `schema/migrations/0023_trace_table.surql` | Defines normalized trace table |
| Schema (master) | `schema/surreal-schema.surql` | Contains both definitions |
| Write path | `app/src/server/chat/chat-route.ts` (onFinish) | Extracts traces from tool parts, persists as embedded |
| PM agent output | `app/src/server/agents/pm/agent.ts` | Collects SubagentTraceStep[], returns SubagentTrace |
| Agent contract | `app/src/server/agents/AGENTS.md` | Documents trace contract |
| Shared types | `app/src/shared/contracts.ts` | SubagentTrace, SubagentTraceStep types |
| Read path (bootstrap) | `app/src/server/workspace/workspace-routes.ts` (2 places) | Maps subagent_traces to subagentTraces in API |
| Read path (branch) | `app/src/server/chat/branch-chain.ts` | Queries and propagates subagent_traces |
| Acceptance test | `tests/acceptance/chat/subagent-traces.test.ts` | Validates embedded structure |
| Frontend | Chat page TUI | Renders collapsible trace blocks |

## Data Shape Mapping: Embedded to Normalized

### Current embedded shape (on message)
```
message.subagent_traces[0] = {
  agentId: "pm_agent",
  intent: "plan_work",
  totalDurationMs: 4500,
  steps: [
    { type: "tool_call", toolName: "search_entities", argsJson: "...", resultJson: "...", durationMs: 200 },
    { type: "text", text: "Analyzing workspace..." },
    { type: "tool_call", toolName: "create_observation", argsJson: "...", resultJson: "...", durationMs: 150 }
  ]
}
```

### Target normalized shape (trace table)
```
trace:root = {
  type: "subagent_spawn",
  actor: identity:owner,
  workspace: workspace:ws1,
  tool_name: "invoke_pm_agent",
  input: { intent: "plan_work", agentId: "pm_agent" },
  duration_ms: 4500,
  parent_trace: NONE,
  created_at: "2026-03-11T..."
}

trace:step1 = {
  type: "tool_call",
  actor: identity:owner,
  workspace: workspace:ws1,
  tool_name: "search_entities",
  input: { ... parsed from argsJson },
  output: { ... parsed from resultJson },
  duration_ms: 200,
  parent_trace: trace:root,
  created_at: "2026-03-11T..."
}

trace:step2 = {
  type: "message",
  actor: identity:owner,
  workspace: workspace:ws1,
  input: { text: "Analyzing workspace..." },
  parent_trace: trace:root,
  created_at: "2026-03-11T..."
}
```

### Message-to-trace link
```
message:msg1 --[spawns]--> trace:root
```
Or equivalently, a `trace_id` field on message pointing to the root trace. The `spawns` relation edge is preferred because it enables bidirectional graph traversal without adding a field to the message schema.
