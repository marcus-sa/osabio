# ADR-050: Conversation Hash Correlation via UUIDv5

## Status

Superseded by ADR-052

## Context

The LLM proxy needs to correlate traces into conversations for Observer analysis and cost attribution. LLM API requests (Anthropic Messages API, OpenAI Chat Completions) contain the full conversation history -- each request is a superset of the previous. The system prompt + first user message is stable across all requests in a conversation.

Session IDs (from CLI/orchestrator) are not always available -- unknown clients have no session. The proxy needs a session-independent correlation mechanism that works for all clients.

The `conversation` table already exists in the schema. The codebase uses UUIDs everywhere -- web UI conversations use UUIDv4.

## Decision

The proxy derives a deterministic conversation ID using `UUIDv5(OSABIO_PROXY_NAMESPACE, system_prompt + "\x00" + first_user_message)` from LLM request content. This UUID is used directly as the conversation record ID (`conversation:<uuidv5>`). Same conversation content always produces the same ID -- no lookup needed.

The null byte separator (`\x00`) prevents collisions between different system_prompt/first_user_message combinations that would otherwise concatenate to the same string.

UUIDv5 (deterministic, namespace-based) will not collide with UUIDv4 (random) used by the web UI, so proxy-created and UI-created conversations coexist safely in the same table.

The proxy uses only existing `conversation` table fields (`workspace`, `title`, `source`, `createdAt`, `updatedAt`) -- no schema changes required. The `source` field is set to `"proxy"` to distinguish from UI-created conversations.

## Alternatives Considered

### Alternative 1: SHA-256 Hex as Conversation Record ID

Use `SHA-256(system_prompt + "\x00" + first_user_message)` truncated or full as the conversation record ID.

**Rejected because**: Inconsistent with codebase conventions. All existing IDs are UUIDs (UUIDv4 for entities, RecordId-wrapped). A hex string ID would be a different format from every other conversation record. Logging, filtering, and tooling expect UUID-shaped identifiers.

### Alternative 2: Random UUID + Content Hash Lookup Field

Generate a random UUIDv4 for each conversation and store a `content_hash` field for deduplication. On each request, hash the content and query `SELECT id FROM conversation WHERE content_hash = $hash AND workspace = $ws`.

**Rejected because**: Requires a DB lookup on every proxied request to check for existing conversations. Adds a `content_hash` field to the schema. The deterministic UUIDv5 approach eliminates both the lookup and the extra field -- the ID itself encodes the content identity.

### Alternative 3: No Conversation Correlation

Unknown clients get no trace grouping. Traces are linked to workspace only.

**Rejected because**: Observer cannot analyze traces as a conversation unit. Cost attribution is per-trace only, not per-conversation. Session-end analysis (ADR-048) loses context for unknown clients.

## Consequences

### Positive

- All clients get conversation grouping for free -- no integration required, no session needed
- Zero DB lookup for correlation -- the deterministic ID is computed from request content
- Consistent UUID format across all conversation records (proxy UUIDv5, UI UUIDv4)
- No schema changes -- uses existing `conversation` table fields
- Idempotent creation -- `CREATE conversation:<uuidv5> SET ...` is a no-op if the record already exists (SurrealDB CREATE returns error on existing ID; the upserter catches the error and returns the existing record)

### Negative

- UUIDv5 computation on every request (negligible: ~0.01ms for hash + UUID formatting)
- Conversation cannot span system prompt changes -- a new system prompt produces a new conversation ID
- First user message must be extractable from the request -- if the request has only system messages or is missing a system prompt, no conversation hash is computed; trace is created without conversation field populated
- Conversation upsert failure does not block request forwarding -- a warning observation is logged and the trace proceeds without conversation link

## References

- ADR-047: Per-Trace Contradiction + Missing Decision Detection via Observer Extension
- ADR-048: Observer Session-End Trace Analysis
- ADR-049: Proxy Session ID Resolution -- Read-Only, No Lifecycle Management
- Data models: `docs/feature/llm-proxy/design/data-models.md` Section 2
- RFC 4122 Section 4.3: UUIDv5 (SHA-1 namespace-based)
