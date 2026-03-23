# User Stories — mcp-server-auth

## US-1: Static Header Authentication
**As a** workspace admin
**I want to** add static authorization headers to an MCP server
**So that** Brain can authenticate with MCP servers that use API keys or PATs without an OAuth flow

### Acceptance Criteria
- AC-1a: Add MCP Server dialog has an "Auth Mode" selector with options: No Auth, Static Headers, OAuth
- AC-1b: When "Static Headers" selected, admin can add one or more key-value pairs (header name + value)
- AC-1c: Header values are masked in the form after entry (like password fields)
- AC-1d: Header values are encrypted before storage (AES-256-GCM)
- AC-1e: Headers are injected on MCP client connections for discovery, sync, and tool execution
- AC-1f: Admin can edit/remove headers after creation
- AC-1g: API responses never include decrypted header values

## US-2: MCP OAuth 2.1 Auto-Discovery
**As a** workspace admin
**I want** Brain to automatically discover OAuth requirements from an MCP server URL
**So that** I don't have to manually enter authorization_url, token_url, client_id, and client_secret

### Acceptance Criteria
- AC-2a: When admin enters an MCP server URL and selects "OAuth" auth mode, Brain probes the server for auth requirements
- AC-2b: Brain fetches Protected Resource Metadata from `/.well-known/oauth-protected-resource`
- AC-2c: Brain fetches Authorization Server Metadata from discovered auth server
- AC-2d: If discovery succeeds, admin sees discovered endpoints (read-only) and an "Authorize" button
- AC-2e: If discovery fails, admin can fall back to manual provider selection or static headers
- AC-2f: Discovered auth config is stored as a `credential_provider` with `discovery_source` set

## US-3: OAuth 2.1 Browser Authorization
**As a** workspace admin
**I want to** authorize Brain with an MCP server's OAuth provider via browser redirect
**So that** Brain can obtain access tokens to call protected MCP tools

### Acceptance Criteria
- AC-3a: Clicking "Authorize" opens the authorization URL in a new browser tab/window
- AC-3b: Authorization request includes PKCE code_challenge (S256 method)
- AC-3c: After user authorizes, browser redirects to Brain's callback URL with authorization code
- AC-3d: Brain exchanges code for tokens (access_token, refresh_token) at token endpoint
- AC-3e: Tokens are encrypted and stored in `connected_account`
- AC-3f: MCP server status updates to reflect successful authorization
- AC-3g: If token expires, Brain automatically refreshes using refresh_token

## US-4: Dynamic Client Registration
**As** Brain (system)
**I want to** automatically register as an OAuth client with MCP servers that support dynamic registration
**So that** admins don't need to manually create OAuth apps on the provider side

### Acceptance Criteria
- AC-4a: Brain checks if auth server supports `registration_endpoint` in metadata
- AC-4b: If supported, Brain registers with client_name, redirect_uris, grant_types
- AC-4c: Registration response (client_id, client_secret) is encrypted and stored
- AC-4d: If dynamic registration not supported, Brain uses Client ID Metadata Document approach
- AC-4e: Brain hosts its client metadata at a stable HTTPS URL

## US-5: Auth Status Visibility
**As a** workspace admin
**I want to** see the authentication status of each MCP server
**So that** I know which servers need attention (expired tokens, failed auth, etc.)

### Acceptance Criteria
- AC-5a: MCP server list shows auth mode icon/badge per server (none, key, oauth)
- AC-5b: Auth errors surface in server status (e.g., "Auth expired — re-authorize")
- AC-5c: Admin can re-authorize an OAuth server without removing and re-adding it
- AC-5d: Successful auth shows "Connected" with last-authorized timestamp
