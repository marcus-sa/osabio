# Journey Map — MCP Tool Lifecycle

## Overview

Three actors, one continuous lifecycle: admin registers providers and tools, users connect accounts, proxy injects tools and brokers credentials at LLM call time.

---

## Actor 1: Workspace Admin — Provider & Tool Setup

```
┌─────────────┐     ┌─────────────┐     ┌──────────────┐     ┌──────────────┐     ┌─────────────┐
│  Register    │────▸│  Connect     │────▸│  Discover    │────▸│  Configure   │────▸│  Grant      │
│  Provider    │     │  MCP Server  │     │  Tools       │     │  Governance  │     │  Access     │
└─────────────┘     └─────────────┘     └──────────────┘     └──────────────┘     └─────────────┘
   😐 Neutral         😊 Hopeful          😃 Excited          🤔 Thoughtful       😌 Confident
   "Let me add        "Connecting         "Brain found        "Which agents       "Team is set
    GitHub creds"      the server"         12 tools!"          need what?"         up safely"
```

### Steps

| Step | Action | System Response | Shared Artifact | Emotion |
|------|--------|----------------|-----------------|---------|
| 1. Register Provider | Admin selects auth method (oauth2/api_key/bearer/basic) and enters credentials. For OAuth2: client_id, secret, URLs, scopes. For api_key/bearer/basic: just names the provider. | Creates `credential_provider` record, encrypts secrets at rest | `${credential_provider.id}` | Neutral — routine admin task |
| 2. Connect MCP Server | Admin provides MCP server connection URL + auth | Osabio calls `tools/list`, inventories tools | `${mcp_server_connection}` | Hopeful — seeing what's available |
| 3. Discover Tools | Osabio creates `mcp_tool` records from `tools/list` response | Shows discovered tools with names, descriptions, schemas | `${mcp_tool[].id}` | Excited — tools materialized automatically |
| 4. Configure Governance | Admin sets risk_level per tool, creates `governs_tool` policy edges | Policy rules attached to tools | `${policy.id}`, `${governs_tool}` edges | Thoughtful — balancing access vs safety |
| 5. Grant Access | Admin creates `can_use` edges or assigns skills (`possesses`) to identities | Agents' effective toolsets updated | `${can_use}` or `${possesses}` edges | Confident — governed access in place |

### Error Paths
- **Invalid OAuth credentials**: Validation error on provider registration, clear message: "Authorization URL returned 4xx"
- **MCP server unreachable**: Connection timeout with retry option + manual tool entry fallback
- **Tool schema conflict**: Duplicate tool name across servers flagged, admin resolves namespace

---

## Actor 2: User/Agent Identity — Account Connection

Two paths based on provider auth method:

```
                                    ┌──────────────┐     ┌──────────────┐
                         OAuth2 ──▸│  Authorize   │────▸│              │
┌─────────────┐     ┌──────────┐  │  at Provider │     │  Connected   │
│  Browse      │────▸│  Connect │──┤              │     │  ✓ Ready     │
│  Providers   │     │          │  └──────────────┘     │              │
└─────────────┘     └──────────┘       Static ────────▸│              │
   😐 Curious       😊 Familiar     🤔 Deciding         └──────────────┘
   "What can I      "I know this    "Grant repo           😌 Relieved
    connect?"        pattern"        scope? Yes."          "Agents are
                                    "Just paste             empowered"
                                     my API key"
```

### Steps

| Step | Action | System Response | Shared Artifact | Emotion |
|------|--------|----------------|-----------------|---------|
| 1. Browse Providers | User sees available `credential_provider` records for workspace | List of providers with name, auth method, required scopes | `${credential_provider[]}` | Curious — exploring options |
| 2a. Connect (OAuth2) | User clicks "Connect" on an OAuth2 provider | Osabio builds auth URL from `credential_provider`, redirects | `${authorization_url}` with `state` param | Familiar — standard OAuth pattern |
| 2b. Connect (Static) | User clicks "Connect" on an api_key/bearer/basic provider | Osabio shows credential entry form (API key, or username+password) | Form fields scoped to `auth_method` | Familiar — simple form entry |
| 3a. Authorize (OAuth2) | User reviews scopes at provider's consent screen, approves | Provider redirects back with authorization code → Osabio exchanges for tokens | `${authorization_code}` | Deciding — evaluating scope request |
| 3b. Submit (Static) | User submits API key or basic credentials | Osabio encrypts and stores immediately | Encrypted credential fields | Quick — no redirect needed |
| 4. Connected | `connected_account` created with encrypted credentials | Confirmation: "Provider connected. Your agents can now use its tools." | `${connected_account.id}` | Relieved — done, agents empowered |

