# Data Models — mcp-server-auth

## Schema Changes

### `mcp_server` — New Fields

```sql
-- Auth mode: determines how Brain authenticates with this server
DEFINE FIELD OVERWRITE auth_mode ON mcp_server TYPE string
  DEFAULT "none"
  ASSERT $value IN ["none", "static_headers", "oauth", "provider"];

-- Static headers: array of { name, value_encrypted } pairs
-- Only populated when auth_mode = "static_headers"
DEFINE FIELD OVERWRITE static_headers ON mcp_server TYPE option<array<object>>;
DEFINE FIELD OVERWRITE static_headers[*].name ON mcp_server TYPE string;
DEFINE FIELD OVERWRITE static_headers[*].value_encrypted ON mcp_server TYPE string;

-- OAuth-specific: linked connected_account for workspace-level OAuth tokens
-- Only populated when auth_mode = "oauth"
DEFINE FIELD OVERWRITE oauth_account ON mcp_server TYPE option<record<connected_account>>;
```

### `credential_provider` — New Field

```sql
-- Discovery source: URL of the MCP server that triggered auto-discovery
-- Absent for manually created providers
DEFINE FIELD OVERWRITE discovery_source ON credential_provider TYPE option<string>;
```

### No Changes Required

- `connected_account` — existing schema supports OAuth tokens (`access_token_encrypted`, `refresh_token_encrypted`, `token_expires_at`)
- `mcp_tool` — existing `source_server` and `provider` fields are sufficient

## TypeScript Types

### Static Headers

```typescript
type HeaderEntry = {
  name: string;
  value: string;
};

type EncryptedHeaderEntry = {
  name: string;
  value_encrypted: string;
};
```

### Auth Mode

```typescript
type McpServerAuthMode = "none" | "static_headers" | "oauth" | "provider";

// Extended from existing McpServerListItem
type McpServerRecord = {
  id: string;
  name: string;
  url: string;
  transport: "sse" | "streamable-http";
  workspace: RecordId<"workspace">;
  auth_mode: McpServerAuthMode;
  static_headers?: EncryptedHeaderEntry[];
  oauth_account?: RecordId<"connected_account">;
  provider?: RecordId<"credential_provider">;
  last_status?: string;
  last_error?: string;
  tool_count: number;
  created_at: string;
};
```

### OAuth Discovery (RFC 9728 + RFC 8414)

```typescript
// RFC 9728 — Protected Resource Metadata
type ProtectedResourceMetadata = {
  resource: string;
  authorization_servers: string[];
  scopes_supported?: string[];
  bearer_methods_supported?: string[];
};

// RFC 8414 — Authorization Server Metadata
type AuthServerMetadata = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  scopes_supported?: string[];
  response_types_supported: string[];
  code_challenge_methods_supported?: string[];
  grant_types_supported?: string[];
};

type DiscoveredAuthConfig = {
  authServerUrl: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint?: string;
  scopesSupported?: string[];
  supportsS256: boolean;
  resourceUri: string; // MCP server canonical URI (RFC 8707)
};
```

### PKCE + Authorization

```typescript
type PkceChallenge = {
  codeVerifier: string;  // 43-128 chars, [A-Z]/[a-z]/[0-9]/-._~
  codeChallenge: string; // BASE64URL(SHA256(codeVerifier))
};

type AuthorizationParams = {
  authorizationEndpoint: string;
  clientId: string;       // URL to Brain's Client ID Metadata Document
  redirectUri: string;
  codeChallenge: string;
  state: string;
  resource: string;       // MCP server canonical URI (RFC 8707)
  scope?: string;
};

type TokenExchangeParams = {
  tokenEndpoint: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
  clientId: string;
};

type TokenResult = {
  access_token: string;
  token_type: "Bearer";
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
};
```

### Client ID Metadata Document (MCP spec preferred registration)

```typescript
// Brain serves this at GET /.well-known/oauth-client-id
type ClientMetadataDocument = {
  client_id: string;           // MUST equal the document URL
  client_name: string;
  redirect_uris: string[];
  grant_types: ["authorization_code"];
  response_types: ["code"];
  token_endpoint_auth_method: "none";
  client_uri?: string;
  logo_uri?: string;
};
```

### API Request/Response

```typescript
// POST /mcp-servers (extended)
type CreateMcpServerRequest = {
  name: string;
  url: string;
  transport: "sse" | "streamable-http";
  auth_mode: McpServerAuthMode;
  static_headers?: HeaderEntry[];       // when auth_mode = "static_headers"
  provider_id?: string;                 // when auth_mode = "provider"
};

// POST /mcp-servers/:id/discover-auth
type DiscoverAuthResponse = {
  discovered: true;
  auth_server: string;
  authorization_endpoint: string;
  scopes_supported?: string[];
  supports_dynamic_registration: boolean;
  provider_id: string; // auto-created credential_provider ID
} | {
  discovered: false;
  error: string;
};

// GET /mcp-servers/:id (extended response)
type McpServerDetailResponse = {
  id: string;
  name: string;
  url: string;
  transport: string;
  auth_mode: McpServerAuthMode;
  has_static_headers: boolean;          // never expose encrypted values
  static_header_names?: string[];       // only names, never values
  auth_status?: "connected" | "expired" | "error" | "not_authorized";
  auth_server?: string;                 // display name of discovered auth server
  last_status?: string;
  tool_count: number;
  created_at: string;
};
```

## Migration Script

File: `schema/migrations/NNNN_mcp_server_auth_modes.surql`

```sql
BEGIN TRANSACTION;

-- Add auth_mode to mcp_server (default "none" for existing servers)
DEFINE FIELD OVERWRITE auth_mode ON mcp_server TYPE string
  DEFAULT "none"
  ASSERT $value IN ["none", "static_headers", "oauth", "provider"];

-- Existing servers with a provider reference → set auth_mode to "provider"
UPDATE mcp_server SET auth_mode = "provider" WHERE provider IS NOT NONE;

-- Static headers storage
DEFINE FIELD OVERWRITE static_headers ON mcp_server TYPE option<array<object>>;
DEFINE FIELD OVERWRITE static_headers[*].name ON mcp_server TYPE string;
DEFINE FIELD OVERWRITE static_headers[*].value_encrypted ON mcp_server TYPE string;

-- OAuth account link
DEFINE FIELD OVERWRITE oauth_account ON mcp_server TYPE option<record<connected_account>>;

-- Discovery source on credential_provider
DEFINE FIELD OVERWRITE discovery_source ON credential_provider TYPE option<string>;

COMMIT TRANSACTION;
```
