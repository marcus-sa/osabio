# Journey: brain init -> Proxy-Enabled Claude Code

```
brain init ──> Browser OAuth ──> Token Exchange ──> Write settings ──> claude (proxied)
   [1]           [2]              [3]                 [4]               [5]
```

## Steps

| Step | Actor | Action | System Response | Emotional State |
|------|-------|--------|----------------|-----------------|
| 1 | User | Runs `brain init` in repo | CLI detects repo, starts OAuth flow | Neutral — familiar flow |
| 2 | User | Authenticates in browser | OAuth consent page, approves scopes | Slight friction, expected |
| 3 | System | OAuth completes | Server issues long-lived proxy token alongside existing MCP tokens | Relief — "that was quick" |
| 4 | System | CLI writes `.claude/settings.local.json` | Sets `env.ANTHROPIC_BASE_URL` + `env.ANTHROPIC_CUSTOM_HEADERS` | Confidence — "it's configured" |
| 5 | User | Runs `claude` | Requests route through Brain proxy transparently | Satisfaction — "it just works" |

## Error Paths

| Error | Handling |
|-------|----------|
| `.claude/settings.local.json` already exists | Merge `env` keys, preserve other config |
| Token expired | SessionStart hook warns user to re-run `brain init` |
| Proxy unreachable | No fallback — fail with clear error pointing to Brain server |
| OAuth cancelled | Skip proxy setup step, warn user proxy is not configured |

## Shared Artifacts

| Artifact | Source Step | Consumed By |
|----------|-----------|-------------|
| `proxy_token` | Step 3 (token exchange) | Step 4 (written to settings), Step 5 (sent as header) |
| `workspace_id` | Step 1 (from existing brain init config) | Step 4 (written to headers) |
| `server_url` | Step 1 (from `~/.brain/config.json`) | Step 4 (ANTHROPIC_BASE_URL) |
