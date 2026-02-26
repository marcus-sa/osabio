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
- Type query results directly. Access `RecordId.id` directly - do NOT create wrapper functions like `extractRecordId()`, `toString()`, etc:
  ```typescript
  const rows = await selectMany("SELECT id, name FROM gladiator WHERE totalWins > 0;") as Array<{ id: RecordId; name: string }>;
  const result = rows.map((row) => ({ gladiatorId: row.id.id as string, name: row.name }));
  ```
- Do NOT use `FETCH` in queries if you need the raw RecordId reference. `FETCH` resolves references to full objects.
- For nested arrays (2D grids), use explicit type: `DEFINE FIELD grid ON match TYPE array<array<string>>;` - plain `array` silently rejects nested arrays in SCHEMAFULL mode.
- Keep all Surreal tables in `schema/surreal-schema.surql` as `SCHEMAFULL`. Do NOT introduce `SCHEMALESS` tables.
- In `SCHEMAFULL`, every persisted nested key must be explicitly declared. For `array<object>` fields, always define `field[*].subField` entries for all written properties.
- Do NOT rely on permissive object inference for production payloads. If code writes a new key, update schema in the same change before deploy.
- After schema changes, verify with `INFO FOR TABLE <table>;` in the target namespace/database to confirm nested fields are present.