### Error Paths
- **User denies OAuth consent**: Redirect back with error, show "Connection cancelled" — no partial state
- **Token exchange fails**: Provider error surfaced, retry link, admin contacted if persistent
- **Expired refresh token** (OAuth2): Status changes to `expired`, user prompted to reconnect
- **Invalid API key**: First tool call fails → mark `connected_account.status = "expired"`, prompt re-entry

---

## Actor 3: Agent (via Proxy) — Tool Injection & Execution

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌─────────────┐
│  LLM Request │────▸│  Resolve     │────▸│  Inject      │────▸│  LLM Uses    │────▸│  Proxy       │────▸│  Result     │
│  via Proxy   │     │  Identity    │     │  Tools       │     │  Tool        │     │  Executes    │     │  Returned   │
└─────────────┘     └──────────────┘     └──────────────┘     └──────────────┘     └──────────────┘     └─────────────┘
   😐 Unaware         ⚙️ Automatic         ⚙️ Automatic         🤖 Capable          🔒 Secure           😌 Seamless
   "Sending LLM       "Proxy knows         "GitHub tools       "I'll create        "Credentials        "Agent got
    request..."         who I am"           added to req"       that issue"         resolved,            the result"
                                                                                    call executed"
```

### Steps

| Step | Action | System Response | Shared Artifact | Emotion |
|------|--------|----------------|-----------------|---------|
| 1. LLM Request | Agent sends request through `ANTHROPIC_BASE_URL` (Osabio proxy) | Proxy receives enriched request with runtime tools | `${proxy_request}` | Unaware — agent doesn't know about injection |
| 2. Resolve Identity | Proxy extracts identity from DPoP/proxy-token auth | Identity record loaded | `${identity.id}` | Automatic |
| 3. Inject Tools | Proxy resolves `can_use ∪ (possesses → skill_requires)`, injects tool defs | Request `tools[]` parameter extended with Osabio-managed tools | `${effective_toolset[]}` | Automatic — additive, no conflicts |
| 4. LLM Uses Tool | LLM returns `tool_calls` including an integration tool | Proxy intercepts tool_calls response | `${tool_call.name}`, `${tool_call.arguments}` | Capable — LLM has the tools it needs |
| 5. Proxy Executes | Proxy matches tool to `mcp_tool`, resolves credentials by auth method, executes | Credential resolution: `mcp_tool.provider` → `credential_provider` → `connected_account` → inject by auth_method (OAuth2 bearer / API key header / basic auth) → execute → sanitize | `${trace.id}` | Secure — credentials never in LLM context |
| 6. Result Returned | Proxy sends tool result back to LLM, loop continues | Agent receives result transparently | `${tool_result}` | Seamless — agent never saw the machinery |

### Tool Call Routing Decision Tree

```
tool_call received
  ├─ name matches mcp_tool with provider? → Integration tool
  │   ├─ Policy check (governs_tool) → Denied? → Return error tool result
  │   ├─ Resolve connected_account for identity + provider
  │   │   ├─ No account? → Return "not connected" error
  │   │   └─ Credential ready? → Proceed (OAuth2: check expiry, refresh if needed)
  │   ├─ Inject credential by auth_method:
  │   │   ├─ oauth2: Authorization: Bearer {access_token}
  │   │   ├─ api_key: provider-specific header (e.g. X-API-Key)
  │   │   ├─ bearer: Authorization: Bearer {access_token}
  │   │   └─ basic: Authorization: Basic {base64(user:pass)}
  │   ├─ Execute HTTP call
  │   ├─ Strip credentials from response
  │   └─ Write trace → Return sanitized result
  │
  ├─ name matches Osabio-native tool? → Context tool
  │   ├─ Execute graph query directly
  │   └─ Write trace → Return result
  │
  └─ name unknown? → Runtime tool (pass-through)
      └─ Forward to runtime for execution
```

### Error Paths
- **No connected account**: Tool result returns structured error: "GitHub account not connected. Ask workspace admin."
- **Token refresh failure**: Attempt refresh → if fails, mark `connected_account.status = "expired"`, return error with reconnect guidance
- **Policy denial**: `governs_tool` check fails → return "Tool call denied by policy: {reason}"
- **Integration API error**: 4xx/5xx from provider → return sanitized error (no credentials leaked), trace records failure
- **Rate limit hit**: `can_use.max_calls_per_hour` exceeded → return rate limit error with reset time
