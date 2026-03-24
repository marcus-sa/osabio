## Chat Agent Architecture

The chat system uses a thin orchestrator pattern where a single top-level chat agent dispatches to specialized subagents. The knowledge graph is the communication bus — agents read from and write to the graph independently, never passing data directly between each other.

```
User Message
  │
  ├─→ Extraction Pipeline (always runs, Haiku)
  │     └─→ entities/relationships → SurrealDB graph
  │
  └─→ Chat Agent (Sonnet, thin orchestrator)
        ├─→ Direct tools (search, entity detail, decisions, observations)
        └─→ Subagent dispatch
              └─→ PM Agent (Haiku) → suggestions, observations → graph
```

**Two paths to the graph:**
| Source | Path | Why |
|--------|------|-----|
| User messages | Extraction pipeline (Haiku infers entities from unstructured text) | User input is unstructured |
| Agent output | Direct graph write (agents already have structured form) | Nothing to extract |

**Key files:**
- `chat/handler.ts` — `runChatAgent()`: streams chat agent responses with tool use
- `chat/context.ts` — `buildChatContext()` / `buildSystemPrompt()`: loads graph context, builds chat agent system prompt
- `tools/index.ts` — `createChatAgentTools()`: registers all chat agent tools
- `tools/types.ts` — `ChatToolExecutionContext`: actor-typed context (`chat_agent | mcp | pm_agent | analytics_agent`)

## Chat Agent Tools

| Tool | Purpose |
|------|---------|
| `search_entities` | Search workspace entities by text query |
| `list_workspace_entities` | List entities by type in workspace |
| `get_entity_detail` | Fetch entity with relationships and provenance |
| `get_project_status` | Project task/decision/question aggregation |
| `get_conversation_history` | Load recent conversation messages |
| `create_provisional_decision` | Draft a decision for user review |
| `confirm_decision` | Finalize a decision (requires explicit user auth) |
| `resolve_decision` | Mark a decision as resolved |
| `check_constraints` | Validate decision constraints |
| `create_observation` | Create observation for risks/conflicts/signals |
| `acknowledge_observation` | Mark observation as reviewed |
| `resolve_observation` | Close a resolved observation |
| `create_question` | Create an open question requiring a choice |
| `create_suggestion` | Create a proactive agent-to-human proposal |
| `edit_work_item` | Edit an existing task or feature |
| `move_items_to_project` | Move work items to a different project |
| `show_relationship_graph` | Visualize entity relationship graph |
| `invoke_pm_agent` | Delegate to PM subagent |
| `invoke_analytics_agent` | Delegate to analytics subagent |

## Shared Tool Layer

Tools live in `tools/` as composable building blocks. Any agent (chat agent, PM subagent, future subagents) can compose the tools it needs. Key shared tools for work item management:

| Tool | File | Purpose |
|------|------|---------|
| `suggest_work_items` | `tools/suggest-work-items.ts` | Batch triage/dedup (>0.97 exact duplicate, ≥0.8 merge, <0.8 new) |
| `create_work_item` | `tools/create-work-item.ts` | Direct entity creation in graph |
| `edit_work_item` | `tools/edit-work-item.ts` | Edit existing task or feature |
| `move_items_to_project` | `tools/move-items-to-project.ts` | Move work items between projects |

## Product Manager Subagent

The PM agent (`agents/pm/`) is the single authority on tasks, features, and project status. It uses the AI SDK's `ToolLoopAgent` class and composes shared tools from `tools/`. It is invoked by the chat agent via `invoke_pm_agent` tool with an intent:

| Intent | When to use |
|--------|-------------|
| `plan_work` | User discusses goals, features, or work to be done |
| `check_status` | User asks about project status, progress, or blockers |
| `organize` | User wants to restructure or re-prioritize |
| `track_dependencies` | User asks about blocked items or dependency chains |

**Key files:**
- `agents/pm/agent.ts` — `runPmAgent()`: creates `ToolLoopAgent` with PM tools, returns structured JSON output
- `agents/pm/prompt.ts` — `buildPmSystemPrompt()`: loads workspace projects and observations
- `agents/pm/tools.ts` — `createPmTools()`: composes shared tools (search_entities, get_project_status, create_observation, create_suggestion, suggest_work_items, create_work_item, edit_work_item, move_items_to_project)

**PM output schema:** `{ summary, suggestions: WorkItemSuggestion[], updated, discarded, observations_created }`

The chat agent renders PM suggestions as `WorkItemSuggestionList` component blocks in the chat UI.

## Observation Entity

Observations (`observation/*`) are lightweight cross-cutting signals that agents write to the graph. They enable async agent-to-agent communication without forcing signals into wrong entity types.

- **Severity levels:** `conflict` (contradictions needing human resolution), `warning` (risks), `info` (awareness)
- **Lifecycle:** `open` → `acknowledged` → `resolved`
- **Schema:** `observation` table with text, severity, status, category, source_agent, workspace, observation_type, confidence, evidence_refs, reasoning
- **Relation:** `observes` edge links observations to project/feature/task/decision/question
- Agents load open observations as part of their context and factor them into their work.
