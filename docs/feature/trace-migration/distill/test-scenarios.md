# Test Scenarios: Trace Migration

**Feature**: Migrate subagent_traces from embedded arrays to normalized trace table
**GitHub Issue**: #126
**Wave**: DISTILL

## Test Strategy

### Key Design Decision: Database-Seeded Fixtures

The existing `subagent-traces.test.ts` relies on the full chat pipeline (LLM call → PM agent invocation → trace extraction). This is:
- **Expensive**: Each test costs real LLM API tokens
- **Nondeterministic**: The chat agent may or may not invoke the PM agent
- **Slow**: 120–180s per test

The migration tests instead **seed trace records directly** into the trace table with spawns edges, then verify read paths through real API endpoints. This tests the data contract (write shape → read shape) without LLM dependency.

The existing LLM-dependent test (`subagent-traces.test.ts`) remains as an integration smoke test for the full write path.

### Test Layers

| Layer | What it tests | LLM required? |
|-------|--------------|---------------|
| Walking Skeleton | Core read path: traces → API wire format | No |
| Graph Queryability | SurrealDB graph traversal on spawns edges | No |
| Batch Loading | Multi-message conversations load correctly | No |
| Branch Inheritance | Branched conversations inherit traces | No |
| Existing smoke test | Full pipeline: chat → PM agent → trace write → read | Yes |

## Scenarios

### Walking Skeleton (Priority: P0)

**WS-1: Conversation load returns SubagentTrace wire format**
```gherkin
Given an assistant message in a conversation
  And trace records with a spawns edge from the message
When the conversation is loaded via GET /api/workspaces/:id/conversations/:id
Then the assistant message includes subagentTraces
  And the trace has agentId, intent, totalDurationMs, and steps
  And tool_call steps have toolName, argsJson, resultJson, durationMs
  And text steps have text content
```

**WS-2: Bootstrap endpoint returns traces**
```gherkin
Given an assistant message with a spawns→trace edge
When workspace bootstrap is called via GET /api/workspaces/:id/bootstrap
Then the bootstrap messages include subagentTraces
```

**WS-3: Messages without traces omit the field**
```gherkin
Given an assistant message with no spawns edges
When the conversation is loaded
Then the message has no subagentTraces field (undefined, not empty array)
```

### Graph Queryability (Priority: P1)

**GQ-1: Forward traversal finds root traces**
```gherkin
Given a message with a spawns edge to a trace
When SELECT ... FROM trace WHERE <-spawns<-message CONTAINS $msg
Then the root trace (type: "subagent_spawn") is returned
```

**GQ-2: Child traces linked to root via parent_trace**
```gherkin
Given a root trace with 3 child traces (2 tool_call + 1 message)
When querying SELECT ... FROM trace WHERE parent_trace = $root
Then 3 child traces are returned with correct types and tool names
```

**GQ-3: Reverse traversal finds source message**
```gherkin
Given a trace with a spawns edge from a message
When SELECT <-spawns<-message FROM trace
Then the source message is returned
```

**GQ-4: Multiple traces per message**
```gherkin
Given a message with 2 spawns edges (PM agent + analytics agent)
When querying spawned traces for the message
Then both root traces are returned
```

### Batch Loading (Priority: P1)

**BL-1: Multi-message conversation loads all traces**
```gherkin
Given 3 message exchanges, 2 with traces and 1 without
When the conversation is loaded via API
Then msg1 has trace with intent "plan_work" (3 steps)
  And msg2 has no traces
  And msg3 has trace with intent "check_status" (1 step)
```

**BL-2: Multiple spawns per message**
```gherkin
Given a message with 2 trace trees (PM + analytics)
When loaded via API
Then both traces are present with correct intents
```

### Branch Inheritance (Priority: P2)

**BI-1: Inherited messages preserve traces across branches**
```gherkin
Given a parent conversation with a traced assistant message
  And a child conversation branched from that message
When the child conversation is loaded
Then inherited messages include subagentTraces from the parent
  And inherited messages are marked with inherited: true
  And the child's own messages are present
```

## Type Mapping Contract

The trace table stores types differently from the wire format:

| Trace table `type` | Wire format `SubagentTraceStep.type` |
|--------------------|--------------------------------------|
| `"tool_call"` | `"tool_call"` |
| `"message"` | `"text"` |

The reconstructor must map `"message"` → `"text"` on read.

## Implementation Order (@skip tags)

1. **Walking Skeleton** — Enable first, drives the core read path
2. **Graph Queryability** — Enable second, validates data integrity
3. **Batch Loading** — Enable third, validates multi-message pattern
4. **Branch Inheritance** — Enable last, validates cross-conversation concerns

## Files

| File | Purpose |
|------|---------|
| `tests/acceptance/chat/trace-migration/trace-test-kit.ts` | Shared fixtures and helpers |
| `tests/acceptance/chat/trace-migration/walking-skeleton.test.ts` | Core wire format contract |
| `tests/acceptance/chat/trace-migration/graph-queryability.test.ts` | Graph traversal validation |
| `tests/acceptance/chat/trace-migration/batch-loading.test.ts` | Multi-message batch loading |
| `tests/acceptance/chat/trace-migration/branch-inheritance.test.ts` | Branch inheritance |
| `tests/acceptance/chat/subagent-traces.test.ts` | Existing LLM-dependent smoke test (unchanged) |
