# Walking Skeleton — mcp-server-auth

## Goal

End-to-end static header auth: admin creates MCP server with headers → headers encrypted at rest → headers injected on MCP connect → tools discovered with auth.

## Skeleton Scope

| Layer | What's wired |
|-------|-------------|
| Schema | `auth_mode` + `static_headers` fields on `mcp_server` |
| API | `POST /mcp-servers` accepts `auth_mode` + `static_headers` |
| Encryption | Header values encrypted/decrypted via existing AES-256-GCM |
| Resolver | `resolveAuthForMcpServer()` dispatches on `auth_mode` |
| MCP Client | Auth headers injected into transport |
| API response | Header values never returned (only names + has_static_headers boolean) |

## Walking Skeleton Tests (4 scenarios)

1. **Create MCP server with static headers** — POST creates record with `auth_mode: "static_headers"`
2. **Header values encrypted at rest** — direct DB read shows `value_encrypted`, not plaintext
3. **Header values never in API response** — GET response has `has_static_headers: true` but no values
4. **Static headers injected on MCP connect** — MSW mock MCP server verifies `Authorization` header present

## Not in Skeleton

- OAuth discovery + authorization (Milestone 2-3)
- Header edit/remove (Milestone 1)
- Header name validation (Milestone 1)
- Auth status display (Milestone 3)
- Token refresh (Milestone 3)
