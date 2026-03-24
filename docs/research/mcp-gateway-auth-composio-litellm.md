# MCP Gateway Auth: Composio vs LiteLLM

**Date**: 2026-03-23
**Sources**: docs.composio.dev, docs.litellm.ai, github.com/ComposioHQ/composio, github.com/BerriAI/litellm (source code)
**Relevance**: Informs Brain's MCP Tool Registry UI auth architecture (ADR-069, ADR-070)

---

## Executive Summary

Composio and LiteLLM take fundamentally different approaches to MCP server management and auth. **Composio is a tool-as-a-service platform** that acts as the MCP server itself, proxying 1000+ third-party APIs through a unified session-scoped MCP endpoint. **LiteLLM is an MCP gateway/proxy** that aggregates multiple upstream MCP servers behind a single endpoint with permission management. Both handle auth on behalf of end users, but at different layers.

---

## 1. Composio

### Architecture Model: Tool-as-a-Service MCP Server

Composio doesn't connect to external MCP servers — it **is** the MCP server. It wraps 1000+ third-party APIs (GitHub, Gmail, Slack, etc.) as MCP-compatible toolkits served from Composio's cloud.

```
Agent (Claude Code, Cursor, etc.)
  └─→ Composio MCP Endpoint (session.mcp.url)
        └─→ Composio Cloud
              ├─→ GitHub API (via stored OAuth tokens)
              ├─→ Gmail API (via stored OAuth tokens)
              └─→ Slack API (via stored API keys)
```

### Auth Model: Session-Scoped with Managed Credentials

**Key concepts:**
- **Auth Config**: A per-toolkit blueprint defining auth method (OAuth2, Bearer, API key), scopes, and credentials. One auth config per toolkit, reused across all users.
- **Connected Account**: Per-user credential storage (OAuth tokens or API keys) linked to a user ID.
- **Session**: Immutable scope binding a user + toolkits + auth configs. Created via `composio.create(user_id="...")`.

**Two auth flows:**

| Flow | Mechanism | When |
|------|-----------|------|
| **In-chat auth** | Agent prompts user with a Connect Link (`connect.composio.dev/link/...`). User clicks, authenticates via OAuth, agent detects completion. | Default — zero setup required |
| **Manual auth** | App calls `session.authorize()` during onboarding or settings page. | Pre-chat connection (settings pages, onboarding) |

**Credential lifecycle:**
- Composio manages OAuth token refresh automatically
- Tokens stored server-side in Composio cloud
- Users never see raw tokens — only Connect Links
- Custom auth configs allow bringing your own OAuth app credentials for white-labeling

### MCP Endpoint Exposure

```python
session = composio.create(user_id="user_123")
mcp_url = session.mcp.url      # Per-session MCP endpoint
mcp_headers = session.mcp.headers  # Auth headers for the session
```

The MCP URL + headers are passed directly to any MCP-compatible client (OpenAI Agents SDK, Claude Agent SDK, Vercel AI SDK, Cursor, etc.). The session is immutable — changing toolkits or accounts requires creating a new session.

### Tool Discovery: Meta-Tool Pattern

Instead of exposing all 1000+ tools to the LLM (which would consume ~55K+ tokens), Composio provides **6 meta-tools**:

| Meta Tool | Purpose |
|-----------|---------|
| `COMPOSIO_SEARCH_TOOLS` | Discover relevant tools across 500+ apps |
| `COMPOSIO_GET_TOOL_SCHEMAS` | Retrieve input schemas for specific tools |
| `COMPOSIO_MULTI_EXECUTE_TOOL` | Execute up to 50 tools in parallel |
| `COMPOSIO_MANAGE_CONNECTIONS` | Handle OAuth/API key auth flows |
| `COMPOSIO_REMOTE_WORKBENCH` | Run Python in persistent sandbox |
| `COMPOSIO_REMOTE_BASH_TOOL` | Execute bash commands |

The agent uses `SEARCH_TOOLS` to find what's available, `GET_TOOL_SCHEMAS` to learn inputs, `MANAGE_CONNECTIONS` to trigger auth if needed, then `MULTI_EXECUTE_TOOL` to run actions. This keeps context window usage minimal regardless of how many integrations are available.

