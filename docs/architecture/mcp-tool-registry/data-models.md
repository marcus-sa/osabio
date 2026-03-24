# Data Models -- MCP Tool Registry (#178)

## SurrealDB Schema

### New Tables

```sql
-- Tool definition (graph node)
DEFINE TABLE mcp_tool SCHEMAFULL;
DEFINE FIELD name ON mcp_tool TYPE string;
DEFINE FIELD toolkit ON mcp_tool TYPE string;
DEFINE FIELD description ON mcp_tool TYPE string;
DEFINE FIELD input_schema ON mcp_tool TYPE object FLEXIBLE;
DEFINE FIELD output_schema ON mcp_tool TYPE option<object> FLEXIBLE;
DEFINE FIELD provider ON mcp_tool TYPE option<record<credential_provider>>;
DEFINE FIELD risk_level ON mcp_tool TYPE string
  ASSERT $value IN ["low", "medium", "high", "critical"];
DEFINE FIELD workspace ON mcp_tool TYPE record<workspace>;
DEFINE FIELD status ON mcp_tool TYPE string
  ASSERT $value IN ["active", "disabled"];
DEFINE FIELD created_at ON mcp_tool TYPE datetime DEFAULT time::now();

-- Indexes
DEFINE INDEX mcp_tool_workspace ON mcp_tool FIELDS workspace;
DEFINE INDEX mcp_tool_workspace_name ON mcp_tool FIELDS workspace, name;
DEFINE INDEX mcp_tool_workspace_toolkit ON mcp_tool FIELDS workspace, toolkit;
DEFINE INDEX mcp_tool_workspace_status ON mcp_tool FIELDS workspace, status;

-- Tool authorization (relation edge: identity -> mcp_tool)
DEFINE TABLE can_use TYPE RELATION IN identity OUT mcp_tool SCHEMAFULL;
DEFINE FIELD granted_at ON can_use TYPE datetime DEFAULT time::now();
DEFINE FIELD max_calls_per_hour ON can_use TYPE option<int>;

DEFINE INDEX can_use_identity ON can_use FIELDS in;
DEFINE INDEX can_use_tool ON can_use FIELDS out;

-- Tool governance (relation edge: policy -> mcp_tool)
DEFINE TABLE governs_tool TYPE RELATION IN policy OUT mcp_tool SCHEMAFULL;
DEFINE FIELD conditions ON governs_tool TYPE option<string>;
DEFINE FIELD max_per_call ON governs_tool TYPE option<float>;
DEFINE FIELD max_per_day ON governs_tool TYPE option<float>;

DEFINE INDEX governs_tool_tool ON governs_tool FIELDS out;

-- Credential provider (graph node)
DEFINE TABLE credential_provider SCHEMAFULL;
DEFINE FIELD name ON credential_provider TYPE string;
DEFINE FIELD display_name ON credential_provider TYPE string;
DEFINE FIELD auth_method ON credential_provider TYPE string
  ASSERT $value IN ["oauth2", "api_key", "bearer", "basic"];
DEFINE FIELD authorization_url ON credential_provider TYPE option<string>;
DEFINE FIELD token_url ON credential_provider TYPE option<string>;
DEFINE FIELD client_id ON credential_provider TYPE option<string>;
DEFINE FIELD client_secret_encrypted ON credential_provider TYPE option<string>;
DEFINE FIELD scopes ON credential_provider TYPE option<array<string>>;
-- API key injection config (required when auth_method = "api_key")
DEFINE FIELD api_key_header ON credential_provider TYPE option<string>;  -- e.g. "X-API-Key", "Authorization", "Api-Key"
DEFINE FIELD workspace ON credential_provider TYPE record<workspace>;
DEFINE FIELD created_at ON credential_provider TYPE datetime DEFAULT time::now();

DEFINE INDEX credential_provider_workspace ON credential_provider FIELDS workspace;
DEFINE INDEX credential_provider_workspace_name ON credential_provider FIELDS workspace, name;

-- Connected account (graph node)
DEFINE TABLE connected_account SCHEMAFULL;
DEFINE FIELD identity ON connected_account TYPE record<identity>;
DEFINE FIELD provider ON connected_account TYPE record<credential_provider>;
DEFINE FIELD access_token_encrypted ON connected_account TYPE option<string>;
DEFINE FIELD refresh_token_encrypted ON connected_account TYPE option<string>;
DEFINE FIELD token_expires_at ON connected_account TYPE option<datetime>;
DEFINE FIELD api_key_encrypted ON connected_account TYPE option<string>;
DEFINE FIELD basic_username ON connected_account TYPE option<string>;
DEFINE FIELD basic_password_encrypted ON connected_account TYPE option<string>;
DEFINE FIELD scopes ON connected_account TYPE option<array<string>>;
DEFINE FIELD status ON connected_account TYPE string
  ASSERT $value IN ["active", "expired", "revoked"];
DEFINE FIELD connected_at ON connected_account TYPE datetime DEFAULT time::now();
DEFINE FIELD workspace ON connected_account TYPE record<workspace>;

DEFINE INDEX connected_account_identity_provider ON connected_account FIELDS identity, provider;
DEFINE INDEX connected_account_workspace ON connected_account FIELDS workspace;
DEFINE INDEX connected_account_identity ON connected_account FIELDS identity;
```

