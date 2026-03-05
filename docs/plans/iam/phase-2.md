# IAM Phase 2: Pre-Early Access

**Goal:** Proper OAuth 2.1 for agents, multi-source identity, configurable authority.

**Status:** Not started. Depends on Phase 1 completion.

## OAuth 2.1 for MCP Authentication

Replace API keys with proper OAuth flow. The MCP spec has standardized on OAuth 2.1 for agent authentication.

**Why OAuth over API keys:**

- **Scoped access** — tokens carry scopes that map to authority actions. API keys are binary.
- **Token lifecycle** — access tokens expire, refresh tokens rotate. Leaked keys are valid until manually revoked.
- **User consent** — consent screen shows exactly what permissions the agent requests.
- **Dynamic Client Registration (DCR)** — agents self-register, no manual key provisioning.
- **Revocability** — revoke any agent individually without affecting others.

**Implementation options:**

- **Better Auth + OAuth Provider plugin (recommended)** — TypeScript-native, explicit MCP support. Includes DCR, PKCE, consent flow, JWT/JWKS, token introspection/revocation, `/.well-known` endpoint. Plugs into existing SurrealDB adapter.
- **Ory Hydra** — self-hosted OAuth 2.1/OIDC. Has `@ory/mcp-oauth-provider`. More infrastructure.
- **Stytch Connected Apps** — managed. Good for SaaS.

### MCP OAuth Flow

```
1. brain init → opens browser → user authenticates
2. Platform's OAuth server issues:
   - client_id for this agent installation (via DCR)
   - access_token with scopes matching authority scope
   - refresh_token for long-running sessions
3. Tokens stored in ~/.brain/config.json (encrypted)
4. On each MCP request:
   - Agent sends Authorization: Bearer <access_token>
   - MCP server validates token signature + expiry + scopes
   - If expired → refresh_token → new access_token
   - If refresh expired → re-authenticate
```

### OAuth Scopes → Authority Scope Mapping

| OAuth Scope | Authority Action | Default for code-agent |
|-------------|-----------------|----------------------|
| `graph:read` | All Tier 1 read tools | granted |
| `graph:reason` | resolve_decision, check_constraints | granted |
| `decision:create_provisional` | create_decision (provisional only) | granted |
| `decision:confirm` | confirm_decision (interactive only) | granted |
| `task:create` | create_task, create_subtask | granted |
| `task:update` | update_task_status, complete_task | granted |
| `observation:create` | log_observation | granted |
| `question:create` | ask_question | granted |
| `session:write` | session_start, session_end | granted |

### Schema Additions

```sql
-- OAuth clients (registered agents)
DEFINE TABLE oauth_client SCHEMAFULL;
DEFINE FIELD client_id ON oauth_client TYPE string;
DEFINE FIELD client_secret_hash ON oauth_client TYPE option<string>;
DEFINE FIELD workspace ON oauth_client TYPE record<workspace>;
DEFINE FIELD agent_type ON oauth_client TYPE string;
DEFINE FIELD registered_by ON oauth_client TYPE record<person>;
DEFINE FIELD registered_at ON oauth_client TYPE datetime;
DEFINE FIELD scopes ON oauth_client TYPE array<string>;
DEFINE FIELD revoked ON oauth_client TYPE bool DEFAULT false;
DEFINE FIELD label ON oauth_client TYPE option<string>;
DEFINE FIELD redirect_uris ON oauth_client TYPE array<string>;

-- Active tokens (for revocation tracking)
DEFINE TABLE oauth_token SCHEMAFULL;
DEFINE FIELD token_hash ON oauth_token TYPE string;
DEFINE FIELD client ON oauth_token TYPE record<oauth_client>;
DEFINE FIELD workspace ON oauth_token TYPE record<workspace>;
DEFINE FIELD person ON oauth_token TYPE record<person>;
DEFINE FIELD scopes ON oauth_token TYPE array<string>;
DEFINE FIELD issued_at ON oauth_token TYPE datetime;
DEFINE FIELD expires_at ON oauth_token TYPE datetime;
DEFINE FIELD revoked ON oauth_token TYPE bool DEFAULT false;
```

## User-Local Agent Auth (`brain init`)

```
$ brain init
→ Opens browser
→ You log in to the platform (your credentials)
→ Consent screen: "Claude Code wants access to your workspace:
   ✓ Read project context
   ✓ Create provisional decisions
   ✓ Confirm decisions (interactive only — when you answer in terminal)
   ✓ Create tasks and subtasks
   ✓ Log observations
   ✓ Ask questions"
→ You approve
→ Token issued:
   {
     sub: "person:marcus",
     client: "claude-code:macbook",
     scopes: ["graph:read", "graph:reason", "decision:create_provisional",
              "decision:confirm_interactive",
              "task:create", "task:update", "observation:create",
              "question:create", "session:write"],
     workspace: "ws:xyz"
   }
→ Stored in ~/.brain/config.json (encrypted)
```

**Key properties:**

- Token tied to Person node. Every write attributed: "Marcus (via Claude Code) created this provisional decision."
- **Interactive vs autonomous matters.** Agent surfaces question → you answer → `human_present: true` → confirmed. Agent decides autonomously → `human_present: false` → provisional.
- Token lifecycle: short-lived access + refresh token. Refresh expires after 30 days inactivity → re-authenticate.
- Multiple tools, same person: Cursor gets its own `brain init` + client registration, same Person identity.

## Authority Scope Configuration UI

Human can adjust per-agent-type permissions in workspace settings. Approval/rejection rate tracking in feed.

**How scopes evolve:** Human starts restrictive. As trust builds (agent makes good provisional decisions that human consistently approves), human loosens scopes — `provisional` → `auto`. Feed tracks rates per agent per action.

Architect agent can optionally confirm decisions when human enables `decision:confirm` scope.

## Multi-Source Identity Resolution

### Slack Identity Resolution

```
1. Slack bot installed → gets workspace member list
2. For each Slack user:
   a. Email match against existing Person nodes → auto-link
   b. Display name match → surface suggestion
   c. No match → store as unlinked, create Person only if human approves
3. On each Slack message extraction:
   a. Resolve Slack user ID → Person (if linked)
   b. If unlinked → unresolved reference, continue suggesting
```

### Google Workspace OAuth

Calendar invite attendees resolved to Person nodes via email match.

### Display Name Fuzzy Match

```
Person.name ~= display_name (fuzzy, normalized)
→ Candidate match. Don't auto-resolve — surface as suggestion:
  "GitHub user 'marcus-dk' might be Marcus W. Link them?"
```

**Why no auto-creation:** False merges are worse than missing links. Manual linking via suggestion is cheap; fixing a bad merge is expensive.

## Connected Agent Management

Human can view and revoke connected agents in workspace settings. Each tool (Claude Code on macbook, Cursor on work laptop) shown as separate client with independent revocation.
