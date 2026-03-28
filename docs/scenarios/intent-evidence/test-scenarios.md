# Test Scenario Inventory: Evidence-Backed Intent Authorization

## Summary

| Category | Count |
|----------|-------|
| Walking skeletons | 3 |
| Happy path (focused) | 12 |
| Error path (focused) | 12 |
| Edge case (focused) | 5 |
| Property-tagged | 1 |
| **Total** | **33** |
| **Error path ratio** | **36%** (12/33) |

Note: Error ratio is close to the 40% target. The focused scenarios below include error and boundary cases across all milestones.

## Story Traceability Matrix

| Story | Scenarios | Files |
|-------|-----------|-------|
| US-01: Evidence Schema + Submission | 3 | milestone-1, walking-skeleton |
| US-02: Deterministic Verification | 5 | milestone-1 |
| US-03: Soft Enforcement | 2 | milestone-1, walking-skeleton |
| US-04: Verification Result Storage | 2 | milestone-1 |
| US-05: Authorship Independence | 4 | milestone-2 |
| US-06: Min Age + Hard Enforcement | 4 | milestone-2, walking-skeleton |
| US-07: Risk-Tiered Requirements | 3 | milestone-2 |
| US-08: Feed Evidence Display | 4 | milestone-4 |
| US-09: Workspace Bootstrapping | 3 | milestone-4 |
| US-10: Policy + Observer | 6 | milestone-3 |

## Scenario Inventory by Milestone

### Walking Skeleton (3 scenarios)

| # | Scenario | Type | Story | Status |
|---|----------|------|-------|--------|
| WS-1 | Agent submits evidence and receives verified authorization | happy | US-01,02,04 | enabled |
| WS-2 | Missing evidence elevates risk under soft enforcement | happy | US-01,03 | skip |
| WS-3 | Hard enforcement blocks insufficient evidence | error | US-06 | skip |

### Milestone 1: Core Verification (12 scenarios)

| # | Scenario | Type | Story | Status |
|---|----------|------|-------|--------|
| M1-1 | Agent submits intent with valid evidence references | happy | US-01 | skip |
| M1-2 | Agent submits intent without evidence references | edge | US-01 | skip |
| M1-3 | Agent cannot submit references to unsupported entity types | error | US-01 | skip |
| M1-4 | All evidence references pass verification | happy | US-02 | skip |
| M1-5 | Non-existent evidence reference fails verification | error | US-02 | skip |
| M1-6 | Cross-workspace evidence reference fails scope check | error | US-02 | skip |
| M1-7 | Superseded decision fails liveness check | error | US-02 | skip |
| M1-8 | Evidence created after intent fails temporal check | error | US-02 | skip |
| M1-9 | Evidence shortfall elevates risk under soft enforcement | happy | US-03 | skip |
| M1-10 | Full evidence keeps risk unchanged under soft enforcement | happy | US-03 | skip |
| M1-11 | Verification result persisted with count and timing | happy | US-04 | skip |
| M1-12 | Failed references individually identified | error | US-04 | skip |

### Milestone 2: Fabrication Resistance (12 scenarios)

| # | Scenario | Type | Story | Status |
|---|----------|------|-------|--------|
| M2-1 | High-risk intent passes with 2 independent references | happy | US-05 | skip |
| M2-2 | Self-referencing evidence fails for high-risk intent | error | US-05 | skip |
| M2-3 | Agent-confirmed evidence counts as independent | happy | US-05 | skip |
| M2-4 | Low-risk intent has no authorship requirement | edge | US-05 | skip |
| M2-5 | Recently created evidence fails minimum age check | error | US-06 | skip |
| M2-6 | Hard enforcement rejects zero evidence before evaluation | error | US-06 | skip |
| M2-7 | Hard enforcement passes sufficient evidence to evaluation | happy | US-06 | skip |
| M2-8 | Low-risk meets tier requirement with 1 reference | happy | US-07 | skip |
| M2-9 | High-risk fails when all references are observations | error | US-07 | skip |
| M2-10 | Medium-risk meets requirement with decision + independence | happy | US-07 | skip |
| M2-11 | Workspace transitions from soft to hard at maturity | edge | US-06 | skip |

### Milestone 3: Policy + Monitoring (6 scenarios)

| # | Scenario | Type | Story | Status |
|---|----------|------|-------|--------|
| M3-1 | Policy defines stricter requirements for financial actions | error | US-10 | skip |
| M3-2 | Policy overrides default tier for specific action type | happy | US-10 | skip |
| M3-3 | Intent without matching policy uses default tiers | happy | US-10 | skip |
| M3-4 | Evidence spam triggers Observer anomaly detection | error | US-10 | skip |
| M3-5 | Repeated evidence reuse triggers anomaly detection | error | US-10 | skip |
| M3-6 | Normal usage does not trigger anomaly | edge | US-10 | skip |

### Milestone 4: Feed + Bootstrapping (7 scenarios)

| # | Scenario | Type | Story | Status |
|---|----------|------|-------|--------|
| M4-1 | Feed shows verified evidence chain for pending intent | happy | US-08 | skip |
| M4-2 | Feed highlights failed evidence with reason | error | US-08 | skip |
| M4-3 | Feed shows zero-evidence warning | edge | US-08 | skip |
| M4-4 | New workspace in bootstrap mode allows no-evidence intents | happy | US-09 | skip |
| M4-5 | Bootstrap transitions to soft when first decision confirmed | edge | US-09 | skip |
| M4-6 | Admin manually overrides enforcement mode | happy | US-09 | skip |

## Implementation Sequence

1. **Walking Skeleton 1** (WS-1) -- enable first, drive initial implementation
2. **Walking Skeleton 2** (WS-2) -- soft enforcement penalty
3. **Walking Skeleton 3** (WS-3) -- hard enforcement rejection
4. **Milestone 1** (M1-1 through M1-12) -- core verification pipeline
5. **Milestone 2** (M2-1 through M2-11) -- fabrication resistance
6. **Milestone 3** (M3-1 through M3-6) -- policy and monitoring
7. **Milestone 4** (M4-1 through M4-6) -- feed and bootstrapping
