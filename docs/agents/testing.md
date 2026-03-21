## DPoP Acceptance Test Infrastructure

- All MCP endpoints require DPoP (Demonstration of Proof-of-Possession) authentication. Use `createTestUserWithMcp()` from `acceptance-test-kit.ts` — it generates a key pair, creates identity + workspace + intent records, acquires a DPoP-bound token, and returns `mcpFetch` for authenticated requests.
- **Workspace binding**: The DPoP token contains a `urn:brain:workspace` claim. The middleware (`dpop-middleware.ts:311`) extracts the workspace from the JWT claim, NOT the URL path parameter. All MCP endpoint authorization is scoped to this claim.
- **`member_of` edge required**: The DPoP middleware calls `lookupWorkspace()` which queries `SELECT in FROM member_of WHERE out = $ws LIMIT 1`. Without a `member_of` relation edge between identity and workspace, all MCP requests return 401 "Workspace not found". `createTestUserWithMcp()` creates this edge automatically.
- **Workspace mismatch pitfall**: If a test creates a workspace via the API (`POST /api/workspaces`) and then acquires a DPoP token via `createTestUserWithMcp()`, the token is bound to a *different* workspace. MCP endpoints will return 404 for resources in the API-created workspace. Fix: pass `{ workspaceId }` to `createTestUserWithMcp()` to bind the token to the pre-existing workspace, or use `user.workspaceId` for all resource creation.
- **Pattern**: Create test user first (`createTestUserWithMcp`), then create tasks/projects in `user.workspaceId`. Do NOT create a separate workspace via API unless you pass its ID to `createTestUserWithMcp`.
- **`mcpFetch` vs `mcpHeaders`**: Always use `user.mcpFetch(path, { body })` — it creates a fresh DPoP proof per request. The `mcpHeaders` property is deprecated and will fail because DPoP proofs are single-use.

## Regression Tests for Bug Fixes

- Every bug fix MUST include a regression test that fails without the fix and passes with it.
- Prefer unit tests when the fix is in pure logic. Use acceptance tests when the fix involves DB or HTTP interactions.
- Design side-effect-heavy functions with injectable dependencies (e.g. LLM calls, external APIs) so unit tests can stub them and assert on inputs/outputs without requiring the full runtime.

## Test Uniqueness

- Use `crypto.randomUUID()` for test identifiers (emails, IDs, suffixes) — never `Date.now()` alone. Concurrent test runs share the same millisecond, causing collisions.

## Testing Setup

- Install deps: `bun install`
- Run deterministic unit tests (no LLM/API calls): `bun test tests/unit/`
- Run acceptance tests: `bun test tests/acceptance/`
- Run eval suite: `bun run eval`
- Run eval watch mode: `bun run eval:watch`
- Agents must not run evals directly. Delegate eval execution to the user and ask them to run eval commands and share results.

### Deliver Phase Testing Gate

- After every `nw:deliver` step execution, run the acceptance tests affected by or introduced for the feature (`bun test tests/acceptance/<relevant-suite>`) before proceeding to the next step.
- If acceptance tests fail, fix the issue before moving on. Do NOT skip or defer failing tests.
- This applies to each individual step in the roadmap, not just the final step.

### No process.env in Application Code

- Application code must NEVER read `process.env` directly. All configuration is parsed once in `runtime/config.ts` (`loadServerConfig()`) and injected as `ServerConfig` through the dependency chain.
- Reading `process.env` at runtime creates hidden coupling, breaks testability (Bun shares one process across all test files — env mutations in one suite poison others), and makes behavior non-deterministic.
- If a behavior needs to be configurable, add a field to `ServerConfig`, wire it through dependencies, and let callers (including tests) provide it via typed config objects.
- Acceptance tests use `configOverrides?: Partial<ServerConfig>` on `AcceptanceSuiteOptions` to vary server behavior per suite — no env mutation needed.

### Acceptance Test Isolation

- Acceptance tests boot an in-process Brain server with an isolated Surreal namespace/database, apply `schema/surreal-schema.surql`, run assertions, then remove the test DB/namespace.
- Acceptance tests require a reachable SurrealDB server at `SURREAL_URL` with credentials from env.
- All test suites share `tests/acceptance/acceptance-test-kit.ts` for server boot and DB isolation; domain-specific kits (orchestrator, intent, coding-session) extend it with business-language helpers.

### Eval Requirements

- Evals call the real extraction model through existing app wiring.
- Required env: `OPENROUTER_API_KEY` and `EXTRACTION_MODEL` (set to Haiku model when needed).
- Optional env:
  - `AUTOEVAL_MODEL` for `autoevals` factuality scorer model override.
  - `EVAL_RESULTS_DIR` for evalite sqlite output.
  - `EVAL_CACHE_DIR` for extraction eval cache.

### Evalite Silent Failure Mode

- Evalite (v0.19+) silently swallows errors thrown in `beforeAll` hooks. When `beforeAll` fails, all evals show `Score: -`, `Duration: 0ms`, and no error output.
- If evals show this pattern, the cause is almost always a thrown error during setup — typically a missing env var in `setupEvalRuntime` (which calls `requireEnv` for all model IDs).
- To diagnose: check that all required env vars are set, or temporarily wrap `beforeAll` contents in try/catch with `console.error` to surface the real error.
