# Walking Skeleton — openclaw-gateway

## Skeleton Scope

The walking skeleton validates the full gateway pipeline end-to-end with minimal scope:

```
WebSocket connect → hardcoded identity → agent method → orchestrator assigns task →
token streaming via WS events → session completion → trace recorded in graph
```

## Driving Ports

| Scenario | Driving Port | Observable Outcome |
|----------|-------------|-------------------|
| WS upgrade | `GET /api/gateway` (HTTP upgrade) | Connection established, connectionId assigned |
| Agent submit | WS `req` frame → `agent` method | Response frame with `runId`, `sessionId`, `contextSummary` |
| Token streaming | WS `event` frames from server | `agent.stream` events with `seq` numbers, `assistant` stream |
| Session completion | WS `event` frame `phase: "done"` | `DoneEvent` received, session status queryable |

## Preconditions

- Brain server running with gateway enabled
- Test workspace with decisions, constraints in SurrealDB
- Hardcoded test identity with `member_of` edge and authority scopes
- Orchestrator agent spawn stubbed or real (depending on test environment)

## Implementation Order

1. **WS upgrade test** — proves Bun WebSocket handler is wired
2. **Protocol frame round-trip** — proves parse/serialize works
3. **Agent method → orchestrator** — proves method dispatch and delegation
4. **Event streaming** — proves event adapter and WS send
5. **End-to-end** — full pipeline from connect to completion

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

## OpenClaw CLI Smoke Tests

In addition to the protocol-level tests using `gateway-test-kit.ts`, the `openclaw-cli-smoke.test.ts` suite spawns the real OpenClaw CLI (`npx openclaw`) as a subprocess against Brain's gateway endpoint.

**Why**: The test kit and Brain share protocol assumptions. The CLI is an independent implementation — it catches framing bugs, `hello-ok` format mismatches, and method naming divergences that internal tests cannot.

**How**: The CLI supports `--remote-url` and `--remote-token` flags for connecting to arbitrary gateways. The `gateway call <method>` subcommand sends a single RPC and exits — perfect for test automation.

**Prerequisites**:
- `openclaw` npm package available (installed as devDependency or via `npx`)
- Brain gateway running with auth token configured
- Tests use `Bun.spawn()` to run CLI subprocesses

**What it catches that our test kit doesn't**:
- Protocol framing bugs (CLI is independent parser)
- `connect` handshake compliance (`connect.challenge` → `connect` with device identity → `hello-ok`)
- Method naming mismatches (CLI expects `sessions.*`, not `agent.*`)
- `hello-ok` payload format (missing fields cause CLI to reject connection)
