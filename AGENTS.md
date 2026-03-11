## Git Commits

- Always use `--no-verify` when committing. The pre-commit hook requires `brain init` which is not available in worktree environments.
- Always use `-s` (GPG sign) when committing.

## Data Value Contract

- Never persist, publish, or return `null` for domain data values (Surreal records, API payloads, events, UI state).
- Absence must be represented by omitted optional fields only (`field?: Type`), not by `null`.
- If `null` appears in domain data, treat it as a contract violation and fix the producer. Do NOT sanitize/coerce it at consumers.

## TypeScript Conventions

- Do NOT use `null`. Use `undefined` via optional properties (`field?: Type`) instead.
- Do NOT create wrapper/helper functions for simple operations. Cast directly with `as`.
- Type result payloads once and avoid repetitive per-field casting.
- Do NOT use module-level mutable singletons (e.g. `let cache` at file scope) for caching or shared state. Module-level state is shared across the entire process — when multiple server instances run concurrently (e.g. smoke tests with `--concurrent`), they silently corrupt each other. Pass shared state via dependency injection or use per-instance caches scoped to the owning object.



## LLM Tool Definitions (Vercel AI SDK)

- Tool `description` is for *what the tool does* and *when to use it*. Keep it concise.
- Parameter-level guidance belongs on `.describe()` in the Zod `inputSchema`, not in the tool description or system prompt.
- For enums, put per-value guidance in `.describe()` on the enum field — the `ai` SDK converts Zod `.describe()` to JSON Schema `description` at every level.
- Do NOT duplicate tool descriptions or parameter guidance in the system prompt. The LLM already receives tool definitions via the `tools` API parameter.
- System prompt should only contain information the LLM cannot get from tool definitions: dynamic context, rendering format instructions, and cross-cutting architectural rules.

## Extraction Schema (Structured Output)

- Azure/OpenRouter structured output requires every property in `properties` to be listed in `required`. Zod `.optional()` fields are excluded from `required` in the generated JSON schema, causing provider rejection.
- Do NOT use `.optional()` in `extractionResultSchema` or its nested entity schemas (`app/src/server/extraction/schema.ts`).
- To represent absence, add a `"none"` sentinel to the enum and strip it to `undefined` via `.transform()` after parsing. The transform is applied during Zod validation but does not affect the JSON schema sent to the provider.
- Existing pattern: `assignee_name` and `resolvedFromMessageId` use union variants (each variant has the field as required) instead of optional fields.

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

## Fire-and-Forget & Inflight Tracking

- Do NOT use `void` for fire-and-forget DB operations in route handlers. Background work that uses the SurrealDB connection will fail with `ConnectionUnavailableError` when smoke tests close the DB in `afterAll`.
- Route-level async work (e.g. `processGitCommits`, `processChatMessage`) must be tracked via `deps.inflight.track(promise)`. The `InflightTracker` (`runtime/types.ts`) lets smoke tests `drain()` pending work before closing connections.
- Nested async work inside tracked parents (e.g. `seedDescriptionEntry`, `fireDescriptionUpdates`, `persistEmbeddings`) should use `await ... .catch(() => undefined)` instead of `void`. Since the parent is already background work, awaiting doesn't affect user-facing latency.
- When adding new background DB operations in route handlers, always use `deps.inflight.track()` or `await` within an already-tracked parent.

## SurrealDB EVENT Webhook Timing

- SurrealDB `DEFINE EVENT` HTTP webhooks can fire before the triggering write is visible to other requests.
- Prefer `DEFINE EVENT ... ASYNC` for webhook-style side effects so callback execution runs after the triggering write commits.
- Use `RETRY <n>` on webhook events to reduce transient callback/network flakiness.
- For intent authorization (`draft -> pending_auth`), avoid synchronous webhook flows that immediately re-read/update the same intent unless the event is `ASYNC`.
- If a webhook path must do DB follow-up without `ASYNC`, wait briefly for the triggering transition to commit before applying routing/state transitions.
- If async follow-up work is needed in route handlers, track it with `deps.inflight.track(...)`.

## Failure Handling

- Do NOT add fallback logic that masks invalid state, malformed payloads, or contract violations.
- Fail fast: throw immediately when required data is missing or does not match the expected shape.
- Prefer explicit hard failures over silent degradation, synthetic defaults, or "best effort" recovery.
- Only introduce fallback behavior when explicitly requested, and document the reason in code comments.
- Never silently ignore errors (e.g. empty `.catch(() => {})`). Always surface them via logging or re-throw.

## Graph Node Types

- Read @README.md § "Key Concepts" for graph node types and § "Architecture" for the layered architecture diagram.

