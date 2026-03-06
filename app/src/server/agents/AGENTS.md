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

## Orchestrator-Specialist Boundary

The chat agent is a **thin orchestrator**. It classifies intent, selects the relevant parts of the user's message, and routes to the appropriate specialist agent. It does NOT:

- Pre-classify entity kinds (project vs feature vs task)
- Rewrite user text into imperative commands
- Make domain decisions that belong to the specialist

### Dispatching to sub-agents

When invoking a sub-agent (e.g. `invoke_pm_agent`), the `context` parameter should contain the **user's relevant words**, not the chat agent's interpretation. The specialist agent has its own system prompt with workspace context and classification rules — let it decide.

**Correct:** Forward user text, let PM classify
```
context: "DASHBOARD\n\nYour business at a glance.\n\nReal-time order count..."
```

**Wrong:** Pre-classify in the context string
```
context: "Create a project for DabDash with a feature for the Dashboard..."
```

### Workspace ≠ Project

The workspace name is the business/brand. It must never be created as a project. A programmatic guard in `create_work_item` enforces this — if the PM agent attempts to create a project matching the workspace name, the tool returns an error redirecting it to use the user's described items as projects instead.

### PM Agent Authority

The PM agent (`agents/pm/`) is the single authority on entity classification:
- What is a project, feature, or task
- Which project entities belong under
- Deduplication and merge decisions

It loads workspace projects, observations, and suggestions in its system prompt and makes classification decisions based on that context.
