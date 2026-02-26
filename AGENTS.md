## Data Value Contract

- Never persist, publish, or return `null` for domain data values (Surreal records, API payloads, events, UI state).
- Absence must be represented by omitted optional fields only (`field?: Type`), not by `null`.
- If `null` appears in domain data, treat it as a contract violation and fix the producer. Do NOT sanitize/coerce it at consumers.

## TypeScript Conventions

- Do NOT use `null`. Use `undefined` via optional properties (`field?: Type`) instead.
- Do NOT create wrapper/helper functions for simple operations. Cast directly with `as`.
- Type result payloads once and avoid repetitive per-field casting.



## Failure Handling

- Do NOT add fallback logic that masks invalid state, malformed payloads, or contract violations.
- Fail fast: throw immediately when required data is missing or does not match the expected shape.
- Prefer explicit hard failures over silent degradation, synthetic defaults, or "best effort" recovery.
- Only introduce fallback behavior when explicitly requested, and document the reason in code comments.

## Testing Setup

- Install deps: `bun install`
- Run deterministic unit tests (no LLM/API calls): `bun test tests/unit/`
- Run smoke test: `bun test tests/smoke/`
- Run eval suite: `bun run eval`
- Run eval watch mode: `bun run eval:watch`

### Smoke Test Isolation

- Smoke tests create an isolated Surreal namespace/database, apply `schema/surreal-schema.surql`, run assertions, then remove the test DB/namespace.
- Smoke tests require a reachable SurrealDB server at `SURREAL_URL` with credentials from env.
- Smoke tests boot a dedicated app server process with test `SURREAL_NAMESPACE`, `SURREAL_DATABASE`, and `PORT`; do not point smoke runs at shared production-like DBs.

### Eval Requirements

- Evals call the real extraction model through existing app wiring.
- Required env: `OPENROUTER_API_KEY` and `EXTRACTION_MODEL` (set to Haiku model when needed).
- Optional env:
  - `AUTOEVAL_MODEL` for `autoevals` factuality scorer model override.
  - `EVAL_RESULTS_DIR` for evalite sqlite output.
  - `EVAL_CACHE_DIR` for extraction eval cache.

## SurrealDB SDK v2

Reference: https://surrealdb.com/learn/fundamentals/schemafull/define-fields

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
- ORDER BY fields must be in the SELECT clause - you cannot order by fields not selected.
- Always include every `ORDER BY` field in the `SELECT` projection. Example: if ordering decisions/questions by `created_at DESC`, select `summary, created_at` or `text, created_at` (not just `summary` / `text`).
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

# SurrealDB Documentation References

Curated links for coding agents building the AI-native business management platform. Organized by the three SurrealDB capabilities we use: graph, vector, and document.

---

## Getting Started

- **JS/TS SDK Overview:** https://surrealdb.com/docs/sdk/javascript
- **JS SDK Quick Start:** https://surrealdb.com/docs/sdk/javascript/start
- **JS SDK Core Concepts (connect, auth, query):** https://surrealdb.com/docs/sdk/javascript/core
- **Node.js Engine (embedded SurrealDB in Node):** https://surrealdb.com/docs/sdk/javascript/engines/node
- **React Integration:** https://surrealdb.com/docs/sdk/javascript/frameworks/react
- **SDK GitHub repo (v2 alpha examples):** https://github.com/surrealdb/surrealdb.js

## SurrealQL Essentials

- **SurrealQL Overview:** https://surrealdb.com/docs/surrealql
- **SELECT:** https://surrealdb.com/docs/surrealql/statements/select
- **CREATE:** https://surrealdb.com/docs/surrealql/statements/create
- **UPDATE:** https://surrealdb.com/docs/surrealql/statements/update
- **DELETE:** https://surrealdb.com/docs/surrealql/statements/delete
- **LET (variables):** https://surrealdb.com/docs/surrealql/statements/let
- **INSERT:** https://surrealdb.com/docs/surrealql/statements/insert

## Schema Definition

- **DEFINE TABLE:** https://surrealdb.com/docs/surrealql/statements/define/table
- **DEFINE FIELD (types, defaults, assertions):** https://surrealdb.com/docs/surrealql/statements/define/field
- **DEFINE INDEX (unique, full-text, vector):** https://surrealdb.com/docs/surrealql/statements/define/indexes
- **DEFINE EVENT (triggers on record changes):** https://surrealdb.com/docs/surrealql/statements/define/event
- **DEFINE FUNCTION (reusable SurrealQL functions):** https://surrealdb.com/docs/surrealql/statements/define/function

## Graph Relationships (Critical for our data model)

- **Graph Model Overview (best practices, when to use edges vs record links):** https://surrealdb.com/docs/surrealdb/models/graph
- **RELATE Statement (create edges):** https://surrealdb.com/docs/surrealql/statements/relate
- **Graph Relations Fundamentals (RELATE, INSERT RELATION, arrow syntax):** https://surrealdb.com/learn/fundamentals/relationships/graph-relations
- **Three Ways to Model Relationships (record links vs references vs graph edges):** https://surrealdb.com/blog/three-ways-to-model-data-relationships-in-surrealdb
- **Graph Traversal, Recursion & Shortest Path:** https://surrealdb.com/blog/data-analysis-using-graph-traversal-recursion-and-shortest-path

