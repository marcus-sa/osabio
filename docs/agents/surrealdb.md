## Schema & Data Migration

- This project does NOT maintain backwards compatibility with existing data. Schema changes are breaking.
- Do NOT write data migration or backfill scripts. Old data is discarded on schema changes.
- New fields should be required (not optional) from the start — no need for `option<...>` to accommodate pre-existing records.

### SurrealDB Schema Migration Workflow

- Create a versioned `.surql` migration script for each schema change.
- Migration filenames MUST use a zero-padded autoincrement numeric prefix, followed by an underscore and slug (for example `schema/migrations/0008_add_task_priority.surql`).
- Determine the next prefix by scanning `schema/migrations` and incrementing the highest existing prefix. Do NOT reuse or renumber existing migration files.
- Apply migrations with `bun migrate` — the migration runner (`schema/migrate.ts`) tracks applied migrations in a `_migration` table and only runs pending ones.
- Do NOT apply migrations manually via `surreal import` or raw HTTP calls — always use `bun migrate`.
- Wrap migration scripts in `BEGIN TRANSACTION; ... COMMIT TRANSACTION;` so they succeed or fail atomically.
- `DEFINE ANALYZER` cannot run inside a transaction in SurrealDB v3.0. Place it before the `BEGIN TRANSACTION;` block.
- In `DEFINE FIELD` statements, `FLEXIBLE` must come after `TYPE`: `DEFINE FIELD ... TYPE object | array FLEXIBLE;`. Using `FLEXIBLE` without a `TYPE` keyword (e.g. `ON policy FLEXIBLE;`) causes a SurrealDB parse error that silently fails eval/test setup via transaction rollback.
- Prefer `DEFINE ... OVERWRITE` or `ALTER TABLE` / `ALTER FIELD` for schema evolution; reserve `IF NOT EXISTS` for bootstrap-only creation.
- SurrealDB does NOT support `ALTER TABLE ... ADD FIELD`. To add fields to existing tables, use `DEFINE FIELD OVERWRITE <field> ON <table> TYPE <type>;`.
- When removing fields, update schema and stored rows in the same migration (`REMOVE FIELD ...; UPDATE ... UNSET ...;`).
- Verify applied schema with `INFO FOR TABLE <table>;` in the target namespace/database.

### SurrealDB Existing Data Migration (Explicit Exception Only)

- Default project policy is still no backfills; only run existing-data migrations when explicitly requested by the user.
- Snapshot before mutation with `surreal export --ns <namespace> --db <database> <backup-file>`.
- Run data transforms in versioned `.surql` scripts applied via `bun migrate`.
- Use a transaction for multi-step migrations:
  - `BEGIN TRANSACTION;`
  - apply schema updates (`DEFINE ... OVERWRITE` / `ALTER`)
  - backfill with `UPDATE ... WHERE ...`
  - rewrite relationships with `RELATE` (do NOT use `CREATE` for `TYPE RELATION` tables)
  - clean old keys with `REMOVE FIELD ...; UPDATE ... UNSET ...;`
  - `COMMIT TRANSACTION;`
- In this codebase, represent missing values as omitted fields / `NONE` (never `null`) during data transforms.
- Validate scripts with `surreal validate <migration-file>` before apply if the `surreal` CLI is available.
- Verify result counts and shape after apply (`SELECT count() ...`, `INFO FOR TABLE ...`).

## Schema Awareness

- Always read `schema/surreal-schema.surql` before writing queries, seed data, or any code that creates/updates SurrealDB records. The schema defines required fields, types, and relations — guessing leads to silent `SCHEMAFULL` rejections.

## SurrealDB EVENT Webhook Timing

- SurrealDB `DEFINE EVENT` HTTP webhooks can fire before the triggering write is visible to other requests.
- Prefer `DEFINE EVENT ... ASYNC` for webhook-style side effects so callback execution runs after the triggering write commits.
- Use `RETRY <n>` on webhook events to reduce transient callback/network flakiness.
- For intent authorization (`draft -> pending_auth`), avoid synchronous webhook flows that immediately re-read/update the same intent unless the event is `ASYNC`.
- If a webhook path must do DB follow-up without `ASYNC`, wait briefly for the triggering transition to commit before applying routing/state transitions.
- If async follow-up work is needed in route handlers, track it with `deps.inflight.track(...)`.

