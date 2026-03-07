## Test Framework

- Runtime: `bun:test` (`describe`, `it`, `expect` from `bun:test`)
- No external test frameworks (no Jest, Vitest, Cucumber, pytest-bdd)

## Test Structure

```
tests/
  unit/                              # Deterministic, no network/DB
  smoke/                             # Requires running SurrealDB
  acceptance/                        # Driving-port-level (HTTP/SSE)
    coding-agent-orchestrator/       # Orchestrator acceptance tests
    coding-session/                  # Interactive session acceptance tests
    orchestrator-ui/                 # UI-focused acceptance tests
```

## Running Tests

- Unit: `bun test tests/unit/`
- Smoke: `bun test tests/smoke/` (requires `SURREAL_URL` + credentials)
- Acceptance: `bun test tests/acceptance/<suite>/`
- Single file: `bun test tests/unit/some-test.test.ts`

## Conventions

- File naming: `<feature>.test.ts`
- Gherkin `.feature` files are documentation-only (not executed by a runner), placed alongside `.test.ts` files
- Shared test helpers go in `*-test-kit.ts` files per suite (e.g., `orchestrator-test-kit.ts`, `coding-session-test-kit.ts`)
- Acceptance tests drive through HTTP endpoints and SSE streams only — no internal module imports
- One-at-a-time TDD: new scenarios start skipped (`it.skip`), enable one at a time as implementation progresses
- Smoke tests create isolated SurrealDB namespace/database per suite, cleaned up after

## What to Mock

- External processes (OpenCode spawn) — mock the handle, not the process
- Everything else is real internal logic — no mocking internal modules at acceptance level
- Unit tests may mock dependencies via dependency injection (function parameters)
