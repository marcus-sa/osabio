# Walking Skeleton: CLI Proxy Setup

## Strategy

The walking skeleton proves the thinnest E2E slice of the proxy auth feature: **issuing a token and using it to make a proxied LLM call**.

This validates:
1. The `POST /api/auth/proxy-token` endpoint exists and issues tokens
2. The proxy middleware accepts `X-Osabio-Auth` and forwards using server-held API key
3. The response is identical to a direct Anthropic call

## Implementation Order

```
Skeleton 1: Token issuance
  └── POST /api/auth/proxy-token returns osp_ token with 90-day TTL
      Files: proxy-token-route.ts, proxy_token schema migration

Skeleton 2: Osabio-authenticated proxy request
  └── X-Osabio-Auth token → proxy validates → server API key injected → Anthropic call
      Files: proxy-auth.ts, anthropic-proxy-route.ts (dual-mode), config.ts (ANTHROPIC_API_KEY)
```

## Skeleton 1 → Skeleton 2 Dependency

Skeleton 2 depends on Skeleton 1's token issuance. Both must pass before proceeding to milestones.

## Required Infrastructure

| Component | Purpose |
|-----------|---------|
| `proxy_token` SurrealDB table | Store hashed tokens with workspace+identity binding |
| `ANTHROPIC_API_KEY` env var | Server-held key for Osabio-auth requests |
| `POST /api/auth/proxy-token` route | Issue tokens (new) |
| Proxy auth middleware | Validate `X-Osabio-Auth` header (new) |
| Dual-mode handler in `anthropic-proxy-route.ts` | Branch on auth mode (modified) |

## Definition of Done

- [ ] Skeleton 1 passes: token issued with `osp_` prefix and 90-day TTL
- [ ] Skeleton 2 passes: Osabio-auth request returns Anthropic model response
- [ ] No existing proxy tests broken (backward compatibility)
