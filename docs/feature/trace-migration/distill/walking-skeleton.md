# Walking Skeleton: Trace Migration

## Purpose

The walking skeleton proves the core data contract: trace records written to the `trace` table with `spawns` relation edges are reconstructed into the identical `SubagentTrace` wire format when loaded through existing API endpoints.

## Scope

The skeleton covers the **thinnest possible slice** through the system:

```
Seed trace records → spawns edge → conversation load API → SubagentTrace wire format
```

It does NOT cover:
- The write path (chat-route.ts onFinish) — that is the implementation target
- LLM-dependent PM agent invocation — covered by existing smoke test
- Schema migration execution — covered by `bun migrate`

## What Makes This a Skeleton

1. **One message, one trace, three steps** — minimal fixture that exercises all step types
2. **One API endpoint** — conversation detail (the primary read path)
3. **One assertion chain** — agentId, intent, duration, step count, step types

## User-Centric Scenario

```gherkin
Given a conversation with an assistant message
  And the assistant invoked the PM agent (trace records exist with spawns edge)
When the user reloads the conversation (GET /api/workspaces/:id/conversations/:id)
Then the message displays the PM agent's execution trace
  With the agent name, intent, duration, and tool call details
```

## Test Infrastructure

The skeleton uses **database-seeded fixtures** rather than LLM calls:

| Helper | Purpose |
|--------|---------|
| `seedConversation()` | Creates workspace + conversation via API, marks onboarding complete |
| `seedAssistantMessage()` | Inserts a message record directly |
| `seedTraceForMessage()` | Creates root trace + child traces + spawns edge |
| `makeSampleTrace()` | Returns a representative SubagentTrace fixture |

## Success Criteria

- [ ] Conversation load API returns `subagentTraces` on messages with spawns edges
- [ ] Wire format matches `SubagentTrace` contract (agentId, intent, totalDurationMs, steps[])
- [ ] Tool call steps have toolName, argsJson, resultJson, durationMs
- [ ] Text steps have text content (type mapped from "message" → "text")
- [ ] Messages without spawns edges omit `subagentTraces` (no empty arrays)
- [ ] Bootstrap endpoint also returns traces

## Handoff to DELIVER

The walking skeleton tests are currently **expected to fail** — they describe the target behavior after migration. The DELIVER wave implements:

1. **Schema migration** (0024): Define `spawns` relation, remove `subagent_traces` fields
2. **Write path** (chat-route.ts): Create trace records + spawns edge instead of embedding
3. **Read path** (workspace-routes.ts, branch-chain.ts): Batch-load traces via spawns edges, reconstruct wire format
4. **Trace loader** (new module): Shared batch loading function

Each DELIVER step should make one more test suite pass, in order:
1. Walking Skeleton → validates read path
2. Graph Queryability → validates data integrity
3. Batch Loading → validates multi-message pattern
4. Branch Inheritance → validates cross-conversation concerns