### Single Toolkit MCP (Alternative)

For simpler cases, Composio also supports creating a dedicated MCP server for a single toolkit:

```python
server = composio.mcp.create(
    name="my-gmail-server",
    toolkits=[{"toolkit": "gmail", "auth_config": "ac_xyz123"}],
    allowed_tools=["GMAIL_FETCH_EMAILS", "GMAIL_SEND_EMAIL"]
)
# Returns SSE URL for MCP client config
```

This exposes toolkit-specific tools directly (not meta-tools), useful for dedicated single-purpose integrations.

---

## 2. LiteLLM

### Architecture Model: MCP Gateway/Proxy

LiteLLM acts as a **reverse proxy** that aggregates multiple upstream MCP servers behind a single gateway endpoint. It doesn't implement tools itself — it forwards MCP protocol messages to actual MCP servers.

```
Agent / IDE
  └─→ LiteLLM Proxy (fixed endpoint)
        ├─→ GitHub MCP Server (upstream)
        ├─→ Zapier MCP Server (upstream)
        ├─→ CircleCI MCP Server (stdio)
        └─→ Custom MCP Server (HTTP)
```

### Auth Model: Three Layers

**Layer 1: Client → LiteLLM (API Key)**
- Clients authenticate to LiteLLM using `x-litellm-api-key: Bearer sk-...`
- Keys are scoped to teams, organizations, or individual users
- Keys control which MCP servers the client can access

**Layer 2: LiteLLM → Upstream MCP Servers (OAuth2 or Static Headers)**

Two OAuth flows supported:

| Flow | Config | Use Case |
|------|--------|----------|
| **Interactive (PKCE)** | `auth_type: oauth2` + `client_id` + `client_secret` | User-facing apps (Claude Code, Cursor). Full browser consent flow. |
| **Machine-to-Machine** | `auth_type: oauth2` + `client_id` + `client_secret` + `token_url` + `grant_type: client_credentials` | Backend services, CI/CD. Automatic token fetch/cache/refresh. |

For non-OAuth servers, LiteLLM supports **static headers** — arbitrary headers sent with every request to a specific upstream server.

**Layer 3: Permission Management (Key/Team/Org scoping)**
- MCP server access is controlled per API key, team, or organization
- End-user tracking via `x-litellm-end-user-id` header for spend/budget enforcement
- Admins can restrict which MCP servers a key can access

### Transport Support

| Transport | Config |
|-----------|--------|
| **Streamable HTTP** | `url: "https://..."` (default) |
| **SSE** | `url: "https://.../sse"` |
| **stdio** | `transport: "stdio"`, `command`, `args`, `env` |

### Tool Namespacing

LiteLLM namespaces tools from multiple servers by prefixing tool names with the server name (e.g., `github_mcp__create_issue`). This prevents name collisions and complies with SEP-986. Server aliases are supported for shorter names.

### M2M Token Management

For `client_credentials` flows:
1. On first MCP request, LiteLLM POSTs to `token_url` with `grant_type=client_credentials`
2. Access token cached in-memory with TTL = `expires_in - 60s`
3. Subsequent requests reuse cached token
4. Automatic refresh on expiry

### Interactive OAuth (PKCE) Flow

Full RFC 7591 / PKCE flow:
1. **Resource Discovery**: Client fetches `.well-known/oauth-protected-resource` from LiteLLM
2. **AS Discovery**: Client fetches `.well-known/oauth-authorization-server`
3. **Dynamic Client Registration**: LiteLLM forwards RFC 7591 registration (or uses pre-stored `client_id`/`client_secret`)
4. **User Authorization**: Browser-based consent with code challenge
5. **Token Exchange**: LiteLLM exchanges code + verifier for tokens
6. **MCP Invocation**: Client sends MCP JSON-RPC with token, LiteLLM forwards to upstream

### Storage

MCP server configurations can be stored in database (`STORE_MODEL_IN_DB=True`) or config.yaml. Fine-grained control via `supported_db_objects: ["mcp"]`.

