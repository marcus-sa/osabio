# Architecture Design: Osabio CLI Proxy Setup

## Problem Statement

The LLM proxy currently requires clients to bring their own Anthropic API key (forwarded via `x-api-key`/`authorization` headers). There is no Osabio-level authentication — any client that knows the proxy URL can use it. The CLI (`osabio init`) does not configure Claude Code to route through the proxy.

This feature adds:
1. Server-held Anthropic API key (clients never see it)
2. Osabio proxy token authentication (long-lived, workspace-scoped)
3. CLI Step 7 that configures `.claude/settings.local.json` automatically

## Quality Attributes

| Attribute | Priority | Rationale |
|-----------|----------|-----------|
| **Security** | High | Proxy tokens must be workspace-scoped, revocable, and not leak upstream API keys |
| **Simplicity** | High | Zero manual config — `osabio init` does everything |
| **Reliability** | Medium | Token expiry handled gracefully with clear error messages |
| **Maintainability** | Medium | Minimal new code — reuse existing OAuth flow and config infrastructure |

## C4 System Context Diagram

```mermaid
C4Context
    title System Context: Osabio LLM Proxy

    Person(dev, "Developer", "Uses Claude Code for coding")

    System(osabio, "Osabio Server", "Knowledge graph + LLM proxy")
    System_Ext(anthropic, "Anthropic API", "Claude model inference")
    System_Ext(claude_code, "Claude Code", "AI coding assistant")

    Rel(dev, claude_code, "Runs claude command")
    Rel(claude_code, osabio, "LLM requests via proxy", "HTTPS + Osabio auth headers")
    Rel(brain, anthropic, "Forwards requests", "HTTPS + Osabio's API key")
    Rel(dev, osabio, "osabio init (OAuth)", "HTTPS")
```

## C4 Container Diagram

```mermaid
C4Container
    title Container: Proxy Auth Flow

    Person(dev, "Developer")

    Container_Boundary(cli, "Brain CLI") {
        Component(init, "osabio init", "Step 7: Proxy Setup")
        Component(config, "~/.osabio/config.json", "Stores proxy_token")
    }

    Container_Boundary(server, "Osabio Server") {
        Component(oauth, "OAuth 2.1 Endpoints", "Existing auth flow")
        Component(proxy_token_ep, "POST /api/auth/proxy-token", "Issues long-lived proxy tokens")
        Component(proxy, "LLM Proxy Handler", "/proxy/llm/anthropic/*")
        Component(proxy_auth, "Proxy Auth Middleware", "Validates Osabio proxy tokens")
        ComponentDb(surreal, "SurrealDB", "proxy_token table")
    }

    System_Ext(anthropic, "Anthropic API")

    Container_Boundary(claude, "Claude Code") {
        Component(settings, ".claude/settings.local.json", "env.ANTHROPIC_BASE_URL + ANTHROPIC_CUSTOM_HEADERS")
    }

    Rel(dev, init, "runs osabio init")
    Rel(init, oauth, "OAuth 2.1 PKCE (existing)")
    Rel(init, proxy_token_ep, "POST with access_token")
    Rel(proxy_token_ep, surreal, "CREATE proxy_token")
    Rel(init, settings, "writes env config")
    Rel(init, config, "stores proxy_token")

    Rel(claude, proxy, "LLM requests")
    Rel(proxy, proxy_auth, "validate token")
    Rel(proxy_auth, surreal, "lookup proxy_token")
    Rel(proxy, anthropic, "forward with server API key")
```

## Component Design

### 1. Proxy Token Endpoint

**Path**: `POST /api/auth/proxy-token`

**Auth**: Requires valid OAuth access token (from `osabio init` Step 1)

**Request**:
```json
{
  "workspace_id": "uuid"
}
```

**Response**:
```json
{
  "proxy_token": "osp_<random-64-chars>",
  "expires_at": "2026-06-14T00:00:00Z",
  "workspace_id": "uuid"
}
```

**Behavior**:
- Validates the OAuth access token from `Authorization: Bearer <access_token>`
- Verifies the caller has access to the requested workspace
- Generates a cryptographically random token with `osp_` prefix (Osabio Proxy)
- Stores hashed token in `proxy_token` SurrealDB table with workspace binding
- TTL: 90 days (configurable via `PROXY_TOKEN_TTL_DAYS` env var)
- Re-issuing revokes previous tokens for the same identity+workspace pair

