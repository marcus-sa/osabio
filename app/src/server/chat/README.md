# Chat

Conversational AI orchestrator with 18 tools for entity search, decision management, observations, and subagent dispatch to PM and Analytics agents.

## The Problem

Users interact with Brain through natural language. They ask questions like "What decisions have we made about auth?" or "Create a task to migrate the billing API." The chat layer must understand intent, load relevant graph context, dispatch to specialized subagents when needed, and stream responses in real time — all while writing structured knowledge back to the graph from every conversation.

## What It Does

- **Thin orchestrator pattern**: A single chat agent dispatches to PM and Analytics subagents for domain-specific work
- **18 composable tools**: Entity search, decision lifecycle, observation management, work item creation, and subagent invocation
- **Graph context injection**: Loads confirmed decisions, open observations, and active learnings into the chat agent's system prompt
- **SSE streaming**: Streams tokens, extraction results, and structured events to the client in real time
- **Branch conversations**: Supports conversation branching with parent-chain context inheritance

## Key Concepts

| Term | Definition |
|------|------------|
| **Chat Agent** | Top-level Sonnet-class orchestrator that handles direct tools and dispatches subagent tasks |
| **Tool Composition** | Shared tools in `chat/tools/` are composed by any agent (chat, PM, Analytics) — not duplicated |
| **ChatToolExecutionContext** | Actor-typed context (`chat_agent`, `mcp`, `pm_agent`) that scopes tool behavior per caller |
| **Context Packet** | Decisions + observations + learnings loaded into the system prompt for graph-aware responses |
| **Branch Chain** | Linked list of conversation messages enabling branching with full parent context |

## How It Works

**Example — user asks to plan a feature:**

1. User sends "Let's plan the rate limiting feature" via `POST /api/chat/messages`
2. `chat-ingress.ts` validates, persists the message, registers an SSE stream
3. `chat-processor.ts` loads conversation history + graph context (decisions, observations, learnings)
4. Extraction pipeline runs in parallel — infers entities from the message text
5. Chat agent recognizes planning intent → calls `invoke_pm_agent` tool with intent `plan_work`
6. PM agent creates work items, returns structured suggestions
7. Chat agent renders suggestions as `WorkItemSuggestionList` components
8. SSE emits: `token`, `extraction`, `observation`, `assistant_message`, `done`

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| **Onboarding active** | Routes to onboarding reply generator instead of chat agent |
| **Attachment chunks** | Extraction runs on both message text and attachment content |
| **Branch conversation** | Loads parent chain for context, scopes extraction to current branch |
| **Tool error** | Caught and surfaced in chat response, not swallowed |
| **Empty graph context** | Chat agent operates without context injection, still functional |

## Where It Fits

```text
POST /api/chat/messages
  |
  v
chat-ingress.ts (validate, persist, register SSE)
  |
  v
chat-processor.ts (orchestrate)
  |
  +---> Extraction Pipeline (Haiku, parallel)
  |       +-> entities/relationships -> SurrealDB graph
  |
  +---> Chat Agent (Sonnet, thin orchestrator)
          |
          +---> Direct tools
          |       +-> search_entities
          |       +-> get_entity_detail
          |       +-> create_provisional_decision
          |       +-> create_observation
          |       +-> ... (18 tools total)
          |
          +---> Subagent dispatch
                  +-> invoke_pm_agent -> PM Agent
                  +-> invoke_analytics_agent -> Analytics Agent
```

**Consumes**: User messages, conversation history, graph context (decisions, observations, learnings)
**Produces**: Streamed assistant responses, extracted entities, work item suggestions, observations

## File Structure

```text
chat/
  branch-chain.ts         # Linked list traversal for conversation branching
  branch-conversation.ts  # Branch-aware conversation history loading
  chat-ingress.ts         # Request validation, message persistence, SSE registration
  chat-processor.ts       # Async orchestration: extraction + context + response generation
  chat-route.ts           # HTTP route definitions for chat endpoints
  context.ts              # buildChatContext() / buildSystemPrompt() — loads graph state
  handler.ts              # runChatAgent() — streams chat agent responses with tool use
  trace-loader.ts         # Loads agent execution traces for context
  tools/
    index.ts              # createChatAgentTools() — registers all 18 tools
    types.ts              # ChatToolExecutionContext (actor-typed context)
    helpers.ts            # Shared tool utilities
    create-work-item.ts   # Direct entity creation in graph
    suggest-work-items.ts # Batch triage/dedup (>0.97 exact, >=0.8 merge, <0.8 new)
    get-entity-detail.ts  # Fetch entity with relationships and provenance
    get-project-status.ts # Project task/decision/question aggregation
    invoke-pm-agent.ts    # Dispatch to PM subagent
    invoke-analytics-agent.ts # Dispatch to Analytics subagent
    list-workspace-entities.ts # Browse entities by type
    ... (additional tool files)
```