## Schema Awareness

- Always read `schema/surreal-schema.surql` before writing queries, seed data, or any code that creates/updates SurrealDB records. The schema defines required fields, types, and relations — guessing leads to silent `SCHEMAFULL` rejections.

## DPoP Acceptance Test Infrastructure

- All MCP endpoints require DPoP (Demonstration of Proof-of-Possession) authentication. Use `createTestUserWithMcp()` from `acceptance-test-kit.ts` — it generates a key pair, creates identity + workspace + intent records, acquires a DPoP-bound token, and returns `mcpFetch` for authenticated requests.
- **Workspace binding**: The DPoP token contains a `urn:brain:workspace` claim. The middleware (`dpop-middleware.ts:311`) extracts the workspace from the JWT claim, NOT the URL path parameter. All MCP endpoint authorization is scoped to this claim.
- **`member_of` edge required**: The DPoP middleware calls `lookupWorkspace()` which queries `SELECT in FROM member_of WHERE out = $ws LIMIT 1`. Without a `member_of` relation edge between identity and workspace, all MCP requests return 401 "Workspace not found". `createTestUserWithMcp()` creates this edge automatically.
- **Workspace mismatch pitfall**: If a test creates a workspace via the API (`POST /api/workspaces`) and then acquires a DPoP token via `createTestUserWithMcp()`, the token is bound to a *different* workspace. MCP endpoints will return 404 for resources in the API-created workspace. Fix: pass `{ workspaceId }` to `createTestUserWithMcp()` to bind the token to the pre-existing workspace, or use `user.workspaceId` for all resource creation.
- **Pattern**: Create test user first (`createTestUserWithMcp`), then create tasks/projects in `user.workspaceId`. Do NOT create a separate workspace via API unless you pass its ID to `createTestUserWithMcp`.
- **`mcpFetch` vs `mcpHeaders`**: Always use `user.mcpFetch(path, { body })` — it creates a fresh DPoP proof per request. The `mcpHeaders` property is deprecated and will fail because DPoP proofs are single-use.

## Test Uniqueness

- Use `crypto.randomUUID()` for test identifiers (emails, IDs, suffixes) — never `Date.now()` alone. Concurrent test runs share the same millisecond, causing collisions.

## Testing Setup

- Install deps: `bun install`
- Run deterministic unit tests (no LLM/API calls): `bun test tests/unit/`
- Run acceptance tests: `bun test tests/acceptance/`
- Run eval suite: `bun run eval`
- Run eval watch mode: `bun run eval:watch`
- Agents must not run evals directly. Delegate eval execution to the user and ask them to run eval commands and share results.

### Deliver Phase Testing Gate

- After every `nw:deliver` step execution, run the acceptance tests affected by or introduced for the feature (`bun test tests/acceptance/<relevant-suite>`) before proceeding to the next step.
- If acceptance tests fail, fix the issue before moving on. Do NOT skip or defer failing tests.
- This applies to each individual step in the roadmap, not just the final step.

### Acceptance Test Isolation

- Acceptance tests boot an in-process Brain server with an isolated Surreal namespace/database, apply `schema/surreal-schema.surql`, run assertions, then remove the test DB/namespace.
- Acceptance tests require a reachable SurrealDB server at `SURREAL_URL` with credentials from env.
- All test suites share `tests/acceptance/acceptance-test-kit.ts` for server boot and DB isolation; domain-specific kits (orchestrator, intent, coding-session) extend it with business-language helpers.

### Eval Requirements

- Evals call the real extraction model through existing app wiring.
- Required env: `OPENROUTER_API_KEY` and `EXTRACTION_MODEL` (set to Haiku model when needed).
- Optional env:
  - `AUTOEVAL_MODEL` for `autoevals` factuality scorer model override.
  - `EVAL_RESULTS_DIR` for evalite sqlite output.
  - `EVAL_CACHE_DIR` for extraction eval cache.

### Evalite Silent Failure Mode

- Evalite (v0.19+) silently swallows errors thrown in `beforeAll` hooks. When `beforeAll` fails, all evals show `Score: -`, `Duration: 0ms`, and no error output.
- If evals show this pattern, the cause is almost always a thrown error during setup — typically a missing env var in `setupEvalRuntime` (which calls `requireEnv` for all model IDs).
- To diagnose: check that all required env vars are set, or temporarily wrap `beforeAll` contents in try/catch with `console.error` to surface the real error.

## Server Architecture Overview

- Entrypoint is `app/server.ts`; it only calls `startServer()` from `app/src/server/runtime/start-server.ts`.
- Runtime bootstrap is split into:
  - `runtime/config.ts` (env parsing/validation)
  - `runtime/dependencies.ts` (Surreal + model clients)
  - `runtime/start-server.ts` (route registration + Bun server startup)
