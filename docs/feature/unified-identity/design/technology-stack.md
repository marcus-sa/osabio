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
| Embedding | OpenAI text-embedding-3-small | (existing) | Proprietary API | Identity embeddings (same pipeline) |

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

### Why HNSW index on identity.embedding

**Decision**: Add HNSW vector index on identity table for semantic search.

**Rationale**:
- Chat agent's `search_entities` tool should find identities by semantic similarity (e.g., "who manages the PM agent?").
- Same 1536-dimension embedding model already used for all other entity tables.
- KNN+WHERE split pattern required (per documented SurrealDB v3.0 bug) since identity will have a workspace index.

### Why breaking schema change (no data migration)

**Decision**: Per project convention, schema changes are breaking. No backfill scripts.

**Rationale**:
- AGENTS.md: "This project does NOT maintain backwards compatibility with existing data."
- Identity bootstrap runs on workspace creation -- fresh data on next setup.
- Eliminates migration script complexity and rollback risk.

## SurrealDB Constraints and Workarounds

| Constraint | Impact | Workaround |
|-----------|--------|------------|
| KNN + WHERE bug | Identity vector search with workspace filter returns empty | Split into LET + filter (existing pattern) |
| SCHEMAFULL conditional fields | Cannot enforce "agent_type required when type=agent" on single table | Hub-spoke: agent-specific fields on separate `agent` table with its own SCHEMAFULL |
| DEFINE ANALYZER outside transaction | If identity gets fulltext index, analyzer must precede BEGIN TRANSACTION | Place DEFINE ANALYZER before transaction block in migration |
| No ALTER TABLE ADD FIELD | Adding identity_id to session | Use DEFINE FIELD OVERWRITE |
| search::score in functions | If identity gets fulltext search | Run from app layer (existing pattern) |