### Key SurrealQL graph syntax:
```sql
-- Create edge
RELATE person:marcus->owns->project:brain;

-- Traverse forward
SELECT ->owns->project FROM person:marcus;

-- Traverse backward
SELECT <-owns<-person FROM project:brain;

-- Multi-hop
SELECT ->has_feature->feature->has_task->task FROM project:brain;

-- Bidirectional
SELECT <->conflicts_with<->decision FROM decision:d1;

-- Edge with metadata
RELATE decision:d1->conflicts_with->decision:d2
  SET severity = 'hard', description = 'Contradictory deadlines';

-- Recursive traversal (org tree, dependency chains)
record:root.{..}.{ id, ->depends_on->task.@ };

-- TYPE RELATION enforces edge-only tables
DEFINE TABLE owns TYPE RELATION IN person OUT project | feature | task;
```

## Vector Search (For semantic search + RAG context)

- **Vector Search Reference Guide:** https://surrealdb.com/docs/surrealdb/reference-guide/vector-search
- **DEFINE INDEX (HNSW & MTREE):** https://surrealdb.com/docs/surrealql/statements/define/indexes
- **OpenAI Embeddings Integration:** https://surrealdb.com/docs/integrations/embeddings/openai
- **Mistral Embeddings Integration:** https://surrealdb.com/docs/integrations/embeddings/mistral
- **Python Embeddings (patterns transferable to JS):** https://surrealdb.com/docs/integrations/embeddings/python
- **Full-Text to Vector Search Migration Guide:** https://surrealdb.com/blog/moving-from-full-text-search-to-vector-search-in-surrealdb
- **Hybrid Search (vector + full-text with RRF):** https://surrealdb.com/blog/hybrid-vector-text-search-in-the-terminal-with-surrealdb-and-ratatui
- **Search Functions (search::score, search::rrf):** https://surrealdb.com/docs/surrealql/functions/database/search
- **Vector Functions (distance, similarity):** https://surrealdb.com/docs/surrealql/functions/database/vector

### Key SurrealQL vector syntax:
```sql
-- Define embedding field + HNSW index
DEFINE FIELD embedding ON conversation TYPE array<float>;
DEFINE INDEX idx_conv_embedding ON conversation FIELDS embedding
  HNSW DIMENSION 1536 DIST COSINE;

-- KNN search (top 5 nearest neighbors)
SELECT *, vector::similarity::cosine(embedding, $query_vec) AS similarity
FROM conversation
WHERE embedding <|5, COSINE|> $query_vec
ORDER BY similarity DESC;

-- Hybrid search (vector + full-text via RRF)
LET $vs = SELECT id FROM conversation WHERE embedding <|5, COSINE|> $query_vec;
LET $ft = SELECT id, search::score(1) AS score FROM conversation WHERE text @1@ 'decision about auth';
RETURN search::rrf([$vs, $ft], 5);
```

## Real-Time & Live Queries

- **Live Query Streaming:** https://surrealdb.com/docs/sdk/javascript/core/streaming
- **LIVE SELECT:** https://surrealdb.com/docs/surrealql/statements/live

Useful for pushing graph updates to the frontend in real time (new entity extracted -> graph view updates, new conflict detected -> feed updates).

## Full-Text Search

- **DEFINE ANALYZER:** https://surrealdb.com/docs/surrealql/statements/define/analyzer
- **Search Functions:** https://surrealdb.com/docs/surrealql/functions/database/search

## Useful Built-in Functions

- **Time Functions (time::now, time::floor, etc.):** https://surrealdb.com/docs/surrealql/functions/database/time
- **Array Functions (array::group, array::flatten, etc.):** https://surrealdb.com/docs/surrealql/functions/database/array
- **String Functions:** https://surrealdb.com/docs/surrealql/functions/database/string
- **Record Functions (record::id, record::table):** https://surrealdb.com/docs/surrealql/functions/database/record
- **Math Functions:** https://surrealdb.com/docs/surrealql/functions/database/math

## Auth & Permissions

- **Authentication Overview:** https://surrealdb.com/docs/surrealdb/security/authentication
- **DEFINE USER:** https://surrealdb.com/docs/surrealql/statements/define/user
- **DEFINE TOKEN:** https://surrealdb.com/docs/surrealql/statements/define/token

## Tools

- **Surrealist (GUI client for local inspection/debugging):** https://surrealdb.com/surrealist
- **CLI Reference (surreal start, import, export):** https://surrealdb.com/docs/surrealdb/cli

---

## Platform-Specific Patterns

### Pattern: Extraction Pipeline Write
After the LLM extracts entities from a message, write them to the graph in a single transaction:
```sql
BEGIN TRANSACTION;
  -- Create entities
  LET $task = CREATE task SET title = $title, status = 'open', owner = $owner;
  LET $decision = CREATE decision SET summary = $summary, status = 'extracted', confidence = $conf;
  
  -- Create relationships
  RELATE $decision->decided_in->$conversation;
  RELATE $decision->belongs_to->$project;
  RELATE $task->belongs_to->$feature;
  RELATE $person->owns->$task;
COMMIT TRANSACTION;
```

### Pattern: Cross-Project Conflict Detection
Traverse the graph to find related entities across projects:
```sql
-- Find all decisions in projects that share dependencies
SELECT 
  id, summary, status,
  <-belongs_to<-project AS projects,
  ->conflicts_with->decision AS conflicts
FROM decision
WHERE status IN ['extracted', 'proposed', 'confirmed']
  AND <-belongs_to<-project != $current_project;
```

### Pattern: Context Packet for MCP Server
Build a token-budgeted context packet for coding agents:
```sql
-- Active decisions for a project
SELECT summary, rationale, status, decided_at
FROM decision
WHERE <-belongs_to<-project = $project
  AND status IN ['confirmed', 'proposed']
ORDER BY decided_at DESC
LIMIT 20;

-- Dependency chain for current task
SELECT 
  id, title, status,
  ->depends_on->task.{id, title, status} AS dependencies
FROM task
WHERE id = $current_task;
```
