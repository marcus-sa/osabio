# DISTILL Decisions — mcp-server-auth

## Key Decisions

- [D1] MSW simulates external MCP servers and OAuth auth servers — no real network calls in acceptance tests (see: test-scenarios.md §MSW Strategy)
- [D2] Walking skeleton covers static headers only (4 scenarios enabled) — OAuth discovery/authorization are milestone 2-3 (all @skip) (see: walking-skeleton.md)
- [D3] Test numbering continues from existing tool-registry suite: 11-14 (see: test-scenarios.md)
- [D4] Credential resolver tests are internal-boundary acceptance tests — they test the dispatch logic with real DB + encryption, not HTTP endpoints (see: 14-credential-resolver.test.ts)
- [D5] MSW mock token endpoint validates code + code_verifier presence to verify PKCE compliance (see: mcp-server-auth-test-kit.ts)

## Test Coverage Summary

- Total scenarios: 21
- Walking skeleton scenarios: 4 (ENABLED)
- Milestone 1 (Static Header Management): 4 scenarios (@skip)
- Milestone 2 (OAuth Discovery): 5 scenarios (@skip)
- Milestone 3 (OAuth Authorization): 6 scenarios (@skip)
- Milestone 4 (Credential Resolver): 4 scenarios (@skip)
- Test framework: bun:test (existing)
- Integration approach: real in-process server + isolated SurrealDB + MSW for external services

## Constraints Established

- MSW handlers must be started/stopped per test to avoid cross-contamination
- Token endpoint must validate code_verifier to confirm PKCE is used
- Encrypted values must be asserted as NOT containing plaintext (negative assertion)

## Upstream Issues

- None — DISCUSS acceptance criteria and DESIGN architecture are consistent
