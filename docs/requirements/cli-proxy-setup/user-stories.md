# User Stories: Osabio CLI Proxy Setup

## US-1: Proxy Setup via `osabio init`

> As a developer using Osabio, when I run `osabio init`, I want the CLI to configure `.claude/settings.local.json` with LLM proxy settings, so that Claude Code routes through Osabio automatically.

**Job trace**: Primary Job — "When I set up Osabio in a repo, I want Claude Code to automatically route through Osabio's LLM proxy..."

### Scope

- Add Step 7 to `osabio init`: "Proxy Configuration"
- Server issues a long-lived proxy token during the existing OAuth flow (or via a new endpoint post-auth)
- CLI writes `.claude/settings.local.json` with `env.ANTHROPIC_BASE_URL` and `env.ANTHROPIC_CUSTOM_HEADERS`
- CLI verifies `.claude/settings.local.json` is in `.gitignore`
- Proxy validates new Osabio auth headers (`Authorization: Bearer <proxy_token>`, `X-Osabio-Workspace`)
- No fallback to direct Anthropic — fail clearly if proxy is unreachable

### Implementation Notes

- The proxy currently uses `x-api-key` / `authorization` headers for the upstream Anthropic API key. Osabio auth needs separate headers.
- The server needs a new endpoint (e.g., `POST /api/auth/proxy-token`) to issue long-lived tokens scoped to a workspace.
- Token should have a long TTL (e.g., 90 days) and be refreshable by re-running `osabio init`.
