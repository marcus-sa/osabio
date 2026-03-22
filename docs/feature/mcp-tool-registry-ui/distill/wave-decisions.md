# DISTILL Wave Decisions -- Tool Registry UI

## Decision 1: HTTP endpoints as driving ports, not DB queries

**Decision**: All acceptance tests exercise HTTP API endpoints (the driving ports the UI calls), not internal DB queries or service functions.
**Rationale**: The existing `tests/acceptance/tool-registry/` suite tested the data layer via DB seeding. The UI tests must prove the HTTP contract works because that is what the React client consumes. Testing at a different boundary than the UI uses creates Testing Theater.
**Impact**: Walking skeleton tests call `POST /providers`, `GET /tools`, etc. DB queries are only used for Given-step preconditions and Then-step verification of side effects (credential deletion).

## Decision 2: DPoP auth for account endpoints, session auth for provider/tool endpoints

**Decision**: Account endpoints (`connect`, `list accounts`, `revoke`) use `mcpFetch` (DPoP-authenticated) because they require `X-Brain-Identity` header. Provider and tool endpoints use session `headers` because they only require workspace scope.
**Rationale**: The existing route handlers extract identity from `X-Brain-Identity` for account operations but only need workspace resolution for provider and tool operations. Tests must match the actual auth mechanism.
**Impact**: Test kit provides both `createTestUserWithMcp()` (for DPoP auth) and session `user.headers` (for workspace-scoped requests).

## Decision 3: toolEncryptionKey configured via suite options

**Decision**: The test suite passes `toolEncryptionKey` via `configOverrides` to enable credential encryption in test server.
**Rationale**: Without this key, `POST /accounts/connect` returns 500 "encryption not configured". The key must be at least 32 bytes per AES-256-GCM requirements.
**Impact**: `setupToolRegistrySuite` sets `toolEncryptionKey: "test-encryption-key-32-bytes-long!"` in suite options.

## Decision 4: UI-only acceptance criteria deferred to component tests

**Decision**: Acceptance criteria that are purely UI concerns (keyboard navigation, badge colors, client-side filtering, dialog form layout) are not tested at the HTTP acceptance level.
**Rationale**: These criteria (AC-01b, AC-01c, AC-01e, AC-02c-e, AC-02g, AC-03a, AC-03d, AC-04a-d) involve DOM rendering and user interaction that cannot be verified through API responses. They belong in component tests (React Testing Library) or E2E browser tests.
**Impact**: 8 of 45 acceptance criteria are covered by component tests instead of acceptance tests. All data-returning and mutation criteria are covered.

## Decision 5: OAuth2 tested at initiation only

**Decision**: OAuth2 acceptance tests verify the redirect URL is generated correctly (status 200 with redirect_url and state). The full redirect-callback-exchange flow is not testable in the acceptance suite.
**Rationale**: Browser redirects to external IdP cannot be simulated in the in-process server test harness. The callback endpoint can be tested separately with a mock IdP in integration tests.
**Impact**: AC-06c/d/e (callback handling) are deferred to integration tests with mock IdP.

## Decision 6: Separate test directory from existing tool-registry tests

**Decision**: Tests live in `tests/acceptance/tool-registry-ui/` (new directory), not in the existing `tests/acceptance/tool-registry/`.
**Rationale**: The existing suite tests the backend data layer (tool schema, proxy injection, credential brokerage, governance enforcement). The UI tests exercise HTTP API contracts for UI consumption. Different testing purpose = different test suite.
**Impact**: New test kit in `tool-registry-ui-test-kit.ts` composes shared fixtures but has its own domain helpers for HTTP-level operations.
