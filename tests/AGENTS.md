## Test Framework

- Runtime: `bun:test` (`describe`, `it`, `expect` from `bun:test`)
- No external test frameworks (no Jest, Vitest, Cucumber, pytest-bdd)

## Test Structure

```
tests/
  unit/                              # Deterministic, no network/DB
  acceptance/                        # Requires running SurrealDB, in-process server
    acceptance-test-kit.ts           # Shared infrastructure (server boot, DB isolation, auth)
    core/                            # Core platform acceptance tests
    task-status-ownership/           # Task status transition tests
    unified-identity/                # Identity model tests
    coding-agent-orchestrator/       # Orchestrator acceptance tests
    coding-session/                  # Interactive session acceptance tests
    intent-node/                     # Intent authorization pipeline tests
    orchestrator-ui/                 # UI-focused acceptance tests
```

## Running Tests

- Unit: `bun test tests/unit/`
- All acceptance: `bun test tests/acceptance/` (requires `SURREAL_URL` + credentials)
- Acceptance suite: `bun test tests/acceptance/<suite>/`
- Single file: `bun test tests/acceptance/core/phase1.test.ts`

## Conventions

- File naming: `<feature>.test.ts`
- Gherkin `.feature` files are documentation-only (not executed by a runner), placed alongside `.test.ts` files
- Shared test helpers go in `*-test-kit.ts` files per suite (e.g., `orchestrator-test-kit.ts`, `coding-session-test-kit.ts`)
- All acceptance test kits extend `acceptance-test-kit.ts` which provides in-process server boot with isolated SurrealDB namespace
- Acceptance tests drive through HTTP endpoints and SSE streams only — no internal module imports
- One-at-a-time TDD: new scenarios start skipped (`it.skip`), enable one at a time as implementation progresses
- Each test suite creates an isolated SurrealDB namespace/database, cleaned up after

## Test AI Dependencies

- Standalone acceptance tests that need AI models (extraction, embedding) MUST import `testAI` from `./acceptance-test-kit` — never create ad-hoc OpenRouter instances or use `{} as any` stubs.
- `testAI` exports: `openrouter`, `extractionModel`, `extractionModelId`, `embeddingModel`, `embeddingDimension`.
- All env vars are validated via `requireTestEnv` (fail-fast, no defaults).
- Required env: `OPENROUTER_API_KEY`, `EXTRACTION_MODEL`, `OPENROUTER_EMBEDDING_MODEL`, `EMBEDDING_DIMENSION`.
- Fake model stubs (`{} as any`, `undefined as any`) break fire-and-forget description triggers when entities accumulate >1 description entry — the Vercel AI SDK requires `specificationVersion` on model objects.

## What to Mock

- External processes (OpenCode spawn) — mock the handle, not the process
- Everything else is real internal logic — no mocking internal modules at acceptance level
- Unit tests may mock dependencies via dependency injection (function parameters)
