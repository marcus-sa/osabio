# Unified Identity: Technology Stack

## No New Dependencies

This feature is implemented entirely within the existing technology stack. No new libraries, frameworks, or services are introduced.

| Layer | Technology | Version | License | Role in Feature |
|-------|-----------|---------|---------|-----------------|
| Database | SurrealDB | v3.0 | BSL 1.1 (existing) | Hub-spoke schema, migrations, graph traversals |
| Runtime | Bun | latest (existing) | MIT | Server runtime, migration runner |
| Language | TypeScript | 5.x (existing) | Apache 2.0 | Type changes, identity resolution logic |
| Auth | better-auth | latest (existing) | MIT | Session/account field mapping updates |
| SDK | surrealdb (JS) | v2 (existing) | Apache 2.0 | RecordId type changes, queries |
| AI SDK | Vercel AI SDK | latest (existing) | Apache 2.0 | Tool context type propagation |
| Embedding | OpenAI text-embedding-3-small | (existing) | Proprietary API | Entity embeddings unchanged (identity table has no embeddings) |

## Technology Decisions

### Why no dedicated identity service

**Decision**: Identity resolution remains an in-process module, not a separate service.

**Rationale**:
- Team size: 1 developer + AI agents. Operational overhead of a separate service is unjustified.
- Identity resolution is 1-2 SurrealDB queries. No computational complexity requiring isolation.
- All callers are in the same Bun process (chat handler, MCP auth, extraction pipeline).
- SurrealDB graph traversals (spoke edges) are native -- no need for caching layer.

### Why SurrealDB TYPE RELATION for spoke edges (not record links)

**Decision**: Use `identity_person` and `identity_agent` as TYPE RELATION tables, not embedded `record<person>` fields on identity.

**Rationale**:
- TYPE RELATION enables bidirectional graph traversal (`<-identity_person<-identity` from person side).
- Metadata on the edge (added_at) follows existing relation patterns (owns, member_of).
- SurrealDB indexes on relation `in`/`out` fields enable efficient spoke lookups.
- Embedded record links would require scanning identity table to find "which identity wraps this person."

### Why no embedding/vector search on identity

**Decision**: No embedding field or HNSW index on the identity table.

**Rationale**:
- Identity tables have low cardinality (~5-10 records per workspace: 1 owner + 3-5 template agents).
- Name-based and type-based lookups via B-tree indexes cover all resolution use cases.
- Adding HNSW would introduce unnecessary KNN+WHERE split workaround complexity for zero benefit.
- If multi-tenant workspaces with many members emerge later, adding an HNSW index is a single migration line.

### Why breaking schema change (no data migration)

**Decision**: Per project convention, schema changes are breaking. No backfill scripts.

**Rationale**:
- AGENTS.md: "This project does NOT maintain backwards compatibility with existing data."
- Identity bootstrap runs on workspace creation -- fresh data on next setup.
- Eliminates migration script complexity and rollback risk.

## SurrealDB Constraints and Workarounds

| Constraint | Impact | Workaround |
|-----------|--------|------------|
| KNN + WHERE bug | Not applicable — identity table has no HNSW index (low cardinality, B-tree only) | N/A |
| SCHEMAFULL conditional fields | Cannot enforce "agent_type required when type=agent" on single table | Hub-spoke: agent-specific fields on separate `agent` table with its own SCHEMAFULL |
| DEFINE ANALYZER outside transaction | If identity gets fulltext index, analyzer must precede BEGIN TRANSACTION | Place DEFINE ANALYZER before transaction block in migration |
| No ALTER TABLE ADD FIELD | Adding identity_id to session | Use DEFINE FIELD OVERWRITE |
| search::score in functions | If identity gets fulltext search | Run from app layer (existing pattern) |
