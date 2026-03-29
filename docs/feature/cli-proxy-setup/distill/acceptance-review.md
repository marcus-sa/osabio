# Acceptance Review: CLI Proxy Setup

## Coverage Assessment

### User Stories → Test Mapping

| User Story | Covered | Tests |
|------------|---------|-------|
| US-1: Proxy setup via `osabio init` | Yes | Walking skeleton (S1, S2), M1.1–M1.4, M3.1–M3.6 |
| AC: Fresh setup | Yes | M3.1 |
| AC: Merge existing settings | Yes | M3.2 |
| AC: Re-run refreshes token | Yes | M1.2, M3.3 |
| AC: Long-lived token (90d) | Yes | S1, M4.2 |
| AC: SessionStart expired token warning | Yes | M4.3–M4.5 |
| AC: Proxy validates Osabio auth | Yes | S2, M2.1–M2.6 |
| AC: Proxy rejects unauthenticated | Yes | M2.1 |
| AC: .gitignore verification | Yes | M3.4 |
| AC: No fallback to direct Anthropic | Yes | M3.6 |

### Architecture Design → Test Mapping

| Component | Covered | Tests |
|-----------|---------|-------|
| Proxy token endpoint | Yes | S1, M1.1–M1.4 |
| Proxy auth middleware | Yes | S2, M2.1–M2.6 |
| Server-side Anthropic API key | Yes | S2 (implicit via successful proxy call) |
| CLI Step 7: settings.local.json | Yes | M3.1–M3.3, M3.6 |
| SurrealDB proxy_token table | Yes | M1.1 (hash verification), M1.2 (revocation) |
| SessionStart hook enhancement | Partial | M4.3–M4.5 (logic only, not full hook integration) |
| Dual-mode proxy auth | Yes | M2.5 (backward compat), S2 (Osabio auth) |
| Workspace derivation from token | Yes | M2.6 |

### Hexagonal Boundary Compliance

All acceptance tests exercise **driving ports**, not internal components:

- **HTTP endpoints**: `POST /api/auth/proxy-token`, `POST /proxy/llm/anthropic/v1/messages`
- **Filesystem**: `.claude/settings.local.json`, `~/.osabio/config.json`
- **No mocks at acceptance level**: Real server, real DB, real (or skipped) Anthropic calls

### One-at-a-Time Implementation Strategy

Tests are organized into 4 milestones. Within each milestone, tests can be implemented independently. Across milestones:

1. **Walking skeleton** (S1, S2) — implement first, proves core flow
2. **Token endpoint** (M1) — depends on walking skeleton infrastructure
3. **Auth middleware** (M2) — depends on token endpoint for setup
4. **Settings config** (M3) — independent, pure filesystem tests
5. **Integration checkpoints** (M4) — depends on M1 + M2

## Handoff to DELIVER

The acceptance test suite is ready for `nw:deliver`. Implementation should:

1. Start with the `proxy_token` SurrealDB migration
2. Implement `POST /api/auth/proxy-token` until walking skeleton S1 passes
3. Add proxy auth middleware until walking skeleton S2 passes
4. Proceed through milestones M1–M4, running tests after each step
5. Finally implement the CLI `setupProxyConfig()` function (M3 tests provide the spec)
