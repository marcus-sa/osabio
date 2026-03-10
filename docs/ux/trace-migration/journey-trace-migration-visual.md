# Journey: Migrate subagent_traces to trace table

## Data Flow Journey (Backend)

This is a backend data flow journey -- the "user" is the system itself (chat pipeline, API consumers, graph queries, frontend renderer). The emotional arc maps to system confidence: from fragmented dual-storage to unified graph-native traces.

## Flow Diagram

```
                         WRITE PATH
                         =========

  [User sends chat message]
         |
         v
  +------------------------------------------+
  | chat-route.ts: handleChatRequest         |
  |   streamText() -> onFinish callback      |
  +------------------------------------------+
         |
         | extract traces from tool parts
         | (tool-invoke_pm_agent output.trace)
         v
  +------------------------------------------+
  | CURRENT: persist as embedded array       |  <-- REMOVE
  |   message.subagent_traces = [...]        |
  +------------------------------------------+
         |
         | REPLACE WITH:
         v
  +------------------------------------------+
  | NEW: create trace records                |
  |                                          |
  |   trace:root (subagent_spawn)            |
  |     +-- trace:s1 (tool_call)             |
  |     +-- trace:s2 (message)               |
  |     +-- trace:s3 (tool_call)             |
  |                                          |
  |   RELATE message ->spawns-> trace:root   |
  +------------------------------------------+


                         READ PATHS
                         ==========

  Path A: Conversation Load (workspace-routes.ts)
  ------------------------------------------------
  [GET /api/workspaces/:id/conversations/:id]
         |
         v
  +------------------------------------------+
  | CURRENT: SELECT subagent_traces          |  <-- REMOVE
  |   FROM message WHERE conversation = $c   |
  +------------------------------------------+
         |
         | REPLACE WITH:
         v
  +------------------------------------------+
  | NEW: graph traversal from message        |
  |                                          |
  |   SELECT ->spawns->trace AS root_traces  |
  |   FROM message WHERE conversation = $c   |
  |                                          |
  |   For each root trace:                   |
  |   SELECT * FROM trace                    |
  |     WHERE parent_trace = $root           |
  |     ORDER BY created_at ASC              |
  +------------------------------------------+
         |
         v
  +------------------------------------------+
  | Map to API contract:                     |
  |   message.subagentTraces = [             |
  |     { agentId, intent, steps, duration } |
  |   ]                                      |
  | (wire format unchanged for frontend)     |
  +------------------------------------------+


  Path B: Branch Inheritance (branch-chain.ts)
  ------------------------------------------------
  [loadMessagesWithInheritance]
         |
         v
  +------------------------------------------+
  | CURRENT: SELECT subagent_traces          |  <-- REMOVE
  |   in every message query                 |
  +------------------------------------------+
         |
         | REPLACE WITH:
         v
  +------------------------------------------+
  | NEW: separate trace loading              |
  |   after message query, load traces via   |
  |   spawns edges for message batch         |
  +------------------------------------------+


  Path C: Graph Forensics (NEW capability)
  ------------------------------------------------
  +------------------------------------------+
  | SELECT ->spawns->trace.{                 |
  |   type, tool_name, duration_ms           |
  | } FROM message:xyz                       |
  |                                          |
  | -- OR full tree --                       |
  |                                          |
  | LET $root = SELECT ->spawns->trace       |
  |   FROM message:xyz;                      |
  | SELECT * FROM trace                      |
  |   WHERE parent_trace IN $root            |
  |   ORDER BY created_at ASC;              |
  +------------------------------------------+
```

## Emotional Arc (System Confidence)

```
  Confidence
  ^
  |                                               *** UNIFIED
  |                                          ****
  |                                     ****
  |                                ****
  |                           ****
  |         FRAGMENTED   ****
  |    ****          ****
  |****         ****
  +--+----+----+----+----+----+----+----+----> Steps
     |    |    |    |    |    |    |    |
   Schema Migration Write Read  Branch API  Graph  Test
   cleanup  0024   path  paths chain  contract query green
```

| Phase | System State | Confidence |
|-------|-------------|------------|
| Start | Two parallel trace systems, no connection | Low -- fragmented |
| Schema cleanup | Remove embedded fields, add spawns relation | Rising -- single schema |
| Write path | chat-route creates trace records + spawns edge | Rising -- data flows correctly |
| Read paths | workspace-routes + branch-chain load from graph | Rising -- consumers updated |
| API contract | Wire format preserved, source changed | Stable -- no frontend breakage |
| Graph query | `SELECT ->spawns->trace...` works | High -- new capability unlocked |
| Tests green | Acceptance test validates normalized structure | High -- verified |

## Shared Artifacts

| Artifact | Source of Truth | Consumers | Risk |
|----------|----------------|-----------|------|
| `trace` table schema | `schema/surreal-schema.surql` | write path, read paths, graph queries | HIGH -- schema mismatch drops data |
| `spawns` relation schema | `schema/surreal-schema.surql` (new) | chat-route write, workspace-routes read, branch-chain read | HIGH -- missing relation breaks traversal |
| `SubagentTrace` type | `app/src/shared/contracts.ts` | PM agent, chat-route, workspace-routes, branch-chain, test | HIGH -- type mismatch breaks compilation |
| API wire format | `WorkspaceBootstrapMessage.subagentTraces` | Frontend chat page | MEDIUM -- format change breaks rendering |
| `trace.type` enum | `schema/surreal-schema.surql` ASSERT | write path | MEDIUM -- invalid type rejected by schema |

## Integration Checkpoints

1. **Schema**: `spawns` relation defined as `TYPE RELATION IN message OUT trace` -- validates edge creation
2. **Write**: After `onFinish`, `SELECT ->spawns->trace FROM message:xyz` returns root trace with correct `type: "subagent_spawn"`
3. **Read (conversation)**: GET conversation endpoint returns `subagentTraces` array reconstructed from graph traversal -- same wire shape as before
4. **Read (branch)**: `loadMessagesWithInheritance` returns messages with traces loaded from graph -- inherited messages include traces
5. **Graph query**: `SELECT ->spawns->trace.{type, tool_name, duration_ms} FROM message:xyz` returns the call tree
6. **Test**: Acceptance test validates trace records exist in `trace` table with correct parent-child hierarchy
