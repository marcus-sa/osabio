# Test Scenarios: CLI Proxy Setup

## Milestones and Implementation Order

### Walking Skeleton (implement first)

| # | Scenario | Driving Port | Verifies |
|---|----------|-------------|----------|
| S1 | Proxy token issuance | `POST /api/auth/proxy-token` | Server issues `osp_`-prefixed token with 90-day TTL |
| S2 | Osabio-authenticated proxy request | `POST /proxy/llm/anthropic/v1/messages` | X-Osabio-Auth token validates, server API key used |

### Milestone 1: Proxy Token Endpoint

| # | Scenario | Driving Port | Verifies |
|---|----------|-------------|----------|
| M1.1 | Token stored as SHA-256 hash | `POST /api/auth/proxy-token` + DB query | Plaintext never persisted |
| M1.2 | Re-issuance revokes previous tokens | `POST /api/auth/proxy-token` x2 | Only one active token per identity+workspace |
| M1.3 | Rejects missing auth | `POST /api/auth/proxy-token` | 401 without OAuth access token |
| M1.4 | Rejects unauthorized workspace | `POST /api/auth/proxy-token` | 403 for non-member workspace |

### Milestone 2: Proxy Auth Middleware

| # | Scenario | Driving Port | Verifies |
|---|----------|-------------|----------|
| M2.1 | Rejects unauthenticated | `POST /proxy/llm/anthropic/...` | 401 with no auth headers at all |
| M2.2 | Rejects fabricated token | `POST /proxy/llm/anthropic/...` | 401 for unknown token |
| M2.3 | Rejects expired token | `POST /proxy/llm/anthropic/...` | 401 for expired DB record |
| M2.4 | Rejects revoked token | `POST /proxy/llm/anthropic/...` | 401 after re-issuance |
| M2.5 | Backward compat (x-api-key) | `POST /proxy/llm/anthropic/...` | Direct auth still works |
| M2.6 | Workspace from token, not header | `POST /proxy/llm/anthropic/...` | Spoofed X-Osabio-Workspace ignored |

### Milestone 3: CLI Settings Configuration

| # | Scenario | Driving Port | Verifies |
|---|----------|-------------|----------|
| M3.1 | Fresh setup | `setupProxyConfig()` | Creates settings.local.json with correct env |
| M3.2 | Merge with existing | `setupProxyConfig()` | Preserves non-Brain env vars and non-env keys |
| M3.3 | Re-run updates token | `setupProxyConfig()` | Token replaced, everything else preserved |
| M3.4 | .gitignore detection | `isGitignored()` | Warns when settings.local.json not gitignored |
| M3.5 | Config.json storage | `~/.osabio/config.json` write | proxy_token + expires_at stored alongside existing |
| M3.6 | No fallback URL | `setupProxyConfig()` | Base URL always points to Osabio proxy |

### Milestone 4: Integration Checkpoints

| # | Scenario | Driving Port | Verifies |
|---|----------|-------------|----------|
| M4.1 | Trace attribution via Osabio auth | Proxy + DB query | Trace in correct workspace |
| M4.2 | 90-day TTL verification | `POST /api/auth/proxy-token` | Token expires ~90 days out |
| M4.3 | Expiry detection (< 7 days) | Config check logic | Flags tokens needing refresh |
| M4.4 | No false expiry alarm (> 7 days) | Config check logic | Does not flag healthy tokens |
| M4.5 | Already-expired detection | Config check logic | Detects past-due tokens |

## Coverage Matrix (User Stories → Tests)

| Acceptance Criterion | Test File | Scenario(s) |
|---------------------|-----------|-------------|
| Fresh setup creates settings.local.json | `cli-proxy-settings-config.test.ts` | M3.1 |
| Existing settings merged | `cli-proxy-settings-config.test.ts` | M3.2 |
| Re-run refreshes token | `cli-proxy-token-endpoint.test.ts` + `settings-config` | M1.2, M3.3 |
| Token has 90-day TTL | `cli-proxy-integration-checkpoints.test.ts` | M4.2 |
| SessionStart detects expired token | `cli-proxy-integration-checkpoints.test.ts` | M4.3, M4.4, M4.5 |
| Proxy validates Osabio auth | `cli-proxy-auth-middleware.test.ts` | M2.1–M2.6 |
| Proxy rejects unauthenticated | `cli-proxy-auth-middleware.test.ts` | M2.1 |
| .gitignore verification | `cli-proxy-settings-config.test.ts` | M3.4 |
| No fallback to direct Anthropic | `cli-proxy-settings-config.test.ts` | M3.6 |

## Test Infrastructure Notes

- **Server tests** (walking skeleton, M1, M2, M4): Use `setupAcceptanceSuite()` for in-process server + isolated DB
- **CLI config tests** (M3): Use temp directories, no server needed — pure filesystem assertions
- **Real Anthropic calls**: Walking skeleton S2, M2.5 backward compat, M4.1 trace attribution require `OPENROUTER_API_KEY` or `ANTHROPIC_API_KEY` + `ANTHROPIC_API_KEY` (server-side)
- **Test isolation**: Each test creates unique workspace/identity IDs via `crypto.randomUUID()`
