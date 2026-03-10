# Data Models: Trace Migration

## Schema Changes

### New: `spawns` Relation Table

```sql
DEFINE TABLE OVERWRITE spawns TYPE RELATION IN message OUT trace SCHEMAFULL;
```

Minimal edge — no additional fields needed. The relation itself carries the semantic meaning (this message spawned this trace tree).

### Removed: `subagent_traces` Fields on `message`

```sql
REMOVE FIELD subagent_traces ON message;
```

This removes the parent field and all 11 nested field definitions:
- `subagent_traces`
- `subagent_traces[*].agentId`
- `subagent_traces[*].intent`
- `subagent_traces[*].totalDurationMs`
- `subagent_traces[*].steps`
- `subagent_traces[*].steps[*].type`
- `subagent_traces[*].steps[*].toolName`
- `subagent_traces[*].steps[*].argsJson`
- `subagent_traces[*].steps[*].resultJson`
- `subagent_traces[*].steps[*].durationMs`
- `subagent_traces[*].steps[*].text`

### Unchanged: `trace` Table

The trace table from migration 0023 is used as-is. No field additions or modifications.

```sql
-- Existing definition (for reference)
DEFINE TABLE trace SCHEMAFULL;
DEFINE FIELD type ON trace TYPE string
  ASSERT $value IN ["tool_call", "message", "subagent_spawn", "intent_submission", "bridge_exchange"];
DEFINE FIELD actor ON trace TYPE record<identity>;
DEFINE FIELD workspace ON trace TYPE record<workspace>;
DEFINE FIELD session ON trace TYPE option<record<agent_session>>;
DEFINE FIELD parent_trace ON trace TYPE option<record<trace>>;
DEFINE FIELD tool_name ON trace TYPE option<string>;
DEFINE FIELD input ON trace TYPE option<object> FLEXIBLE;
DEFINE FIELD output ON trace TYPE option<object> FLEXIBLE;
DEFINE FIELD duration_ms ON trace TYPE option<int>;
DEFINE FIELD created_at ON trace TYPE datetime;
```

## Record Shape Mapping

### Write: SubagentTrace → trace records

```
SubagentTrace {                    trace (root) {
  agentId: "pm_agent"          →     type: "subagent_spawn"
  intent: "plan_work"          →     input: { intent: "plan_work", agentId: "pm_agent" }
  totalDurationMs: 3200        →     duration_ms: 3200
  steps: [...]                       tool_name: "invoke_pm_agent"
}                                    actor: <identity record>
                                     workspace: <workspace record>
                                     parent_trace: NONE
                                     created_at: <now>
                                   }

SubagentTraceStep {                trace (child) {
  type: "tool_call"            →     type: "tool_call"
  toolName: "search_entities"  →     tool_name: "search_entities"
  argsJson: "{...}"            →     input: <parsed JSON object>
  resultJson: "{...}"          →     output: <parsed JSON object>
  durationMs: 200              →     duration_ms: 200
}                                    actor: <same as root>
                                     workspace: <same as root>
                                     parent_trace: <root trace record>
                                     created_at: <now>
                                   }

SubagentTraceStep {                trace (child) {
  type: "text"                 →     type: "message"
  text: "Analyzing..."        →     input: { text: "Analyzing..." }
}                                    actor: <same as root>
                                     workspace: <same as root>
                                     parent_trace: <root trace record>
                                     created_at: <now>
                                   }
```

### Read: trace records → SubagentTrace

```
trace (root) {                     SubagentTrace {
  type: "subagent_spawn"             agentId: input.agentId ?? "unknown"
  input.agentId: "pm_agent"    →     intent: input.intent ?? "unknown"
  input.intent: "plan_work"    →     totalDurationMs: duration_ms ?? 0
  duration_ms: 3200            →     steps: <from child traces>
  tool_name: "invoke_pm_agent"     }
}

trace (child) {                    SubagentTraceStep {
  type: "tool_call"            →     type: "tool_call"
  tool_name: "search_entities" →     toolName: "search_entities"
  input: {...}                 →     argsJson: JSON.stringify(input)
  output: {...}                →     resultJson: JSON.stringify(output)
  duration_ms: 200             →     durationMs: 200
}                                  }

trace (child) {                    SubagentTraceStep {
  type: "message"              →     type: "text"
  input.text: "Analyzing..."  →     text: input.text
}                                  }
```

### Type mapping note

The trace table uses `type: "message"` for text steps, but `SubagentTraceStep` uses `type: "text"`. The reconstructor maps between them:
- Write: `"text"` → `"message"` (trace record type)
- Read: `"message"` → `"text"` (wire format type)

## Graph Traversal Queries

### Forward: Message → Traces
```sql
SELECT ->spawns->trace FROM message:xyz
```

### Full call tree from message
```sql
LET $roots = SELECT ->spawns->trace AS traces FROM message:xyz;
SELECT * FROM trace WHERE parent_trace INSIDE $roots.traces ORDER BY created_at ASC;
```

### Reverse: Trace → Source Message
```sql
SELECT <-spawns<-message FROM trace:abc
```

### Batch load for conversation
```sql
-- All root traces for a set of messages
SELECT id, *, <-spawns<-message[0] AS source_message
  FROM trace
  WHERE <-spawns<-message INSIDE $message_ids
    AND type = "subagent_spawn";

-- All children of those roots
SELECT * FROM trace
  WHERE parent_trace INSIDE $root_ids
  ORDER BY created_at ASC;
```
