# Shared Artifacts Registry — MCP Tool Registry

## Artifact Definitions

| Artifact | Type | Source Step | Consumers | Lifecycle |
|----------|------|------------|-----------|-----------|
| `credential_provider.id` | `record<credential_provider>` | Admin: Register Provider | Connect MCP Server, Initiate OAuth / Static Entry, Token Exchange | Persists until admin deletes provider |
| `mcp_tool[].id` | `record<mcp_tool>[]` | Admin: Discover Tools | Configure Governance, Grant Access, Proxy: Inject Tools | Refreshed on `tools/list_changed` notification |
| `connected_account.id` | `record<connected_account>` | User: Connected (OAuth2 or static entry) | Proxy: Execute Tool Call | Active until revoked or expired (OAuth2: refresh failure; static: manual revocation) |
| `identity.id` | `record<identity>` | Proxy: Resolve Identity | Proxy: Inject Tools, Proxy: Execute Tool Call | Session-scoped, resolved per request |
| `effective_toolset[]` | `mcp_tool[]` | Proxy: Inject Tools | LLM: Tool Selection | Request-scoped, recomputed per LLM call |
| `trace.id` | `record<trace>` | Proxy: Execute Tool Call | Audit/Forensics | Persists permanently |
| `can_use` | relation edge | Admin: Grant Access | Proxy: Inject Tools | Persists until admin revokes |
| `possesses` | relation edge | Admin: Assign Skill | Proxy: Inject Tools (via skill_requires) | Persists until skill unassigned |
| `governs_tool` | relation edge | Admin: Configure Governance | Proxy: Policy Check | Persists with policy lifecycle |

## Data Flow

```
credential_provider ──▸ mcp_tool.provider (FK)
                      │
identity ──can_use──▸ mcp_tool ◂──skill_requires── skill ◂──possesses── identity
                      │
                  governs_tool
                      │
                    policy
                      │
connected_account ──▸ credential_provider
      │
   identity (owner)
```

## Encryption Requirements

| Field | Encryption | At Rest | In Transit |
|-------|-----------|---------|------------|
| `credential_provider.client_secret` | AES-256-GCM | Yes | TLS only |
| `connected_account.access_token` | AES-256-GCM | Yes | Never in LLM context |
| `connected_account.refresh_token` | AES-256-GCM | Yes | Never in LLM context |
| `connected_account.api_key` | AES-256-GCM | Yes | Never in LLM context |
| `connected_account.basic_password` | AES-256-GCM | Yes | Never in LLM context |
