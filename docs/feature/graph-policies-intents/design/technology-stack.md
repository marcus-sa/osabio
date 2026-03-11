# Technology Stack: Graph Policies and Intents

No new technology dependencies. All work extends the existing stack.

## Existing Stack (Unchanged)

| Layer | Technology | License | Role |
|-------|-----------|---------|------|
| Runtime | Bun 1.x | MIT | Server runtime |
| Language | TypeScript 5.x | Apache-2.0 | Type-safe development |
| Database | SurrealDB 3.0 | BSL 1.1 | Graph database, schema, stored functions |
| DB SDK | surrealdb.js v2 | Apache-2.0 | TypeScript SDK for SurrealDB |
| Frontend | React 19 | MIT | UI framework |
| Graph viz | reagraph | MIT | WebGL-based graph rendering |
| Bundler | Vite | MIT | Frontend build |

## Files Modified (No New Dependencies)

### Server-side
- `app/src/shared/contracts.ts` -- type union extension
- `app/src/server/graph/queries.ts` -- entity resolution extension
- `app/src/server/graph/transform.ts` -- hex color mapping extension
- `app/src/server/graph/graph-route.ts` -- allowlist extension
- `app/src/server/feed/feed-queries.ts` -- new query function + name resolver extension
- `app/src/server/feed/feed-route.ts` -- feed wiring extension

### Client-side
- `app/src/client/components/graph/graph-theme.ts` -- color + edge style extension
- `app/src/client/components/graph/EntityBadge.tsx` -- label mapping extension
- CSS stylesheet (crafter determines location) -- new `--entity-policy` CSS custom properties

### Schema
- New migration: `schema/migrations/0026_graph_governance_functions.surql` -- updates 3 SurrealQL functions