### Schema Design Decisions

**Encrypted field naming**: Fields storing encrypted values use `_encrypted` suffix (e.g., `client_secret_encrypted` instead of `client_secret`). This makes it unambiguous that the stored value is ciphertext and prevents accidental plaintext reads.

**No `client_secret` plaintext field**: The issue schema had `client_secret` as a plain string. This design stores ONLY the encrypted form. The original issue schema from #178 is treated as a logical model; the physical schema enforces encryption.

**`option<string>` for encrypted fields**: Encrypted fields are `option<string>` because not all auth methods use all fields. An `api_key` provider has no `access_token_encrypted`. Omitted fields follow the project convention (no `null`, use omission).

**Composite index on `connected_account(identity, provider)`**: This is the primary lookup path during credential resolution. The proxy needs to find "the connected_account for this identity and this provider" in a single indexed query. Per NFR-4, this must be efficient.

**No UNIQUE index on `connected_account(identity, provider)`**: Per SurrealDB v3.0.4 bug (CLAUDE.md), UNIQUE indexes on optional record fields silently return empty results. Application-level uniqueness enforcement used instead (check-then-create in a transaction).

## Query Patterns

### Tool Resolution (Hot Path -- every proxy request)

```sql
-- Single query: resolve effective toolset for identity
-- Returns active tools the identity can use in this workspace
SELECT
  out.id AS tool_id,
  out.name AS name,
  out.toolkit AS toolkit,
  out.description AS description,
  out.input_schema AS input_schema,
  out.provider AS provider,
  out.risk_level AS risk_level,
  max_calls_per_hour
FROM can_use
WHERE in = $identity
  AND out.status = 'active'
  AND out.workspace = $workspace;
```

**Performance**: Uses `can_use_identity` index for the `in` filter. The `out.*` field access follows the relation to `mcp_tool` inline (SurrealDB resolves relation targets automatically). Expected < 5ms for workspaces with < 100 tools.

