## Subagent Execution Trace Contract

Every subagent MUST return a `SubagentTrace` in its output so the chat agent can persist it and the frontend can render a collapsible execution log.

### What to capture

| Step type | Fields | Source |
|-----------|--------|--------|
| `tool_call` | `toolName`, `argsJson` (stringified input), `resultJson` (stringified output) | `step.toolResults[i]` |
| `text` | `text` (intermediate reasoning between tool calls) | `step.text` |

Also measure `totalDurationMs` by wrapping the `agent.generate()` call with `performance.now()`.

### How to implement

1. Import the shared types:
   ```ts
   import type { SubagentTrace, SubagentTraceStep } from "../../../shared/contracts";
   ```

2. Collect steps after `agent.generate()`:
   ```ts
   const startedAt = performance.now();
   const result = await agent.generate({ prompt: ... });
   const totalDurationMs = Math.round(performance.now() - startedAt);

   const traceSteps: SubagentTraceStep[] = [];
   for (const step of result.steps) {
     if (step.text?.trim()) {
       traceSteps.push({ type: "text", text: step.text.trim() });
     }
     for (const toolResult of step.toolResults) {
       traceSteps.push({
         type: "tool_call",
         toolName: toolResult.toolName,
         argsJson: JSON.stringify(toolResult.input),
         resultJson: JSON.stringify(toolResult.output),
       });
     }
   }
   ```

3. Include the trace in the agent output type:
   ```ts
   return {
     ...result.output,
     trace: {
       agentId: "your_agent_id",
       intent: input.intent,
       steps: traceSteps,
       totalDurationMs,
     },
   };
   ```

### Persistence path

The chat agent's `onFinish` callback in `chat-route.ts` extracts traces from tool parts matching `tool-invoke_<agent>` and persists them as `subagent_traces` on the assistant message record. The conversation load endpoints include traces in the API response for page reload reconstruction.

### Schema constraints

- `argsJson` and `resultJson` are stored as `TYPE string` (JSON-stringified) because SurrealDB SCHEMAFULL silently drops undeclared nested keys from `TYPE object`.
- If adding a new subagent, add its tool name to the trace extraction loop in `chat-route.ts`:
  ```ts
  if (part.type === "tool-invoke_pm_agent" && ...) // ← add your agent's tool here
  ```

### Frontend rendering

The frontend renders traces as a collapsible `<details>` block in `chat-page.tsx`. The `toolName` in the part type (e.g., `tool-invoke_pm_agent`) determines which traces get rendered. Add rendering for new subagent tool names in the `isToolPart` branch.