## RecordId and Table Access Rules

- After request parsing, use `RecordId` objects everywhere for Surreal identifiers (never raw `table:id` strings in internal logic).
- Server extraction types define typed record aliases:
  - `GraphEntityRecord` and `SourceRecord` are `RecordId<UnionOfTables, string>` aliases.
- Use `record.table.name` for table branching (the SDK's public API; `.tb` is an undeclared internal field that may break on upgrade).

## RecordId Wire Format Contract (Strict)

- Do NOT use one universal ID string format across all API fields. ID format is field-specific and enforced.
- Fixed-table ID fields (for example: `session_id`, `task_id`, `project_id`, `workspace_id`) MUST be raw IDs only (UUID/string without `table:` prefix).
- Polymorphic entity reference fields (for example: `entity_id`, `target`) MAY use `table:id`, but only when the field is explicitly documented as polymorphic.
- Parse IDs exactly once at the HTTP/CLI boundary:
  - fixed-table fields: `new RecordId("<known_table>", rawId)`
  - polymorphic fields: parse `table:id` with table allowlist validation, then convert to `RecordId`
- Never re-wrap prefixed values: reject fixed-table IDs containing `:` with a hard error instead of attempting recovery.
- Never emit fixed-table IDs as `table:id` in API responses or CLI cache payloads. Emit raw IDs only.
- If table context must be returned to clients, return it in a separate field (for example: `{ id: "<raw>", table: "task" }`), not by prefixing `id`.
- `table:id` strings are for explicit polymorphic references only; they are not a general serialization format for all IDs.
- Forbidden pattern: `new RecordId("agent_session", "agent_session:uuid")` (creates nested/mismatched IDs like `agent_session:⟨agent_session:uuid⟩`).
- Any change touching ID read/write paths MUST include tests that cover:
  - fixed-table round-trip (`raw -> RecordId -> raw`)
  - polymorphic parse/validation (`table:id -> RecordId`)
  - rejection of prefixed input in fixed-table fields.

## SurrealDB Query Batching

- Do NOT issue multiple sequential `surreal.query()` calls when the queries share the same bound parameters. Combine them into a single `.query()` call with multiple statements separated by semicolons — this executes in one round-trip.
- The SDK returns a typed tuple matching the statement order: `surreal.query<[ResultA[], ResultB[], ResultC[]]>("SELECT ...; SELECT ...; SELECT ...;", vars)`.
- For `LET` + `SELECT` pairs (e.g. two-step KNN pattern), `LET` occupies result indices too: a query with `LET $a = ...; SELECT FROM $a; LET $b = ...; SELECT FROM $b;` returns results at indices `[0, 1, 2, 3]` where the `SELECT` results are at odd indices `[1, 3]`.
- Multiple statements in a single `.query()` call do not trigger WebSocket concurrency issues; those only apply to multiple parallel `.query()` calls on the same connection.

## SurrealDB KNN + WHERE Bug (v3.0)

- SurrealDB v3.0 query planner silently returns empty results when a WHERE clause combines a KNN operator (`<|K, COSINE|>`, which uses the HNSW index) with a condition covered by a regular B-tree index (e.g. `workspace = $ws` when a `workspace` index exists).
- Tables WITHOUT a B-tree index on the filtered field work fine with KNN + WHERE in the same clause.
- Workaround: split into two steps — KNN in a `LET` subquery (HNSW index only), then filter by workspace in a second query (B-tree index only):
  ```sql
  -- BROKEN: both indexes conflict
  SELECT ... FROM task WHERE workspace = $ws AND embedding <|20, COSINE|> $vec;

  -- WORKS: separate index usage
  LET $candidates = SELECT ..., workspace FROM task WHERE embedding <|20, COSINE|> $vec;
  SELECT ... FROM $candidates WHERE workspace = $ws ORDER BY similarity DESC LIMIT $limit;
  ```
- Apply this pattern to ALL KNN queries on tables that have a regular index on the filtered field.

## SurrealDB Full-Text Search (BM25)

Reference: https://surrealdb.com/docs/surrealql/functions/database/search

The UI entity search uses SurrealDB's built-in BM25 full-text search, not vector/KNN search. Vector search is reserved for the chat agent's `search_entities` tool where semantic similarity matters.

### Setup

Full-text search requires an analyzer and `FULLTEXT` indexes:
```sql
-- Analyzer with stemming (English snowball) and lowercase normalization
DEFINE ANALYZER entity_search
  TOKENIZERS blank, class, camel, punct
  FILTERS snowball(english), lowercase;

-- Per-field fulltext index (one index per field, not per table)
DEFINE INDEX idx_task_fulltext ON task FIELDS title FULLTEXT ANALYZER entity_search BM25;
```

### Query syntax

- Use the `@N@` match operator (N is a predicate reference number for `search::score`):
  ```sql
  SELECT id, title, search::score(1) AS score
  FROM task
  WHERE title @1@ $query
  ORDER BY score DESC LIMIT 10;
  ```
- `search::score(N)` returns the BM25 relevance score for predicate N.
- `search::highlight('<b>', '</b>', N)` returns text with matching tokens wrapped in tags.
### Known limitations (SurrealDB v3.0.4)

- `search::score()` and `@N@` do NOT work inside `DEFINE FUNCTION` — the predicate reference is lost across the function boundary. Search queries must run from the app layer. See: https://github.com/surrealdb/surrealdb/issues/7013
- A single `@N@` predicate performs AND matching — all query terms must exist in the document. Do NOT pass multi-word text to a single `@N@`. Instead, use OR across separate predicates: `field @0@ $t0 OR field @1@ $t1 OR field @2@ $t2` with `search::score(0) + search::score(1) + search::score(2)` as combined score. This gives embedding-like recall where more shared terms = higher rank. See: https://surrealdb.com/docs/surrealdb/models/full-text-search
- Use `extractSearchTerms()` from `graph/bm25-search.ts` to strip stopwords before building OR-predicate queries.
- Always use `BM25(1.2, 0.75)` — without explicit parameters, behavior is undefined.

### BM25 OR-predicate pattern (preferred)

When searching with multiple terms, use the OR-predicate pattern in a single round-trip instead of looping N queries from TypeScript:
```sql
-- Each term gets its own predicate number and bound param
SELECT id, title, search::score(0) + search::score(1) + search::score(2) AS score
FROM task
WHERE (title @0@ $t0 OR title @1@ $t1 OR title @2@ $t2)
AND workspace = $ws
ORDER BY score DESC LIMIT 10;
```
Build dynamically with `extractSearchTerms()`:
```typescript
import { extractSearchTerms } from "../graph/bm25-search";

const termList = extractSearchTerms(text).split(" ").filter(t => t.length > 0);
const matchClause = termList.map((_, i) => `field @${i}@ $t${i}`).join(" OR ");
const scoreExpr = termList.map((_, i) => `search::score(${i})`).join(" + ");
const bindings: Record<string, unknown> = { ws: workspaceRecord };
termList.forEach((term, i) => { bindings[`t${i}`] = term; });
```

### SurrealDB v3.0.4 UNIQUE Index Bug

- `UNIQUE` indexes on fields that include `option<record<...>>` types silently return empty results for WHERE queries. The data exists (verified via unfiltered SELECT and JS-side filtering) but WHERE clauses return 0 rows when the UNIQUE index is present.
- Workaround: use a plain (non-UNIQUE) index instead. See: https://github.com/surrealdb/surrealdb/issues/7139
- `DEFINE INDEX OVERWRITE` after data insertion does NOT fix the issue. Only removing `UNIQUE` resolves it.

### Entity search implementation

Search queries run from the app layer (`entity-search-route.ts`) instead of SurrealDB stored functions due to the limitations above. Fulltext indexes are defined in `schema/migrations/0002_fulltext_search_indexes.surql`.

## SurrealDB Protected Variables

- `$session` is a protected variable in SurrealDB v3.0 and cannot be used as a bound query parameter. Using it causes `'session' is a protected variable and cannot be set` errors that silently fail after retries.
- Use `$sess` (or another non-reserved name) instead when binding `RecordId<"agent_session", string>` values in queries like `RELATE $sess->invoked->$trace`.
- Other known protected variables: `$auth`, `$token`, `$session`, `$before`, `$after`, `$event`, `$this`, `$parent`, `$value`. Always avoid these as bound parameter names.

## SurrealDB SDK v2

Reference: https://surrealdb.com/learn/fundamentals/schemafull/define-fields

- Do NOT use `.tb` on `RecordId` — it works at runtime but is not in the SDK type definition and may break on upgrade. Use `.table.name` instead (returns the same typed `Tb` string via the public API).
- When using `http://` or `https://` URLs, the SDK uses HTTP transport only. It does NOT attempt WebSocket upgrade.
- WebSocket is only used when the URL scheme is `ws://` or `wss://`.
- To CREATE a record with a specific ID, use the SDK's `RecordId` class:
  ```typescript
  import { RecordId } from "surrealdb";
  const record = new RecordId("table", "my-id");
  await query("CREATE $record CONTENT $content;", { record, content: {...} });
  ```
- To SELECT a specific record by ID, use `RecordId` in the FROM clause:
  ```typescript
  const record = new RecordId("gladiator", id);
  await query("SELECT * FROM $record;", { record });
  ```
- Do NOT use string-based record IDs like `table:id` in queries - use `RecordId` objects.
- For optional record fields (e.g. `option<record<match>>`), omit the field instead of setting `null` - SurrealDB defaults to `NONE`.
- Query results return `RecordId` objects for record references - cast directly, no string conversion needed.
- Clause order: `SELECT ... FROM ... WHERE ... LIMIT ... FETCH ...` - `LIMIT` must come before `FETCH`.
- **ORDER BY fields MUST be in the SELECT projection.** SurrealDB v3.0 raises a hard parse error (`Missing order idiom ... in statement selection`) when an ORDER BY field is not selected. This fails at query time, not at schema time, so it often hides until the query is actually executed. Always include every `ORDER BY` field in the `SELECT` projection. Example: `SELECT id, summary, created_at FROM decision ORDER BY created_at DESC` (not `SELECT id, summary ... ORDER BY created_at`).
- Known issue: Surreal can throw `Expected a single result output when using the ONLY keyword` when a statement uses `ONLY` and returns no record output.
- Workaround: force a return clause. In SDK calls that map to `ONLY` (for example `relate(...)`), use `.output("after")` so the statement returns a record.
- Type query results directly. Access `RecordId.id` directly - do NOT create wrapper functions like `extractRecordId()`, `toString()`, etc:
  ```typescript
  const rows = await selectMany("SELECT id, name FROM gladiator WHERE totalWins > 0;") as Array<{ id: RecordId; name: string }>;
  const result = rows.map((row) => ({ gladiatorId: row.id.id as string, name: row.name }));
  ```
- Do NOT use `FETCH` in queries if you need the raw RecordId reference. `FETCH` resolves references to full objects.
- For `TYPE RELATION` tables, do NOT write edges with `CREATE`. `CREATE` produces non-relation records and will fail relation constraints. Use `RELATE` (or SDK `relate(...)`) to create actual relation edges.
- For nested arrays (2D grids), use explicit type: `DEFINE FIELD grid ON match TYPE array<array<string>>;` - plain `array` silently rejects nested arrays in SCHEMAFULL mode.
- Keep all Surreal tables in `schema/surreal-schema.surql` as `SCHEMAFULL`. Do NOT introduce `SCHEMALESS` tables.
- In `SCHEMAFULL`, every persisted nested key must be explicitly declared. For `array<object>` fields, always define `field[*].subField` entries for all written properties.
- Do NOT rely on permissive object inference for production payloads. If code writes a new key, update schema in the same change before deploy.
- After schema changes, verify with `INFO FOR TABLE <table>;` in the target namespace/database to confirm nested fields are present.
