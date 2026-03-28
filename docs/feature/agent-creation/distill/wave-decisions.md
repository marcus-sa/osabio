# Wave Decisions: Agent Management (DISTILL)

## Test Design Decisions

### TD-1: Bun test runner with GWT comments, not Gherkin files

**Status**: Decided

Tests use `bun:test` with `describe/it/expect` and Given-When-Then comments inside each `it()` block. Gherkin `.feature` files are not used as executable specs.

**Rationale**: Project convention (per `tests/AGENTS.md`) specifies that `.feature` files are documentation-only. All existing acceptance tests follow the `describe/it` pattern with GWT comments. The test framework is Bun's test runner, not Cucumber/pytest-bdd.

### TD-2: Session-authenticated HTTP requests for all agent endpoints

**Status**: Decided

Agent CRUD endpoints are browser-facing routes authenticated via Better Auth session cookies. Tests use `createTestUser()` for signup and pass session cookies on all requests.

**Rationale**: Per architecture design (DD-3), agent endpoints live under `/api/workspaces/:workspaceId/agents` and use session auth. DPoP/MCP auth is not used for these endpoints. This matches the existing pattern in learning, policy, and objective test suites.

### TD-3: Walking skeletons enabled, R2/R3 scenarios skipped

**Status**: Decided

All 4 walking skeleton tests and 19 focused R1 scenarios are enabled (not skipped). R2 (sandbox creation) and R3 (operational dashboard) scenarios use `describe.skip()` blocks.

**Rationale**: One-at-a-time TDD principle. Walking skeleton tests define "done" for R1. The crafter enables and implements them sequentially. R2/R3 tests are written now as specifications but skipped until their implementation phase.

### TD-4: Workspace creation via HTTP for session edge wiring

**Status**: Decided

Tests use `createWorkspaceViaHttp()` (not `createWorkspaceDirectly()`) to create workspaces, which wires person-identity-member_of edges through the server. This ensures session-authenticated requests resolve workspace membership correctly.

**Rationale**: Agent endpoints are browser-facing routes that resolve identity from the Better Auth session. `createWorkspaceViaHttp()` creates the full edge chain (person -> identity -> member_of -> workspace) that `resolveIdentityFromSession()` requires.

### TD-5: Brain agents seeded directly for test isolation

**Status**: Decided

Brain agents are seeded via `seedBrainAgent()` helper (direct DB insert), not through the identity bootstrap that runs on workspace creation. This gives tests explicit control over which brain agents exist.

**Rationale**: The identity bootstrap creates all 6 brain agents during workspace creation. Some tests need a specific set of brain agents. Direct seeding is more deterministic and faster than filtering the bootstrap output.

### TD-6: Per-test workspace isolation

**Status**: Decided

Each `it()` block creates its own workspace and user. No shared `let` variables at `describe` scope.

**Rationale**: Tests run with `--concurrent`. Shared mutable state at describe scope causes cross-test contamination. Per-test isolation is the project convention (per `tests/AGENTS.md`).

## Mandate Compliance Evidence

### CM-A: Hexagonal Boundary Enforcement

All test files import exclusively from `agents-test-kit.ts`, which provides HTTP helper functions that invoke driving ports:
- `listAgentsViaHttp()` -> `GET /api/workspaces/:ws/agents`
- `createAgentViaHttp()` -> `POST /api/workspaces/:ws/agents`
- `getAgentDetailViaHttp()` -> `GET /api/workspaces/:ws/agents/:id`
- `deleteAgentViaHttp()` -> `DELETE /api/workspaces/:ws/agents/:id`
- `updateAgentViaHttp()` -> `PUT /api/workspaces/:ws/agents/:id`

Direct SurrealDB queries are used only for:
- Given-step data seeding (`seedBrainAgent`)
- Then-step verification (`agentExistsInDb`, `getAuthorityEdgesForIdentity`)

Zero internal module imports (no `agents/routes.ts`, no `agents/queries.ts`).

### CM-B: Business Language Purity

Scenario names and GWT comments use business domain language exclusively:
- "admin registers an external agent" (not "POST to /api/agents returns 201")
- "authority scopes default to 'propose'" (not "authorized_to edges have permission='propose'")
- "all related records are removed" (not "DELETE cascades through identity_agent edges")

Technical terms appear only in test kit helper implementations (HTTP methods, RecordId), never in test scenario descriptions.

### CM-C: Walking Skeleton + Focused Scenario Counts

- Walking skeletons: 4 (WS-1 through WS-4)
- Focused scenarios (R1): 19 (EC-1 through EC-19)
- Total R1: 23 scenarios
- Error ratio (R1): 43% (10/23)

## Handoff Checklist

- [x] Walking skeleton tests written and enabled
- [x] Focused scenarios cover all R1 stories (US-01 through US-04)
- [x] Error path ratio >= 40% for R1
- [x] R2/R3 scenarios written and skipped
- [x] Test kit provides business-language helpers
- [x] All tests invoke through driving ports only
- [x] Per-test workspace isolation (concurrent-safe)
- [x] Mandate compliance evidence documented
