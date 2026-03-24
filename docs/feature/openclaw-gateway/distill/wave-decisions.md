# DISTILL Decisions — openclaw-gateway

## Key Decisions

- [D1] **Test framework: Bun test runner + custom gateway-test-kit** — matches project convention; no external BDD framework. Given-When-Then expressed as comments in test bodies. (see: `gateway-test-kit.ts`)
- [D2] **Integration approach: Real services** — in-process Brain server with isolated SurrealDB namespace per suite, consistent with existing acceptance test infrastructure. (see: `acceptance-test-kit.ts`)
- [D3] **WebSocket test client**: `connectGateway()` helper wraps Bun's built-in WebSocket client with protocol-aware request/response matching and event collection. (see: `gateway-test-kit.ts`)
- [D4] **Walking skeleton first**: 5 active scenarios (WS-1 through WS-5) exercise the full pipeline; 31 scenarios @skip for R1-R3 + CLI smoke. (see: `test-scenarios.md`)
- [D5] **No infrastructure tests**: functional acceptance tests only (Decision 4 = No).
- [D6] **OpenClaw CLI smoke tests**: Separate test suite spawns the real `openclaw` CLI against Brain's gateway to catch protocol compliance issues the internal test kit cannot detect. (see: `openclaw-cli-smoke.test.ts`)
- [D7] **Method names aligned with real protocol**: Tests use `sessions.*` namespace (not `agent.history`), `tools.catalog`, `config.get`, and real `connect` handshake format with `hello-ok` response. (see: architecture-design.md § Auth Architecture)

## Test Coverage Summary

- **Total scenarios**: 36
- **Walking skeleton scenarios**: 5 (active)
- **Release 1 (Auth & Protocol)**: 9 (@skip)
- **Release 2 (Execution)**: 12 (@skip)
- **Release 3 (Governance)**: 6 (@skip)
- **OpenClaw CLI smoke**: 4 (@skip)
- **Test framework**: Bun test runner (`bun:test`)
- **Integration approach**: Real services (in-process server + isolated DB)

## Test Files

```
tests/acceptance/gateway/
  gateway-test-kit.ts              # WS client, frame types, helpers
  walking-skeleton.test.ts         # WS-1 to WS-5 (active)
  r1-auth-protocol.test.ts         # R1-1 to R1-9 (@skip)
  r2-execution.test.ts             # R2-1 to R2-12 (@skip)
  r3-governance.test.ts            # R3-1 to R3-6 (@skip)
  openclaw-cli-smoke.test.ts       # CLI-1 to CLI-4 (@skip)
```

## Constraints Established

- All tests drive through the WebSocket port at `/api/gateway` — no internal module imports
- Walking skeleton uses hardcoded identity (no Ed25519 auth)
- Event collection uses predicate-based collectors with timeouts (not fixed sleeps)
- Each test suite creates its own isolated DB namespace via `setupAcceptanceSuite()`
- CLI smoke tests require `openclaw` npm package and spawn subprocesses via `Bun.spawn()`

## Upstream Issues

- **AC-1.1 updated**: Changed from two-step `connect` + `connect.verify` to single-frame `connect` with device identity inline, matching real Gateway Protocol v3 spec.
- **AC-2.3 expanded**: Added `sessions.list` alongside `agent.status`/`agent.wait` to match real protocol's `sessions.*` namespace.
- **AC-2.4 renamed**: `agent.history` → `sessions.history` to match real protocol.
- **AC-2.5 added**: New `tools.catalog` acceptance criteria for MCP tool registry query.
- **AC-2.6 added**: New `method_not_supported` criteria for graceful handling of unimplemented methods.
- **R1-2 added**: Explicit test that `connect.challenge` is sent immediately on WS open (real protocol behavior).