**Future skill-derived resolution** (#177):
```sql
-- When skill tables exist, UNION with:
SELECT out.id AS tool_id, out.name, ... FROM skill_requires
WHERE in IN (SELECT out FROM possesses WHERE in = $identity)
  AND out.status = 'active'
  AND out.workspace = $workspace;
```

### Credential Resolution (Per tool call)

```sql
-- Resolve connected_account for identity + provider
SELECT *
FROM connected_account
WHERE identity = $identity
  AND provider = $provider
  AND status = 'active'
LIMIT 1;
```

**Performance**: Uses `connected_account_identity_provider` composite index. Expected < 2ms.

### Rate Limit Check (Per tool call)

```sql
-- Count tool calls in the last hour for rate limiting
SELECT count() AS call_count
FROM trace
WHERE type = 'tool_call'
  AND tool_name = $tool_name
  AND actor = $identity
  AND created_at > time::now() - 1h;
```

**Performance**: Uses `trace_workspace` index + filter. For high-volume tools, consider in-memory sliding window (same pattern as `rate-limiter.ts` in proxy).

### Tool Governance Check (Per tool call)

```sql
-- Check if any policy governs this tool
SELECT in AS policy_id, conditions, max_per_call, max_per_day
FROM governs_tool
WHERE out = $tool;
```

**Performance**: Uses `governs_tool_tool` index. Expected < 2ms.

### Provider Listing (Admin UI)

```sql
SELECT * FROM credential_provider WHERE workspace = $workspace ORDER BY created_at DESC;
```

### Tool Listing (Admin UI)

```sql
SELECT *, (SELECT count() FROM can_use WHERE out = $parent.id) AS grant_count
FROM mcp_tool
WHERE workspace = $workspace AND status = $status
ORDER BY toolkit, name;
```

## Encryption Strategy

### Algorithm
- **AES-256-GCM** (authenticated encryption with associated data)
- 256-bit key from `ServerConfig.toolEncryptionKey`
- Random 12-byte IV per encryption operation
- 16-byte authentication tag

### Key Management
- Key stored as environment variable, parsed into `ServerConfig` at startup
- Key format: 32-byte hex string (64 characters) or base64-encoded 32 bytes
- No key rotation in walking skeleton; key rotation is a future enhancement
- Key absence: tool registry features that require encryption are disabled (fail-fast on provider registration)

### Storage Format
- Ciphertext stored as base64 string: `base64(IV || ciphertext || authTag)`
- IV: first 12 bytes; auth tag: last 16 bytes; ciphertext: middle bytes
- Parsing: split on known offsets after base64 decode

### Encrypted Fields

| Table | Field | Contains |
|---|---|---|
| `credential_provider` | `client_secret_encrypted` | OAuth2 client secret |
| `connected_account` | `access_token_encrypted` | OAuth2 access token |
| `connected_account` | `refresh_token_encrypted` | OAuth2 refresh token |
| `connected_account` | `api_key_encrypted` | API key |
| `connected_account` | `basic_password_encrypted` | Basic auth password |

### Fields NOT Encrypted
- `credential_provider.client_id` -- not a secret (public in OAuth2 spec)
- `credential_provider.authorization_url`, `token_url` -- public URLs
- `connected_account.basic_username` -- not sensitive (username portion of basic auth)
- `connected_account.scopes` -- not sensitive (list of permission names)
- `connected_account.token_expires_at` -- metadata, not a credential

## Trace Schema Extension

The existing `trace` table already supports `type: "tool_call"` and has `tool_name`, `input`, `output`, `duration_ms`, `actor`, `workspace` fields. No schema change required for basic tool tracing.

**Additional fields for tool call traces** (stored in FLEXIBLE `input`/`output` fields):
- `input.tool_arguments`: the tool_call arguments (sanitized)
- `input.tool_kind`: `"brain_native" | "integration"`
- `input.credential_provider_id`: provider reference (integration calls only)
- `output.tool_result`: the execution result (sanitized, no credentials)
- `output.outcome`: `"success" | "error" | "denied" | "rate_limited"`

No migration needed -- `input` and `output` are already `option<object> FLEXIBLE`.

## Migration Plan

**Migration 0065**: Creates `mcp_tool`, `can_use`, `governs_tool`, `credential_provider`, `connected_account` tables with all indexes.

**Phased migration** following walking skeleton order:
1. Phase 1 (US-3): `mcp_tool` + `can_use` tables only
2. Phase 5 (US-1): `credential_provider` table
3. Phase 6 (US-4): `connected_account` table
4. Phase 9 (US-8): `governs_tool` table

Single migration file is preferred (tables with no data don't need incremental creation), but the walking skeleton can ship with a subset and add tables in later migrations if needed.

## Data Flow Diagram

```
[Admin registers provider]
  |
  v
credential_provider (encrypted client_secret)
  |
  v
[Admin creates mcp_tool with provider reference]
  |
  v
mcp_tool (workspace-scoped, toolkit-namespaced)
  |
  v
[Admin grants access]
  |
  v
can_use (identity -> mcp_tool edge)
  |
  v
[User connects account]
  |
  v
connected_account (identity -> credential_provider, encrypted tokens)
  |
  v
[Proxy request arrives]
  |
  v
Tool Resolution: identity -> can_use -> mcp_tool (cached 60s)
  |
  v
Tool Injection: mcp_tool -> Anthropic tool format -> append to tools[]
  |
  v
[LLM responds with tool_use]
  |
  v
Tool Routing: tool_name -> mcp_tool lookup -> classify (brain-native | integration | unknown)
  |
  |-- brain-native: execute graph query directly
  |-- integration: credential_provider -> connected_account -> decrypt -> inject auth -> HTTP -> sanitize
  '-- unknown: pass through to runtime
  |
  v
Trace: tool_call record with outcome + provenance
```
