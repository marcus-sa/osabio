# DISTILL Wave Decisions: Sandbox Agent Integration

## TD-01: Unit Tests Use Mock Adapter, Acceptance Tests Use Real SDK

**Decision**: Unit tests inject a fake `SandboxAgentAdapter` implementation -- no real SDK, no real SandboxAgent Server. Acceptance tests use the actual SandboxAgent SDK against a real SandboxAgent Server process.

**Rationale**: Hard requirement from the user. Unit tests validate pure logic (event translation, state transitions, query construction) in isolation. Acceptance tests validate the full integration stack.

**Status**: Confirmed (user directive)

---

## TD-02: Given-When-Then as Comments, Not .feature Files

**Decision**: Express BDD structure as comments or nested `describe` blocks within `bun:test` files. No Cucumber/SpecFlow/pytest-bdd.

**Rationale**: Project uses TypeScript/Bun test runner exclusively. Existing acceptance tests use `describe`/`it`/`expect` with Given-When-Then as inline comments. Introducing a separate Gherkin layer would add tooling complexity without benefit.

**Status**: Confirmed (project convention)

---

## TD-03: New Sandbox Test Kit Extends Orchestrator Test Kit

**Decision**: Create a `sandbox-test-kit.ts` in the acceptance test directory that extends the existing orchestrator-test-kit with sandbox-specific helpers (SandboxAgent Server lifecycle, sandbox adapter creation, sandbox session helpers).

**Rationale**: Follows the existing pattern where domain-specific kits extend `acceptance-test-kit.ts`. The orchestrator test kit already has workspace/task/session helpers that sandbox tests need.

**Status**: Provisional

---

## TD-04: SandboxAgent Server as External Process in Acceptance Tests

**Decision**: Acceptance tests start a real SandboxAgent Server process (the Rust binary) and connect via the SDK. The server is started in `beforeAll` and stopped in `afterAll`.

**Rationale**: The user requires acceptance tests to exercise the actual SDK against a real server. In-process mocking would defeat the purpose. The server binary must be available on the test runner.

**Status**: Provisional

---

## TD-05: Walking Skeleton Implementation Order

**Decision**: WS-1 (spawn + prompt + events) is the first test to enable. WS-2 (multi-turn) and WS-3 (persistence) follow. All other tests start skipped.

**Rationale**: WS-1 exercises the maximum number of components in the thinnest possible slice. Proving this path works gives confidence to implement the remaining scenarios.

**Status**: Provisional

---

## TD-06: R1 Scope Boundary in Tests

**Decision**: Tests explicitly cover R1 scope only. No tests for dynamic MCP endpoint, permission handler with intent authorization, cloud providers, or SurrealDB persistence driver.

**Rationale**: R1 delivers multi-turn + basic persistence with local provider and InMemorySessionPersistDriver. R2 and R3 features will get their own DISTILL wave when ready.

**Status**: Confirmed (user directive)

---

## TD-07: Error Path Coverage Target 40%+

**Decision**: Target at least 40% error/edge case scenarios across all test levels.

**Rationale**: BDD methodology mandate. Error paths are where production failures occur. Current inventory: 42% error/edge scenarios (13 of 31 total).

**Status**: Confirmed (methodology requirement)