- HTTP cross-cutting concerns live in `app/src/server/http`:
  - `request-logging.ts` (request context + top-level error boundary)
  - `response.ts` (JSON/headers helpers)
  - `parsing.ts` (request/form-data parsing)
  - `errors.ts` + `observability.ts` (error/log primitives)
- SSE state management is isolated in `app/src/server/streaming/sse-registry.ts`.
- Route/business domains are separated by workflow:
  - `workspace/*` for workspace create/bootstrap/scope checks
  - `chat/*` for ingress, chat agent, async message processing
  - `entities/*` for entity search, detail, actions, and work item accept endpoints
  - `onboarding/*` for onboarding state and guided replies
  - `extraction/*` for extraction generation, persistence, dedupe/upsert, embeddings, and context loaders
  - `agents/*` for specialized subagent implementations (PM agent)
  - `observation/*` for observation CRUD queries
- `graph/*` contains reusable Surreal graph queries used by chat/tools and higher-level workflows.

### Chat Agent Architecture

The chat system uses a thin orchestrator pattern where a single top-level chat agent dispatches to specialized subagents. The knowledge graph is the communication bus — agents read from and write to the graph independently, never passing data directly between each other.

```
User Message
  │
  ├─→ Extraction Pipeline (always runs, Haiku)
  │     └─→ entities/relationships → SurrealDB graph
  │
  └─→ Chat Agent (Sonnet, thin orchestrator)
        ├─→ Direct tools (search, entity detail, decisions, observations)
        └─→ Subagent dispatch
              └─→ PM Agent (Haiku) → suggestions, observations → graph
```

**Two paths to the graph:**
| Source | Path | Why |
|--------|------|-----|
| User messages | Extraction pipeline (Haiku infers entities from unstructured text) | User input is unstructured |
| Agent output | Direct graph write (agents already have structured form) | Nothing to extract |

**Key files:**
- `chat/handler.ts` — `runChatAgent()`: streams chat agent responses with tool use
- `chat/context.ts` — `buildChatContext()` / `buildSystemPrompt()`: loads graph context, builds chat agent system prompt
- `chat/tools/index.ts` — `createChatAgentTools()`: registers all chat agent tools
- `chat/tools/types.ts` — `ChatToolExecutionContext`: actor-typed context (`chat_agent | mcp | pm_agent`)

### Chat Agent Tools

| Tool | Purpose |
|------|---------|
| `search_entities` | Search workspace entities by text query |
| `get_entity_detail` | Fetch entity with relationships and provenance |
| `get_project_status` | Project task/decision/question aggregation |
| `get_conversation_history` | Load recent conversation messages |
| `create_provisional_decision` | Draft a decision for user review |
| `confirm_decision` | Finalize a decision (requires explicit user auth) |
| `resolve_decision` | Mark a decision as resolved |
| `check_constraints` | Validate decision constraints |
| `create_observation` | Create observation for risks/conflicts/signals |
| `acknowledge_observation` | Mark observation as reviewed |
| `resolve_observation` | Close a resolved observation |
| `invoke_pm_agent` | Delegate to PM subagent |

### Shared Tool Layer

Tools live in `chat/tools/` as composable building blocks. Any agent (chat agent, PM subagent, future subagents) can compose the tools it needs. Key shared tools for work item management:

| Tool | File | Purpose |
|------|------|---------|
| `suggest_work_items` | `chat/tools/suggest-work-items.ts` | Batch triage/dedup (>0.97 exact duplicate, ≥0.8 merge, <0.8 new) |
| `create_work_item` | `chat/tools/create-work-item.ts` | Direct entity creation in graph |

### Product Manager Subagent

The PM agent (`agents/pm/`) is the single authority on tasks, features, and project status. It uses the AI SDK's `ToolLoopAgent` class and composes shared tools from `chat/tools/`. It is invoked by the chat agent via `invoke_pm_agent` tool with an intent:

| Intent | When to use |
|--------|-------------|
| `plan_work` | User discusses goals, features, or work to be done |
| `check_status` | User asks about project status, progress, or blockers |
| `organize` | User wants to restructure or re-prioritize |
| `track_dependencies` | User asks about blocked items or dependency chains |

**Key files:**
- `agents/pm/agent.ts` — `runPmAgent()`: creates `ToolLoopAgent` with PM tools, returns structured JSON output
- `agents/pm/prompt.ts` — `buildPmSystemPrompt()`: loads workspace projects and observations
- `agents/pm/tools.ts` — `createPmTools()`: composes shared tools (search_entities, get_project_status, create_observation, suggest_work_items, create_work_item)

