# DISTILL Wave Decisions: Evidence-Backed Intent Authorization

## D-01: Test Framework and Infrastructure

**Decision**: Use `bun:test` with inline TypeScript tests, documentation-only `.feature` files, and `intent-evidence-test-kit.ts` extending `intent-test-kit.ts`.

**Rationale**: Matches project conventions. No BDD runners (Cucumber, pytest-bdd). Gherkin files serve as living documentation alongside executable `.test.ts` files. Test kit follows the established composition pattern (shared-fixtures -> intent-test-kit -> intent-evidence-test-kit).

## D-02: Walking Skeleton Scope

**Decision**: Three walking skeletons covering the E2E evidence flow -- evidence submission + verification, soft enforcement penalty, and hard enforcement rejection.

**Rationale**: These three slices are the minimum set that proves the feature works end-to-end. Skeleton 1 proves the happy path (evidence verified). Skeleton 2 proves soft enforcement (penalty applied). Skeleton 3 proves hard enforcement (rejection before LLM). Together they demonstrate the full enforcement mode spectrum.

## D-03: Milestone Structure

**Decision**: Four milestones aligned with the DISCUSS story map releases:
1. Core Verification (US-01, US-02, US-03, US-04)
2. Fabrication Resistance (US-05, US-06, US-07)
3. Policy + Monitoring (US-10)
4. Feed + Bootstrapping (US-08, US-09)

**Rationale**: Each milestone is independently shippable. Milestones 1-2 are the core security value. Milestones 3-4 are UX and operational polish. This matches the release slicing from DISCUSS.

## D-04: Evidence Entity Creation Pattern

**Decision**: Test kit provides `createEvidenceDecision`, `createEvidenceTask`, `createEvidenceObservation` helpers that wrap shared-fixtures with evidence-oriented defaults (confirmed, completed, open).

**Rationale**: Business-language helpers make tests readable. Defaults match the most common evidence scenario (valid, live entities). Tests that need specific statuses (superseded, etc.) override via parameters.

## D-05: Driving Ports

**Decision**: Tests drive through:
- SurrealDB direct (intent creation with evidence_refs, workspace settings)
- SurrealQL EVENT -> POST /api/intents/:id/evaluate (evaluation pipeline)
- GET /api/workspaces/:ws/feed (governance feed)
- POST /api/workspaces/:ws/policies (policy creation)
- POST /api/workspaces/:ws/observer/scan (Observer trigger)

**Rationale**: These are the same driving ports used by the existing intent-node tests. Evidence verification is an internal pipeline invoked during evaluation -- it is exercised indirectly through the evaluation driving port, not directly. This enforces hexagonal boundary: we test evidence verification by observing its effects on the intent record, not by calling internal verification functions.

## D-06: Error Path Ratio

**Decision**: 12 error scenarios out of 33 total (36%). Slightly below 40% target.

**Rationale**: The verification pipeline is heavily error-path oriented by nature (non-existent refs, cross-workspace, superseded, temporal, self-referencing, timing exploits, hard rejection). The remaining scenarios are happy paths and edge cases for completeness. The ratio is acceptable given the security-critical nature of the error paths covered.

## D-07: One-at-a-Time TDD Order

**Decision**: Enable WS-1 first, then WS-2, WS-3, then M1-1 through M4-6 in order.

**Rationale**: Walking skeletons prove the E2E path exists before focused scenarios test specific rules. Within each milestone, scenarios are ordered to build on each other (schema first, then verification, then enforcement, then storage).