### Proxy Mechanism: How LiteLLM Actually Connects to Upstream MCP Servers

**Source**: `litellm/experimental_mcp_client/client.py`, `litellm/proxy/_experimental/mcp_server/mcp_server_manager.py`

#### No Persistent Connections — Connect-Per-Operation

LiteLLM does **NOT** maintain persistent connections to upstream MCP servers. Every operation (list_tools, call_tool, etc.) follows a **connect → initialize → operate → disconnect** lifecycle:

```python
# From client.py - _execute_session_operation()
async def _execute_session_operation(self, transport_ctx, operation):
    transport = await transport_ctx.__aenter__()       # 1. Open transport
    try:
        read_stream, write_stream = transport[0], transport[1]
        session_ctx = ClientSession(read_stream, write_stream)
        session = await session_ctx.__aenter__()       # 2. Create MCP session
        try:
            await session.initialize()                 # 3. MCP handshake
            return await operation(session)             # 4. Execute operation
        finally:
            await session_ctx.__aexit__(None, None, None)  # 5. Close session
    finally:
        await transport_ctx.__aexit__(None, None, None)    # 6. Close transport
```

Each `list_tools()` or `call_tool()` call:
1. Creates a new `MCPClient` instance via `_create_mcp_client()`
2. Opens a new transport (SSE, Streamable HTTP, or stdio)
3. Creates a new `ClientSession` and runs the MCP `initialize` handshake
4. Executes the single operation
5. Tears down session and transport

This means **every tool call pays the full connection + handshake cost**. There is no connection pool or session reuse.

#### Transport Context Factories

`_create_transport_context()` dispatches by transport type:
- **SSE**: Uses `mcp.client.sse.sse_client(url, headers, ...)` — an async context manager that opens an HTTP SSE connection
- **Streamable HTTP**: Uses `mcp.client.streamable_http.streamable_http_client(url, headers, ...)` — newer HTTP-based transport
- **stdio**: Uses `mcp.client.stdio.stdio_client(StdioServerParameters(command, args, env))` — spawns a subprocess

All three are async context managers from the official MCP Python SDK that create and tear down connections on enter/exit.

#### MCPClient is Stateless

```python
# From mcp_server_manager.py - _create_mcp_client()
client = MCPClient(
    server_url=server_url,
    transport_type=transport,
    auth_type=server.auth_type,
    auth_value=auth_value,         # Resolved per-call (OAuth token, API key, etc.)
    timeout=MCP_CLIENT_TIMEOUT,
    extra_headers=extra_headers,
    aws_auth=aws_auth,
)
```

The `MCPClient` stores only configuration (URL, auth, headers). It holds **no open connections**. A new instance is created for each upstream call.

#### MCPServerManager Registry (Server-Side State)

The `MCPServerManager` maintains a registry of known upstream servers:

```python
class MCPServerManager:
    def __init__(self):
        self.registry: Dict[str, MCPServer] = {}       # All known servers (config + DB)
        self.config_mcp_servers: Dict[str, MCPServer] = {}  # Config-file servers only
```

This is a **configuration registry**, not a connection pool. It stores server metadata (URL, transport type, auth config, allowed tools, access groups) but no live connections.

#### Tool Listing is Fetched On-Demand

When a client calls `list_tools`, the manager fans out to all allowed upstream servers in parallel:

```python
tasks = [_fetch_server_tools(server_id) for server_id in allowed_mcp_servers]
results = await asyncio.gather(*tasks)
list_tools_result = [tool for tools in results for tool in tools]
```

Each `_fetch_server_tools` creates a fresh `MCPClient`, connects, lists tools, and disconnects. There is **no tool cache** — every `list_tools` call hits all upstream servers.

#### What IS Cached

- **OAuth2 M2M tokens**: Cached in-memory with TTL = `expires_in - 60s`. Refreshed automatically on expiry. (`oauth2_token_cache.py`)
- **BYOK credentials**: Cached per `(user_id, server_id)` with 60s TTL and 4096 entry cap. Avoids DB lookups per tool call. (`server.py`)
- **Tool definitions are NOT cached**: Every `list_tools` call connects to upstream servers fresh.