**PM output schema:** `{ summary, suggestions: WorkItemSuggestion[], updated, discarded, observations_created }`

The chat agent renders PM suggestions as `WorkItemSuggestionList` component blocks in the chat UI.

### Observation Entity

Observations (`observation/*`) are lightweight cross-cutting signals that agents write to the graph. They enable async agent-to-agent communication without forcing signals into wrong entity types.

- **Severity levels:** `conflict` (contradictions needing human resolution), `warning` (risks), `info` (awareness)
- **Lifecycle:** `open` → `acknowledged` → `resolved`
- **Schema:** `observation` table with text, severity, status, category, source_agent, workspace, embedding
- **Relation:** `observes` edge links observations to project/feature/task/decision/question
- Agents load open observations as part of their context and factor them into their work.

### Work Item Accept Flow

When the PM agent suggests work items, the chat agent renders them as `WorkItemSuggestionList` components. Users can accept or dismiss each item:

- Accept calls `POST /api/workspaces/:workspaceId/work-items/accept`
- The endpoint creates a `task` or `feature` record in SurrealDB with embedding and optional project linking
- Implemented in `entities/work-item-accept-route.ts`

### Primary Chat Flow (`POST /api/chat/messages`)

- `chat/chat-ingress.ts` validates/persists user input and registers an SSE stream message id.
- `chat/chat-processor.ts` orchestrates async processing:
  - load conversation + graph context
  - run extraction (message and optional attachment chunks)
  - persist entities/relationships/provenance
  - transition onboarding state
  - generate assistant response (onboarding reply or chat agent with subagent dispatch)
  - emit SSE events (`token`, `extraction`, `onboarding_seed`, `onboarding_state`, `observation`, `assistant_message`, `done|error`)

### RecordId and Table Access Rules

- After request parsing, use `RecordId` objects everywhere for Surreal identifiers (never raw `table:id` strings in internal logic).
- Server extraction types define typed record aliases:
  - `GraphEntityRecord` and `SourceRecord` are `RecordId<UnionOfTables, string>` aliases.
- Use `record.table.name` for table branching (the SDK's public API; `.tb` is an undeclared internal field that may break on upgrade).

### RecordId Wire Format Contract (Strict)

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
### Known limitations (SurrealDB v3.0)

- `search::score()` and `@N@` do NOT work inside `DEFINE FUNCTION` — the predicate reference is lost across the function boundary. Search queries must run from the app layer. See: https://github.com/surrealdb/surrealdb/issues/7013
- `@N@` does NOT work with SDK bound parameters (`$query`). The search term must be embedded as a string literal in the query. Escape single quotes before interpolation.
- `BM25` without explicit parameters returns score=0. Always use `BM25(1.2, 0.75)`.

### Entity search implementation

Search queries run from the app layer (`entity-search-route.ts`) instead of SurrealDB stored functions due to the limitations above. Fulltext indexes are defined in `schema/migrations/0002_fulltext_search_indexes.surql`.

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

## Schema Migrations

- **CLI Reference:** https://surrealdb.com/docs/surrealdb/cli
- **Validate migration files (`surreal validate`):** https://surrealdb.com/docs/surrealdb/cli/validate
- **Apply migrations (`surreal import`):** https://surrealdb.com/docs/surrealdb/cli/import
- **Export backup snapshots (`surreal export`):** https://surrealdb.com/docs/surrealdb/cli/export
- **ALTER statement:** https://surrealdb.com/docs/surrealql/statements/alter
- **REMOVE statement:** https://surrealdb.com/docs/surrealql/statements/remove
- **BEGIN / COMMIT transaction:** https://surrealdb.com/docs/surrealql/statements/begin
- **INFO statement (post-migration verification):** https://surrealdb.com/docs/surrealql/statements/info

## Data Migrations

- **Export backups (`surreal export`):** https://surrealdb.com/docs/surrealdb/cli/export
- **Apply migration scripts (`surreal import`):** https://surrealdb.com/docs/surrealdb/cli/import
- **UPDATE statement (bulk row transforms):** https://surrealdb.com/docs/surrealql/statements/update
- **FOR statement (iterative transforms):** https://surrealdb.com/docs/surrealql/statements/for
- **RELATE statement (edge rewrites):** https://surrealdb.com/docs/surrealql/statements/relate
- **REMOVE statement (drop old fields):** https://surrealdb.com/docs/surrealql/statements/remove
- **BEGIN / COMMIT transaction:** https://surrealdb.com/docs/surrealql/statements/begin

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
