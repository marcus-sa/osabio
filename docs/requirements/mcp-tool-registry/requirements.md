# Requirements — MCP Tool Registry (#178)

## Functional Requirements

### FR-1: Tool Registry Schema
The system must persist MCP tool definitions as `mcp_tool` graph nodes with name, toolkit, description, input_schema, output_schema (optional, from MCP `tools/list` `outputSchema`), provider reference, risk_level, workspace scope, and status.

### FR-2: Direct Tool Authorization
The system must support `can_use` relation edges from identity to mcp_tool, enabling per-agent tool grants with optional rate limits (max_calls_per_hour).

### FR-3: Tool Resolution
The system must resolve an identity's effective toolset as the union of direct grants (`can_use`) and skill-derived tools (`possesses` -> `skill_requires`), with deduplication.

### FR-4: Proxy Tool Injection
The LLM proxy must inject Brain-managed tool definitions into the `tools[]` parameter of forwarded LLM requests, additively alongside runtime-provided tools.

### FR-5: Proxy Tool Call Interception
The proxy must intercept `tool_calls` in LLM responses and route them:
- **Brain-native**: execute graph query directly
- **Integration**: resolve credentials, execute, sanitize
- **Unknown**: pass through to runtime

### FR-6: Credential Provider Registration
Workspace admins must be able to register credential providers with an auth method (`oauth2`, `api_key`, `bearer`, `basic`). For OAuth2: client credentials, authorization/token URLs, and scopes. For static methods: just a provider name (credentials are per-account). Secrets must be encrypted at rest.

### FR-7: Account Connection (Multi-Method)
Users must be able to connect accounts to providers via the provider's auth method:
- **OAuth2**: standard authorization code flow (redirect → consent → callback → token exchange)
- **API key / bearer / basic**: direct credential entry via form

All credentials must be encrypted at rest.

### FR-8: Credential Resolution
The proxy must resolve credentials at tool call time by: mcp_tool.provider -> credential_provider -> connected_account (for identity + provider) -> inject credential by auth_method:
- `oauth2`: `Authorization: Bearer {access_token}`
- `api_key`: provider-specific header (e.g. `X-API-Key`)
- `bearer`: `Authorization: Bearer {access_token}`
- `basic`: `Authorization: Basic {base64(username:password)}`

### FR-9: Token Refresh (OAuth2)
For OAuth2 providers, the proxy must detect expired access tokens (via token_expires_at) and refresh them using the refresh_token before tool execution. Failed refresh must mark the connected_account as expired.

### FR-10: Tool Governance
Policies must be attachable to tools via `governs_tool` relation edges with conditions. The proxy must evaluate these before executing tool calls.

### FR-11: MCP Server Discovery
The system must support connecting to external MCP servers, calling `tools/list` to discover available tools, and creating `mcp_tool` records from the response.

### FR-12: Tool Change Notifications
The system must subscribe to `notifications/tools/list_changed` from connected MCP servers and refresh the tool registry accordingly.

### FR-13: Trace Logging
Every tool call execution (success, failure, denial, rate limit) must produce a trace record with tool_name, duration, outcome, and identity.

## Non-Functional Requirements

### NFR-1: Security
- Credentials (client_secret, access_token, refresh_token, api_key, basic_password) must never appear in LLM context, agent logs, or API responses
- All credential fields encrypted at rest with AES-256-GCM
- Tool results from integration calls must be sanitized (strip auth headers, tokens)

### NFR-2: Latency
- Tool resolution and injection must add < 50ms to proxy request processing
- Credential resolution and token refresh must add < 200ms to tool execution
- Tool resolution results should be cached per identity with short TTL

### NFR-3: Compatibility
- Tool injection must be additive — runtime tools in the request must not be modified or removed
- Must work with any LLM provider that supports the Anthropic Messages API tool format
- Must work with any agent runtime routing through Brain's proxy

### NFR-4: Scalability
- Tool resolution queries must be efficient for workspaces with 100+ tools and 50+ identities
- Connected account lookups must be indexed by (identity, provider)

### NFR-5: Auditability
- Full provenance chain: tool_call -> mcp_tool -> credential_provider -> connected_account -> trace
- All tool governance decisions (grant, deny, rate limit) must be traceable
