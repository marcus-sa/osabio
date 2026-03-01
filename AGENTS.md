## Data Value Contract

- Never persist, publish, or return `null` for domain data values (Surreal records, API payloads, events, UI state).
- Absence must be represented by omitted optional fields only (`field?: Type`), not by `null`.
- If `null` appears in domain data, treat it as a contract violation and fix the producer. Do NOT sanitize/coerce it at consumers.

## TypeScript Conventions

- Do NOT use `null`. Use `undefined` via optional properties (`field?: Type`) instead.
- Do NOT create wrapper/helper functions for simple operations. Cast directly with `as`.
- Type result payloads once and avoid repetitive per-field casting.



## Extraction Schema (Structured Output)

- Azure/OpenRouter structured output requires every property in `properties` to be listed in `required`. Zod `.optional()` fields are excluded from `required` in the generated JSON schema, causing provider rejection.
- Do NOT use `.optional()` in `extractionResultSchema` or its nested entity schemas (`app/src/server/extraction/schema.ts`).
- To represent absence, add a `"none"` sentinel to the enum and strip it to `undefined` via `.transform()` after parsing. The transform is applied during Zod validation but does not affect the JSON schema sent to the provider.
- Existing pattern: `assignee_name` and `resolvedFromMessageId` use union variants (each variant has the field as required) instead of optional fields.

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
- Agents must not run evals directly. Delegate eval execution to the user and ask them to run eval commands and share results.

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
  - `chat/*` for ingress, orchestrator, async message processing
  - `entities/*` for entity search, detail, actions, and work item accept endpoints
  - `onboarding/*` for onboarding state and guided replies
  - `extraction/*` for extraction generation, persistence, dedupe/upsert, embeddings, and context loaders
  - `agents/*` for specialized subagent implementations (PM agent)
  - `observation/*` for observation CRUD queries
- `graph/*` contains reusable Surreal graph queries used by chat/tools and higher-level workflows.

### Orchestrator Agent Architecture

The chat system uses a thin orchestrator pattern where a single top-level agent dispatches to specialized subagents. The knowledge graph is the communication bus — agents read from and write to the graph independently, never passing data directly between each other.

```
User Message
  │
  ├─→ Extraction Pipeline (always runs, Haiku)
  │     └─→ entities/relationships → SurrealDB graph
  │
  └─→ Orchestrator (Sonnet, thin)
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
- `chat/handler.ts` — `runOrchestrator()`: streams orchestrator responses with tool use
- `chat/context.ts` — `buildChatContext()` / `buildSystemPrompt()`: loads graph context, builds orchestrator system prompt
- `chat/tools/index.ts` — `createOrchestratorTools()`: registers all 12 orchestrator tools
- `chat/tools/types.ts` — `ChatToolExecutionContext`: actor-typed context (`chat_agent | mcp | orchestrator | pm_agent`)

### Orchestrator Tools

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

### Product Manager Subagent

The PM agent (`agents/pm/`) is the single authority on tasks, features, and project status. It is invoked by the orchestrator via `invoke_pm_agent` tool with an intent:

| Intent | When to use |
|--------|-------------|
| `plan_work` | User discusses goals, features, or work to be done |
| `check_status` | User asks about project status, progress, or blockers |
| `organize` | User wants to restructure or re-prioritize |
| `track_dependencies` | User asks about blocked items or dependency chains |

**Key files:**
- `agents/pm/agent.ts` — `runPmAgent()`: generates text with PM tools, parses strict JSON output
- `agents/pm/prompt.ts` — `buildPmSystemPrompt()`: loads workspace projects and observations
- `agents/pm/tools.ts` — `createPmTools()`: search_entities, get_project_status, create_observation, suggest_work_items
- `agents/pm/suggest-work-items.ts` — Embedding-based semantic dedup (>0.97 exact duplicate, ≥0.8 merge, <0.8 new)

**PM output schema:** `{ summary, suggestions: WorkItemSuggestion[], updated, discarded, observations_created }`

The orchestrator renders PM suggestions as `WorkItemSuggestionList` component blocks in the chat UI.

### Observation Entity

Observations (`observation/*`) are lightweight cross-cutting signals that agents write to the graph. They enable async agent-to-agent communication without forcing signals into wrong entity types.

- **Severity levels:** `conflict` (contradictions needing human resolution), `warning` (risks), `info` (awareness)
- **Lifecycle:** `open` → `acknowledged` → `resolved`
- **Schema:** `observation` table with text, severity, status, category, source_agent, workspace, embedding
- **Relation:** `observes` edge links observations to project/feature/task/decision/question
- Agents load open observations as part of their context and factor them into their work.

### Work Item Accept Flow

When the PM agent suggests work items, the orchestrator renders them as `WorkItemSuggestionList` components. Users can accept or dismiss each item:

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
  - generate assistant response (onboarding reply or orchestrator with subagent dispatch)
  - emit SSE events (`token`, `extraction`, `onboarding_seed`, `onboarding_state`, `observation`, `assistant_message`, `done|error`)

### RecordId and Table Access Rules

- Use `RecordId` objects everywhere for Surreal identifiers (never `table:id` strings).
- Server extraction types define typed record aliases:
  - `GraphEntityRecord` and `SourceRecord` include a typed `tb` field for table discrimination.
- Prefer typed `record.tb` access for table branching; do not use untyped casts like `(record as unknown as { tb: string }).tb`.

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