**File**: `app/src/server/proxy/proxy-token-route.ts`

### 2. Proxy Auth Middleware

**Location**: New function in `app/src/server/proxy/proxy-auth.ts`

**Behavior**:
- Extracts `X-Osabio-Auth` header from incoming proxy request
- Looks up hashed token in `proxy_token` table
- Validates: not expired, not revoked
- Returns resolved identity (workspace_id, identity_id) from the token record — workspace is derived from the token, not a separate header
- Uses in-memory cache (5 min TTL) to avoid DB lookup on every request

**Integration point**: Called at the start of the proxy handler, BEFORE the existing pipeline. Replaces the current `x-api-key`/`authorization` validation for Osabio-authenticated requests.

**Dual-mode operation**: The proxy supports two auth modes:
1. **Osabio auth** (new): `X-Osabio-Auth` header present → validate proxy token, derive workspace from token, use server's Anthropic API key
2. **Direct auth** (existing): No `X-Osabio-Auth` → require `x-api-key`/`authorization`, forward to Anthropic as-is

This preserves backward compatibility for users who bring their own API key.

### 3. Server-Side Anthropic API Key

**Config change**: New optional env var `ANTHROPIC_API_KEY` in `ServerConfig`.

- When Osabio auth is used, the proxy injects this key as `x-api-key` in upstream headers
- When direct auth is used (no `X-Osabio-Auth`), existing behavior is preserved
- If `ANTHROPIC_API_KEY` is not set and a Osabio-auth request arrives, return 500 with clear error

**File**: `app/src/server/runtime/config.ts` — add `anthropicApiKey?: string`

### 4. CLI Step 7: Proxy Setup

**Location**: New function `setupProxyConfig()` in `cli/commands/init.ts`

**Flow**:
1. Load repo config from `~/.osabio/config.json` (has `access_token` from Step 1)
2. Call `POST /api/auth/proxy-token` with the access token
3. Store `proxy_token` and `proxy_token_expires_at` in `RepoConfig`
4. Read or create `.claude/settings.local.json`
5. Merge `env` keys:
   - `ANTHROPIC_BASE_URL`: `{server_url}/proxy/llm/anthropic`
   - `ANTHROPIC_CUSTOM_HEADERS`: `X-Osabio-Auth: {proxy_token}`
6. Check if `.claude/settings.local.json` is gitignored; warn if not
7. Print confirmation

**Config shape change** (`cli/config.ts`):
```typescript
export type RepoConfig = {
  // ... existing fields ...
  proxy_token?: string;
  proxy_token_expires_at?: number;
};
```

### 5. SurrealDB Schema

New table for proxy tokens:

```sql
DEFINE TABLE proxy_token SCHEMAFULL;
DEFINE FIELD token_hash ON proxy_token TYPE string;
DEFINE FIELD workspace ON proxy_token TYPE record<workspace>;
DEFINE FIELD identity ON proxy_token TYPE record<identity>;
DEFINE FIELD expires_at ON proxy_token TYPE datetime;
DEFINE FIELD created_at ON proxy_token TYPE datetime DEFAULT time::now();
DEFINE FIELD revoked ON proxy_token TYPE bool DEFAULT false;

DEFINE INDEX idx_proxy_token_hash ON proxy_token FIELDS token_hash UNIQUE;
DEFINE INDEX idx_proxy_token_identity_workspace ON proxy_token FIELDS identity, workspace;
```

### 6. SessionStart Hook Enhancement

**Location**: `cli/commands/system.ts` (existing `load-context` command)

**Addition**: Check `proxy_token_expires_at` from config. If expired or expiring within 7 days, print warning:
```
⚠ Osabio proxy token expires in N days. Run `osabio init` to refresh.
```

## Proxy Handler Changes (anthropic-proxy-route.ts)

### Modified `buildUpstreamHeaders`

```
Before: forward client's x-api-key/authorization
After:  if Osabio auth → inject server's ANTHROPIC_API_KEY
        if direct auth → forward client's headers (unchanged)
```

### Modified handler pipeline

