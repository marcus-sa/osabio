# Component Boundaries — mcp-server-auth

## Module Map

All new code lives within the existing `tool-registry` and `proxy` modules. No new top-level modules.

```
app/src/server/
  tool-registry/
    auth-discovery.ts          [NEW]  Pure + effect: OAuth .well-known discovery
    static-headers.ts          [NEW]  Pure + effect: header validation, encrypt/decrypt
    oauth-flow.ts              [MOD]  Extended: PKCE, dynamic registration
    routes.ts                  [MOD]  Extended: new auth endpoints
    server-routes.ts           [MOD]  Extended: auth_mode in CRUD, discover-auth
    queries.ts                 [MOD]  Extended: header CRUD, auth_mode queries
    types.ts                   [MOD]  Extended: new types
    encryption.ts              [REUSE] No changes — existing AES-256-GCM
  proxy/
    credential-resolver.ts     [MOD]  Extended: resolveAuthForMcpServer()
    mcp-client-factory.ts      [MOD]  Calls resolver for auth headers

app/src/client/
  components/tool-registry/
    AddMcpServerDialog.tsx     [MOD]  Auth mode selector + static headers form
    McpServerSection.tsx       [MOD]  Auth status display
    StaticHeadersInput.tsx     [NEW]  Dynamic key-value header list component
    OAuthDiscoveryStatus.tsx   [NEW]  Discovery result + Authorize button
  hooks/
    use-mcp-servers.ts         [MOD]  Extended response type with auth fields
  routes/
    oauth-callback-page.tsx    [NEW]  Minimal callback handler page
```

## Dependency Direction

```
UI Components → Hooks → HTTP API → Route Handlers → Pure Logic + Effect Shell → SurrealDB / External
                                                   ↘ Encryption (shared)
```

- Pure functions have zero dependencies (only TypeScript types)
- Effect shell depends on: `crypto` (Bun native), `fetch`, SurrealDB SDK
- No circular dependencies between modules
- `auth-discovery.ts` and `static-headers.ts` do NOT import from each other

## Interface Contracts

### Between Server Routes and Auth Discovery

```typescript
// auth-discovery.ts exports
export function discoverAuth(serverUrl: string): Promise<DiscoveredAuthConfig | undefined>;
export function parseProtectedResourceMetadata(json: unknown): ProtectedResourceMetadata;
export function parseAuthServerMetadata(json: unknown): AuthServerMetadata;
```

### Between Credential Resolver and MCP Client

```typescript
// credential-resolver.ts exports (new)
export function resolveAuthForMcpServer(
  server: McpServerRecord,
  deps: { decrypt: DecryptFn; refreshToken: RefreshTokenFn; db: SurrealClient }
): Promise<Record<string, string>>;
```

### Between UI and API

```typescript
// AddMcpServerDialog sends:
POST /mcp-servers { name, url, transport, auth_mode, static_headers?, provider_id? }

// Auth discovery:
POST /mcp-servers/:id/discover-auth → DiscoverAuthResponse

// OAuth initiation:
POST /accounts/connect/:providerId → { redirect_url, state }

// OAuth callback:
POST /accounts/oauth2/callback { code, state } → { success: boolean }
```

## Test Boundaries

| Component | Test Type | What to Mock |
|-----------|-----------|-------------|
| `parseProtectedResourceMetadata` | Unit | Nothing (pure) |
| `parseAuthServerMetadata` | Unit | Nothing (pure) |
| `validateHeaders` | Unit | Nothing (pure) |
| `buildHeaderMap` | Unit | Nothing (pure) |
| `generatePkce` | Unit | Nothing (pure, crypto deterministic with seed) |
| `discoverAuth` | Unit | `fetch` (inject) |
| `encryptHeaders` / `decryptHeaders` | Unit | Nothing (uses real crypto) |
| `resolveAuthForMcpServer` | Unit | DB queries, decrypt fn (inject) |
| `server-routes` auth endpoints | Acceptance | Full server + isolated DB |
| `AddMcpServerDialog` | RTL | None (component test) |
| `StaticHeadersInput` | RTL | None (component test) |
| End-to-end static headers | Acceptance | MCP server via InMemoryTransport |
