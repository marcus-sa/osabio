# Auth

OAuth 2.1 authentication with scope-based authorization, backed by a custom SurrealDB adapter for the Better Auth library.

## The Problem

Brain needs to authenticate both human users (via browser sessions) and AI agents (via OAuth tokens). Each actor type needs different authority levels — a human can confirm decisions directly, while a PM agent can only create provisional ones. The auth layer must enforce these scopes consistently at the HTTP boundary, regardless of whether the request comes from a browser or an MCP client.

## What It Does

- **Better Auth integration**: Configures the Better Auth library with a custom SurrealDB v2 adapter for user/session storage
- **Scope-based authorization**: Maps workspace actions (e.g. `decision:write`, `task:write`) to OAuth scopes via `ACTION_SCOPE_MAP`
- **Client info endpoint**: Exposes OAuth client metadata for MCP agent registration
- **GitHub OAuth**: Supports GitHub as an identity provider for user login

## Key Concepts

| Term | Definition |
|------|------------|
| **ACTION_SCOPE_MAP** | Static mapping from authority actions to required OAuth scopes — gates every mutating operation |
| **SurrealDB Adapter** | Custom Better Auth adapter that translates user/session CRUD to SurrealDB v2 SDK calls |
| **OAuth Scope** | Permission string (e.g. `decision:write`) carried in access tokens, checked at route handlers |
| **Client Info** | OAuth 2.0 client metadata endpoint for dynamic client registration |

## How It Works

1. **User login**: Browser redirects to GitHub OAuth → callback creates/updates `user` record via SurrealDB adapter → session cookie set
2. **Agent auth**: CLI runs `brain init` → OAuth 2.1 PKCE flow → DPoP-bound access token with scopes → stored in `~/.brain/config.json`
3. **Request authorization**: Route handler extracts session/token → checks `ACTION_SCOPE_MAP` for required scope → allows or rejects

## Where It Fits

```text
Browser Login                    CLI / MCP Agent
  |                                |
  v                                v
GitHub OAuth                   OAuth 2.1 + PKCE + DPoP
  |                                |
  v                                v
Better Auth (SurrealDB adapter)  Token with scopes
  |                                |
  v                                v
Session Cookie                 Authorization header
  |                                |
  +---------> Route Handler <------+
              |
              v
          ACTION_SCOPE_MAP check
              |
              v
          Authorized / 403
```

**Consumes**: OAuth credentials, GitHub identity, SurrealDB connection
**Produces**: Authenticated sessions, scoped access tokens, user identity records

## File Structure

```text
auth/
  adapter.ts          # Custom SurrealDB v2 adapter for Better Auth (user/session CRUD)
  client-info-route.ts # OAuth client metadata endpoint for MCP agent discovery
  config.ts           # Better Auth configuration (providers, session, adapter wiring)
  scopes.ts           # ACTION_SCOPE_MAP and scope validation helpers
```
