# Story Map — mcp-server-auth

## Backbone (User Activities)

```
Configure Auth → Authorize → Execute Tools → Monitor Auth Status
```

## Walking Skeleton (Slice 1: Static Headers)

Delivers end-to-end value with minimal complexity — admin can auth with any MCP server using static headers.

| Activity | Story |
|----------|-------|
| Configure Auth | US-1: Add static headers to MCP server |
| Execute Tools | Headers injected on discovery + tool execution |
| Monitor Status | Server shows auth mode badge |

**Why first:** Most MCP servers today (GitHub, Linear, etc.) work with static tokens. This unblocks real usage immediately.

## Slice 2: OAuth 2.1 Discovery + Authorization

Full MCP-spec-compliant OAuth flow.

| Activity | Story |
|----------|-------|
| Configure Auth | US-2: Auto-discover OAuth from server URL |
| Authorize | US-3: Browser-based OAuth authorization with PKCE |
| Authorize | US-4: Dynamic client registration |
| Execute Tools | Token injection + auto-refresh |
| Monitor Status | US-5: Auth status visibility (expired, connected, error) |

**Why second:** OAuth discovery is more complex and fewer MCP servers support it today. Static headers cover the immediate need.

## Slice 3: Re-authorization + Token Lifecycle

| Activity | Story |
|----------|-------|
| Authorize | Re-authorize without removing server |
| Monitor Status | Proactive token expiry warnings |
| Execute Tools | Graceful degradation on auth failure |

## Prioritization

| Priority | Story | Rationale |
|----------|-------|-----------|
| P0 | US-1 (Static Headers) | Unblocks all current MCP servers |
| P1 | US-2 (OAuth Discovery) | Spec compliance, reduces manual config |
| P1 | US-3 (OAuth Authorization) | Required for OAuth to work end-to-end |
| P2 | US-4 (Dynamic Registration) | Nice-to-have, fallback to Client ID Metadata exists |
| P2 | US-5 (Auth Status) | UX polish, not blocking functionality |
