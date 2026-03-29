## Test Framework

- Runtime: `bun:test` (`describe`, `it`, `expect` from `bun:test`)
- No external test frameworks (no Jest, Vitest, Cucumber, pytest-bdd)

## Test Structure

```
tests/
  unit/                              # Deterministic, no network/DB
  acceptance/                        # Requires running SurrealDB, in-process server
    acceptance-test-kit.ts           # Shared infrastructure (server boot, DB isolation, auth)
    auth/                            # Authentication & authorization tests
    chat/                            # Chat pipeline, onboarding, subagent tests
    extraction/                      # Extraction quality, pipeline, description tests
    graph/                           # Graph relationships, work items, branch tests
    workspace/                       # Workspace setup, webhooks, logging tests
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
- Single file: `bun test tests/acceptance/chat/phase1.test.ts`

## CI Sharding

Each subdirectory under `tests/acceptance/` runs as a separate CI matrix job (see `.github/scripts/collect-acceptance-matrix.ts`). When adding new acceptance tests, place them in the appropriate existing directory or create a new one — the matrix auto-discovers directories.

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
- Required env: `OPENROUTER_API_KEY`, `EXTRACTION_MODEL`, `EMBEDDING_MODEL`, `EMBEDDING_DIMENSION`.
- Fake model stubs (`{} as any`, `undefined as any`) break fire-and-forget description triggers when entities accumulate >1 description entry — the Vercel AI SDK requires `specificationVersion` on model objects.

## Concurrent Test Isolation

- Acceptance tests run with `--concurrent`, so all `it()` blocks in a `describe` execute in parallel.
- NEVER use shared `let` variables at `describe` scope for per-test state (e.g. `user`, `workspace`). Concurrent tests overwrite the shared variable, causing cross-test contamination (wrong workspace ID, wrong auth context).
- Always declare per-test state as `const` inside each `it()` block.

## Shared Fixtures — No Duplicate Entity Helpers

- `tests/acceptance/shared-fixtures.ts` is the single source of truth for creating test entities (workspaces, identities, intents, tasks, decisions, observations, proxy tokens).
- Do NOT redefine `createTestUser`, `createWorkspaceDirectly`, `createWorkspaceViaHttp`, `createTaskDirectly`, or similar entity-creation helpers inside individual test files. Import from `shared-fixtures.ts` instead.
- If `shared-fixtures.ts` lacks a helper you need, add it there — not inline in the test file. Domain-specific test kits (e.g. `orchestrator-test-kit.ts`) compose shared fixtures, they don't reimplement them.
- **Workspace creation — choose the right helper:**
  - `createWorkspaceDirectly()` — direct SurrealDB insert. Use for tests that don't go through session-authenticated HTTP routes, or when you only need the workspace record in the DB.
  - `createWorkspaceViaHttp()` — HTTP `POST /api/workspaces`. Use when tests exercise routes that validate workspace membership through the Better Auth session (e.g. orchestrator routes). This wires person→identity→member_of edges automatically.
- **Task creation:** Use `createTaskDirectly()` from shared fixtures. Do NOT write inline `CREATE task` queries in test files.

## What to Mock

- External processes (OpenCode spawn) — mock the handle, not the process
- Everything else is real internal logic — no mocking internal modules at acceptance level
- Unit tests may mock dependencies via dependency injection (function parameters)

## MSW (Mock Service Worker) for External API Mocking

- Use MSW (`msw/node`) to intercept outbound HTTP requests (e.g. proxy → Anthropic API) at the network level. No code changes needed in production — MSW intercepts `fetch` globally.
- Import from `msw`: `http`, `HttpResponse` for handlers; `setupServer` from `msw/node` for Node/Bun.
- Pattern: create a response queue, each intercepted request consumes the next response. After exhaustion, return a default.
- Lifecycle: `server.listen({ onUnhandledRequest: "bypass" })` in `beforeAll`, `server.close()` in `afterAll`. Use `"bypass"` to let non-mocked requests (SurrealDB, local server) pass through.
- Reset between tests: call a `reset()` helper to clear the call counter and configure new responses per test scenario.
- **One MSW server per module, not per test.** MSW patches `globalThis.fetch` on `server.listen()`. Creating separate `setupServer()` instances per `it()` or per `describe()` causes "fetch already patched" errors under `--concurrent`. Instead, create a single module-level MSW server, call `server.listen()` in `beforeAll`, swap handlers per test with `server.resetHandlers(...newHandlers)` or `server.use(...)`, and `server.close()` in `afterAll`.
- **Never share mutable MSW response queues across concurrent tests.** A shared `callIndex` + response array (e.g. `mockAnthropic.reset([...])`) corrupts under `--concurrent` — one test's `reset()` overwrites another's queue mid-flight. Instead, use a per-test response registry keyed by a unique test identifier (e.g. `metadata.user_id`). Each test calls `register(testId, responses)` and passes `testId` in the request body. The MSW handler reads the identifier to route to the correct queue. See `createMockAnthropicMsw` in `tool-registry-ui-test-kit.ts` for the reference implementation.
- **Never call `resetHandlers()` in `finally` blocks under `--concurrent`.** `resetHandlers()` removes ALL runtime handlers (from all tests), not just the current test's. If tests use unique mock domains, handlers don't interfere — skip `resetHandlers()` entirely.
- See `tool-registry-ui-test-kit.ts` → `createMockAnthropicMsw()` for the reference implementation.

## Mock MCP Client Factory

- For tests that exercise MCP server discovery or tool execution, inject a mock `McpClientFactory` via `setupToolRegistrySuite(name, { mcpClientFactory })`.
- The mock factory (`createMockMcpClientFactory`) returns configurable tools from `listTools` and dispatches `callTool` to a provided handler function.
- `AcceptanceSuiteOptions.mcpClientFactoryOverride` wires the mock into `ServerDependencies` at server boot. Tests that don't need MCP mocks can omit it — a real `McpClientFactory` is used by default.

## `mock.module` Must Preserve Full Export Surface

- Bun's `mock.module` replaces the entire module for all test files sharing the same worker. A partial mock (only exporting the overridden function) strips every other export, causing `SyntaxError: Export named '...' not found` in concurrent test files that import from the same module.
- Always capture the real module **before** mocking, then spread its exports:
  ```ts
  const realModule = await import("../../path/to/module");
  mock.module("../../path/to/module", () => ({
    ...realModule,
    targetFunction: mockFn,
  }));
  ```

## Better Auth Session in Tests

- Browser-facing routes (tool-registry, policy, etc.) resolve identity from the Better Auth session, NOT from headers. Tests must provide valid session cookies.
- `createTestUser()` signs up via `/api/auth/sign-up/email` and returns `{ headers: { Cookie }, personId }`. The `personId` is the Better Auth `person` record ID.
- `createTestUserWithMcp()` extends this by creating an `identity` record, `member_of` edge (workspace), and `identity_person` edge (person→identity linkage). The `identity_person` edge is required for `resolveIdentityFromSession()` to resolve the session to an identity.
- **Do NOT bypass session auth with header fallbacks** (e.g. `X-Osabio-Identity`). Header-based identity is for MCP/CLI clients authenticated via DPoP or proxy tokens only. Adding header fallbacks to session-based routes creates an auth bypass vulnerability.
- Sessions are created by signing up via `POST /api/auth/sign-up/email` through the in-process server. The response `Set-Cookie` headers are captured and passed as `{ Cookie: ... }` on subsequent requests. No test utils plugin or direct DB session seeding — the full Better Auth flow runs for every test user.
