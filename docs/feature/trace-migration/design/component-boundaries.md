# Component Boundaries: Trace Migration

## Boundary Map

```
┌─────────────────────────────────────────────────────────┐
│ Schema Layer                                             │
│   schema/migrations/0024_spawns_relation.surql           │
│   schema/surreal-schema.surql                            │
│   Owns: spawns relation definition, message field removal│
└────────────────────────┬────────────────────────────────┘
                         │ schema applied via bun migrate
                         ▼
┌─────────────────────────────────────────────────────────┐
│ Write Layer (chat-route.ts onFinish)                     │
│   Input: SubagentTrace from PM agent tool output         │
│   Output: trace records + spawns edge in SurrealDB       │
│   Boundary: Consumes SubagentTrace, produces trace rows  │
│   Error handling: catch + log, do not block message      │
└────────────────────────┬────────────────────────────────┘
                         │ trace records in DB
                         ▼
┌─────────────────────────────────────────────────────────┐
│ Read Layer                                               │
│                                                          │
│ ┌─ workspace-routes.ts ──────────────────────────────┐  │
│ │  Bootstrap endpoint + conversation detail endpoint  │  │
│ │  Calls trace batch loader, returns wire format      │  │
│ └────────────────────────────────────────────────────┘  │
│                                                          │
│ ┌─ branch-chain.ts ─────────────────────────────────┐   │
│ │  loadMessagesWithInheritance                       │   │
│ │  Loads traces via spawns edges for message batches  │   │
│ │  Returns InheritableMessage with trace data         │   │
│ └────────────────────────────────────────────────────┘  │
│                                                          │
│ Shared: Trace batch loader function (new)                │
│   Input: message RecordId[]                              │
│   Output: Map<messageId, SubagentTrace[]>                │
└─────────────────────────────────────────────────────────┘
```

## Component Responsibilities

### 1. Migration Script (0024)
- **Owns**: `spawns` table definition, `subagent_traces` field removal
- **Depends on**: Migration 0023 (trace table exists)
- **Consumers**: All components that read/write traces

### 2. Trace Writer (chat-route.ts onFinish)
- **Owns**: Mapping SubagentTrace → trace records + spawns edge
- **Depends on**: SubagentTrace type (contracts.ts), spawns relation (schema)
- **Does NOT own**: SubagentTrace production (PM agent owns that)

### 3. Trace Batch Loader (new function)
- **Owns**: Efficient batch loading of traces for a set of messages
- **Depends on**: spawns relation, trace table, SurrealDB connection
- **Consumers**: workspace-routes.ts, branch-chain.ts

### 4. Trace Reconstructor (inline in batch loader)
- **Owns**: Mapping trace records back to SubagentTrace wire format
- **Depends on**: trace record shape, SubagentTrace/SubagentTraceStep types
- **Contract**: Output must be byte-identical to previous embedded format

## Unchanged Components

| Component | Why Unchanged |
|-----------|---------------|
| `agents/pm/agent.ts` | PM agent still returns SubagentTrace — only persistence changes |
| `shared/contracts.ts` | SubagentTrace type preserved — wire format unchanged |
| `chat/tools/invoke-pm-agent.ts` | Tool definition unchanged |
| Frontend chat page | Consumes same API wire format |

## Dependency Inversion

The write and read layers depend on:
1. **Schema** (trace table fields, spawns relation) — defined in migration
2. **SubagentTrace type** (contracts.ts) — shared contract

They do NOT depend on each other. The write layer produces records; the read layer consumes records. The database is the integration point.

## New Function Placement

The trace batch loader function should live alongside the existing trace query patterns. Options:

- **Option A**: In `branch-chain.ts` as a private helper, re-exported for workspace-routes
- **Option B**: In a new `app/src/server/chat/trace-loader.ts` module

**Recommendation**: Option B — keeps branch-chain focused on message inheritance, and the batch loader is used by both workspace-routes and branch-chain.