```
Before:
  1. Parse body
  2. Identity resolution
  3. Session resolution
  ...
  6. API key validation (x-api-key or authorization required)
  7. Forward to Anthropic

After:
  1. Parse body
  1.5. Osabio auth check (X-Osabio-Auth header?)
       → if present: validate proxy token, resolve identity from token
       → if absent: fall through to existing flow
  2. Identity resolution (enriched by proxy token if Osabio auth)
  3. Session resolution
  ...
  6. API key validation:
       → Osabio auth: skip (server has key)
       → Direct auth: require x-api-key/authorization (unchanged)
  7. Forward to Anthropic:
       → Osabio auth: inject server's ANTHROPIC_API_KEY
       → Direct auth: forward client headers (unchanged)
```

## Data Flow

```
osabio init
  ├── Step 1: OAuth → access_token (existing)
  ├── Step 7: POST /api/auth/proxy-token (access_token as Bearer)
  │   └── Server: hash token, store in proxy_token table
  │   └── Response: { proxy_token: "osp_...", expires_at }
  ├── Write ~/.osabio/config.json (proxy_token, proxy_token_expires_at)
  └── Write .claude/settings.local.json
        └── env.ANTHROPIC_BASE_URL = {server}/proxy/llm/anthropic
        └── env.ANTHROPIC_CUSTOM_HEADERS = X-Osabio-Auth: {token}

claude (runtime)
  ├── Reads .claude/settings.local.json
  ├── Sets ANTHROPIC_BASE_URL → routes to Osabio proxy
  ├── Sets ANTHROPIC_CUSTOM_HEADERS → X-Osabio-Workspace + X-Osabio-Auth on every request
  └── Osabio proxy:
        ├── Validates X-Osabio-Auth token (DB lookup, cached)
        ├── Derives workspace + identity from token record
        ├── Runs policy evaluation, context injection (existing)
        ├── Injects server's ANTHROPIC_API_KEY
        └── Forwards to Anthropic API
```

## File Changes Summary

| File | Change |
|------|--------|
| `app/src/server/runtime/config.ts` | Add `anthropicApiKey?: string` from `ANTHROPIC_API_KEY` env |
| `app/src/server/proxy/proxy-token-route.ts` | **New** — POST endpoint to issue proxy tokens |
| `app/src/server/proxy/proxy-auth.ts` | **New** — Token validation + caching |
| `app/src/server/proxy/anthropic-proxy-route.ts` | Dual-mode auth: Osabio auth vs direct auth |
| `app/src/server/proxy/identity-resolver.ts` | Add `proxyTokenIdentity` to `IdentityInput` for token-resolved identity |
| `app/src/server/runtime/start-server.ts` | Register proxy-token route |
| `cli/commands/init.ts` | Add Step 7: `setupProxyConfig()` |
| `cli/config.ts` | Add `proxy_token`, `proxy_token_expires_at` to `RepoConfig` |
| `cli/commands/system.ts` | Token expiry warning in SessionStart |
| `schema/migrations/00XX_proxy_token.surql` | **New** — proxy_token table |
| `.env.example` | Add `ANTHROPIC_API_KEY` |

## ADR: Dual-Mode Proxy Auth

**Decision**: Support both Osabio-authenticated and direct-auth proxy requests.

**Context**: The proxy currently forwards client-provided API keys. Adding Osabio auth shouldn't break existing users who bring their own keys.

**Alternatives considered**:
1. **Brain-auth only** — Simpler, but breaking change for existing users
2. **Dual-mode** (chosen) — Backward compatible, `X-Osabio-Auth` presence determines mode
3. **Separate proxy endpoints** — Unnecessary complexity, same handler can branch

**Consequences**: Handler has a branch, but it's a clean split at the auth layer. The rest of the pipeline (identity resolution, policy, context injection, tracing) works identically in both modes.

## ADR: Token Format

**Decision**: Use opaque random tokens with `osp_` prefix, stored as SHA-256 hashes.

**Alternatives considered**:
1. **JWT** — Self-contained but can't be revoked without a blocklist. Overkill for a simple workspace-scoped token.
2. **Opaque + hash** (chosen) — Simple, revocable, prefix makes tokens identifiable in logs/configs.

**Consequences**: Every proxy request with Osabio auth requires a DB lookup (mitigated by 5-min in-memory cache).