#### Implications

| Aspect | LiteLLM Behavior |
|--------|-----------------|
| Connection model | Ephemeral (connect-per-operation) |
| Session reuse | None |
| Tool caching | None (fresh `list_tools` per request) |
| Auth token caching | Yes (OAuth2 M2M tokens, BYOK credentials) |
| stdio processes | Spawned and killed per operation |
| Latency per call | Full transport setup + MCP handshake + operation |
| Scalability | No connection limits to manage, but higher latency |

---

## 3. Comparison Matrix

| Dimension | Composio | LiteLLM |
|-----------|----------|---------|
| **Role** | IS the MCP server (tool-as-a-service) | Proxies TO MCP servers (gateway) |
| **Tool source** | 1000+ built-in API wrappers | External MCP servers you configure |
| **Auth to upstream APIs** | Managed OAuth + Connect Links | OAuth2 (PKCE + M2M) + static headers |
| **User auth model** | Session-scoped (user_id → credentials) | API key scoped (key → team → allowed servers) |
| **Token management** | Fully managed (refresh, storage, rotation) | M2M: auto-cache/refresh. PKCE: per-user tokens. |
| **Multi-tenancy** | User ID + session isolation | Key/Team/Org permission hierarchy |
| **Tool discovery** | Meta-tools (search → schema → execute) | tools/list from upstream servers |
| **Context optimization** | 6 meta-tools (~minimal tokens) | Tool namespacing, all tools exposed |
| **Transport** | HTTP (Composio-hosted) | HTTP, SSE, stdio |
| **Deployment** | SaaS (Composio cloud) | Self-hosted proxy |
| **Custom MCP servers** | No (Composio's tools only) | Yes (any MCP server) |

---

## 4. Relevance to Brain's Tool Registry

### Patterns to Consider

**From Composio:**
- **Meta-tool pattern** solves the context window problem elegantly. Instead of loading all tool schemas into the LLM context, expose discovery/execute meta-tools.
- **Session-scoped auth** cleanly isolates user credentials. Each session binds a user to their connected accounts.
- **Connect Links** provide a user-friendly OAuth flow where the agent prompts the user inline.
- **Auth Config as blueprint** separates the "how to auth" (OAuth app credentials, scopes) from "who authenticated" (connected account per user).

**From LiteLLM:**
- **Gateway/proxy model** is closer to Brain's architecture — Brain aggregates external MCP servers, it doesn't replace them.
- **OAuth2 PKCE + M2M dual flows** cover both interactive (user-facing) and automated (backend) use cases.
- **Tool namespacing** (server_name prefix) prevents collisions when aggregating multiple servers.
- **Permission management by Key/Team/Org** maps well to Brain's workspace-scoped access control.
- **Static headers as fallback** handles non-OAuth servers pragmatically.

### Key Insight

Brain's tool registry sits between these two models:
- Like LiteLLM, it **aggregates external MCP servers** (not a tool-as-a-service).
- Like Composio, it needs **per-user credential management** with OAuth flows.
- The **meta-tool pattern** from Composio could inform how Brain exposes discovered tools to agents without context window explosion.
- LiteLLM's **PKCE proxy** pattern (LiteLLM mediates OAuth between client and upstream auth server) is directly applicable to Brain's OAuth2 callback architecture.

---

## Sources

1. Composio Documentation - Authentication: https://docs.composio.dev/docs/authentication
2. Composio Documentation - How It Works: https://docs.composio.dev/docs/how-composio-works
3. Composio Documentation - Tools and Toolkits: https://docs.composio.dev/docs/tools-and-toolkits
4. Composio Documentation - Native Tools vs MCP: https://docs.composio.dev/docs/native-tools-vs-mcp
5. Composio Documentation - Single Toolkit MCP: https://docs.composio.dev/docs/single-toolkit-mcp
6. LiteLLM Documentation - MCP Overview: https://docs.litellm.ai/docs/mcp
7. LiteLLM Documentation - MCP OAuth: https://docs.litellm.ai/docs/mcp_oauth
8. Composio GitHub Repository: https://github.com/ComposioHQ/composio
