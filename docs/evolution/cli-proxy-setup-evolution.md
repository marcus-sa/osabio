# Feature Evolution: CLI Proxy Setup

**Project ID:** cli-proxy-setup
**Completed:** 2026-03-16
**Branch:** marcus-sa/cli-proxy-setup

## Summary

Added Brain-authenticated LLM proxy support with CLI configuration. Developers run `brain init` and Claude Code automatically routes through Brain's proxy with policy enforcement, tracing, and context injection — no manual config needed.

## Components Delivered

### Schema
- `proxy_token` SCHEMAFULL table (migration 0049) with SHA-256 hash storage, workspace+identity binding, unique index

### Server
- **POST /api/auth/proxy-token** — Issues `brp_`-prefixed proxy tokens with 90-day TTL, revokes previous tokens on re-issuance
- **Proxy auth middleware** (`proxy-auth.ts`) — Validates X-Brain-Auth header, 5-min TTL cache, returns workspace+identity from token record
- **Dual-mode handler** — X-Brain-Auth present → server-held API key; absent → existing direct auth (backward compatible)
- **ANTHROPIC_API_KEY** config — Optional server-side key for Brain-auth requests

### CLI
- **brain init Step 7** — Requests proxy token, writes `.claude/settings.local.json` with ANTHROPIC_BASE_URL + ANTHROPIC_HEADERS, warns if not gitignored
- **Removed SessionStart/PreToolUse hooks** — Context injection now handled by the Brain LLM proxy itself, eliminating redundant CLI hooks (`brain system load-context`, `brain system pretooluse`)

## Architecture Decisions

1. **Dual-mode proxy auth** — Backward compatible; X-Brain-Auth presence determines mode
2. **Opaque tokens with SHA-256 hash** — Simple, revocable, `brp_` prefix for log identification; no JWT complexity
3. **Workspace from token, not headers** — Prevents spoofing; workspace binding is authoritative from DB record

## Test Coverage

| Suite | Tests | Status |
|-------|-------|--------|
| Unit: proxy-auth | 16 | Pass |
| Unit: proxy-dual-mode | 6 | Pass |
| Unit: cli-proxy-settings | 14 | Pass |
| Unit: cli-proxy-token-expiry | 6 | Pass |
| Unit: anthropic-api-key-config | 3 | Pass |
| Acceptance: walking skeleton | 2 | Pass |
| Acceptance: token endpoint | 4 | Pass |
| Acceptance: auth middleware | 6 | Pass |
| Acceptance: settings config | 7 | Pass |
| Acceptance: integration checkpoints | 5 | Pass |

## Files Changed

### New Files
- `schema/migrations/0049_proxy_token.surql`
- `app/src/server/proxy/proxy-token-route.ts`
- `app/src/server/proxy/proxy-token-core.ts`
- `app/src/server/proxy/proxy-auth.ts`
- `cli/proxy-settings.ts`
- `cli/token-expiry.ts`

### Modified Files
- `app/src/server/proxy/anthropic-proxy-route.ts` — Dual-mode auth branching
- `app/src/server/proxy/identity-resolver.ts` — Proxy token identity input
- `app/src/server/runtime/config.ts` — ANTHROPIC_API_KEY + optionalEnv helper
- `app/src/server/runtime/start-server.ts` — Route registration
- `cli/commands/init.ts` — Step 7: setupProxyConfig
- `cli/commands/system.ts` — Removed runLoadContext + runPreToolUse (proxy handles context injection)
- `cli/brain.ts` — Removed load-context + pretooluse subcommands
- `cli/commands/init-content.ts` — Removed SessionStart + PreToolUse hook entries
- `cli/config.ts` — proxy_token + proxy_token_expires_at fields
- `.env.example` — ANTHROPIC_API_KEY documentation

## Execution Phases

| Phase | Status |
|-------|--------|
| 1. Roadmap Creation | Approved |
| 2. Step Execution (8 steps) | All COMMIT/PASS |
| 3. L1-L4 Refactoring | Complete (3 files improved) |
| 4. Adversarial Review | Approved (2 low observations) |
| 5. Mutation Testing | Skipped (disabled in rigor) |
| 6. Integrity Verification | Passed |
