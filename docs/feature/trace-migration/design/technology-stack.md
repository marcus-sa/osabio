# Technology Stack: Trace Migration

No new technologies introduced. This feature operates entirely within the existing stack.

## Stack (Unchanged)

| Layer | Technology | Role in Feature |
|-------|-----------|-----------------|
| Database | SurrealDB v3.0 | Stores trace records, spawns edges, message records |
| Runtime | Bun | Server runtime |
| HTTP Framework | Hono | Route handlers for workspace API |
| AI SDK | Vercel AI SDK | Tool loop execution for PM agent |
| Language | TypeScript (functional paradigm) | All implementation |
| Test Framework | Bun test | Acceptance tests |

## SurrealDB Features Used

| Feature | Usage |
|---------|-------|
| `TYPE RELATION` tables | `spawns` relation edge (message → trace) |
| Graph traversal (`->edge->table`) | Read path: `SELECT ->spawns->trace FROM message` |
| Reverse traversal (`<-edge<-table`) | Batch loader: `<-spawns<-message` to find source message |
| `INSIDE` operator | Batch queries: `WHERE <-spawns<-message INSIDE $ids` |
| Transactions | Atomic trace creation + edge creation |
| `option<object> FLEXIBLE` | Trace `input`/`output` fields for tool args/results |
| `ASSERT` enum | Trace type validation (already includes `subagent_spawn`) |

## No New Dependencies

- No new npm packages
- No new SurrealDB features beyond what's already used
- No new external services
