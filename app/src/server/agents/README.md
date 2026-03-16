# Agents

Specialized AI subagents that the chat orchestrator dispatches to handle domain-specific tasks — product management, analytics, and continuous graph verification.

## The Problem

A single chat agent cannot be an expert at everything. When a user asks "What's the status of project X?", the chat agent needs PM expertise. When they ask "How many tasks were completed last week?", it needs analytics skills. When the system needs to verify that a completed task actually matches its acceptance criteria, it needs an autonomous verifier. Cramming all of this into one prompt produces mediocre results across every domain.

## What It Does

- **PM Agent**: Manages work items — creates tasks/features, suggests work item batches with deduplication, checks project status, and organizes backlogs
- **Analytics Agent**: Answers data and business questions by generating SurrealQL queries against the knowledge graph, with few-shot examples and syntax reference
- **Observer Agent**: Autonomously verifies graph state — checks task completion claims, confirms decision implementations, and peer-reviews other observations

## Key Concepts

| Term | Definition |
|------|------------|
| **ToolLoopAgent** | Vercel AI SDK pattern where an agent iterates tool calls until it produces a final structured response |
| **Subagent Dispatch** | Chat agent invokes a subagent via tool call (e.g. `invoke_pm_agent`), delegating a scoped task |
| **Intent** | The reason for dispatching — `plan_work`, `check_status`, `organize`, `track_dependencies` (PM) or a natural language question (Analytics) |
| **Graph Coordination** | Agents write observations/suggestions to the graph, never to each other directly |
| **Verification Pipeline** | Observer checks claims against actual state via LLM reasoning with confidence scoring |

## How It Works

**PM Agent — work item triage:**

1. Chat agent calls `invoke_pm_agent` with intent `plan_work` and user context
2. PM agent loads workspace projects and open observations
3. Uses tools: `search_entities`, `get_project_status`, `suggest_work_items`, `create_work_item`, `create_observation`
4. Returns structured JSON: `{ summary, suggestions, updated, discarded, observations_created }`
5. Chat agent renders suggestions as `WorkItemSuggestionList` component blocks

**Analytics Agent — data question answering:**

1. Chat agent calls `invoke_analytics_agent` with the user's question
2. Analytics agent receives SurrealQL syntax reference and few-shot examples in its system prompt
3. Generates and executes SurrealQL queries against the workspace graph
4. Formats results as natural language answers with supporting data

**Observer Agent — state verification:**

1. Observer scan triggers verification of graph claims (e.g. "task X is complete")
2. Observer agent loads the claim and supporting evidence from the graph
3. Uses LLM reasoning to verify claim against evidence, producing confidence score
4. Peer review cross-validates findings to prevent false positives
5. Writes observations back to graph for human review

## Where It Fits

```text
User Message
  |
  v
Chat Agent (Sonnet, thin orchestrator)
  |
  +---> invoke_pm_agent ---------> PM Agent (Haiku)
  |                                  +-> search_entities
  |                                  +-> suggest_work_items
  |                                  +-> create_observation
  |                                  +-> structured JSON output
  |
  +---> invoke_analytics_agent ---> Analytics Agent (Haiku)
  |                                  +-> execute SurrealQL
  |                                  +-> format results
  |
  +---> (triggered by Observer scan)
                                    Observer Agent (Haiku)
                                     +-> verify task completion
                                     +-> confirm decision implementation
                                     +-> peer review observations
                                     +-> write findings to graph
```

**Consumes**: User intents via chat agent dispatch, graph state for context loading
**Produces**: Work item suggestions, analytics answers, verification observations

## File Structure

```text
agents/
  analytics/
    agent.ts            # ToolLoopAgent setup, query execution, result formatting
    few-shot-examples.ts # Example SurrealQL queries for in-context learning
    prompt.ts           # System prompt with workspace context injection
    syntax-reference.ts # SurrealQL syntax guide for query generation
    tools.ts            # Analytics-specific tools (execute_query)
  observer/
    agent.ts            # Verification agent with claim checking tools
    prompt.ts           # Observer system prompt with verification instructions
    tools.ts            # Observer tools (verify_claim, peer_review)
  pm/
    agent.ts            # PM ToolLoopAgent with structured JSON output schema
    prompt.ts           # PM system prompt with project/observation context
    tools.ts            # Composed shared tools (search, suggest, create)
```
