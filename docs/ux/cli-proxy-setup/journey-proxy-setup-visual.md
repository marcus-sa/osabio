# Journey: osabio init -> Proxy-Enabled Claude Code

```
osabio init ──> Browser OAuth ──> Token Exchange ──> Write settings ──> claude (proxied)
   [1]           [2]              [3]                 [4]               [5]
```

## Steps

| Step | Actor | Action | System Response | Emotional State |
|------|-------|--------|----------------|-----------------|
| 1 | User | Runs `osabio init` in repo | CLI detects repo, starts OAuth flow | Neutral — familiar flow |
| 2 | User | Authenticates in browser | OAuth consent page, approves scopes | Slight friction, expected |
| 3 | System | OAuth completes | Server issues long-lived proxy token alongside existing MCP tokens | Relief — "that was quick" |
| 4 | System | CLI writes `.claude/settings.local.json` | Sets `env.ANTHROPIC_BASE_URL` + `env.ANTHROPIC_CUSTOM_HEADERS` | Confidence — "it's configured" |
| 5 | User | Runs `claude` | Requests route through Osabio proxy transparently | Satisfaction — "it just works" |

## Error Paths

| Error | Handling |
|-------|----------|
| `.claude/settings.local.json` already exists | Merge `env` keys, preserve other config |
| Token expired | SessionStart hook warns user to re-run `osabio init` |
| Proxy unreachable | No fallback — fail with clear error pointing to Osabio server |
| OAuth cancelled | Skip proxy setup step, warn user proxy is not configured |

## Shared Artifacts

| Artifact | Source Step | Consumed By |
|----------|-----------|-------------|
| `proxy_token` | Step 3 (token exchange) | Step 4 (written to settings), Step 5 (sent as header) |
| `workspace_id` | Step 1 (from existing osabio init config) | Step 4 (written to headers) |
| `server_url` | Step 1 (from `~/.osabio/config.json`) | Step 4 (ANTHROPIC_BASE_URL) |
