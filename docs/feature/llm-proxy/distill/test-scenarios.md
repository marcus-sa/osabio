# LLM Proxy Acceptance Test Scenarios

## Scenario Inventory

| # | Milestone | Scenario | Type | Tag |
|---|-----------|----------|------|-----|
| 1 | Walking Skeleton | Developer makes LLM call and it works identically | walking_skeleton | |
| 2 | Walking Skeleton | Developer's LLM call recorded as trace | walking_skeleton | |
| 3 | Walking Skeleton | Admin sees cost attributed to correct project | walking_skeleton | |
| 4 | M1-Passthrough | Non-streaming request forwarded transparently | happy | |
| 5 | M1-Passthrough | Streaming request relays all SSE events | happy | |
| 6 | M1-Passthrough | All required headers forwarded | happy | |
| 7 | M1-Passthrough | Upstream failure returns distinguishable error | error | |
| 8 | M1-Passthrough | Malformed request body forwarded without interference | error | |
| 9 | M1-Passthrough | Tool use SSE events pass through unmodified | edge | |
| 10 | M1-Passthrough | Extended thinking blocks pass through | edge | |
| 11 | M1-Passthrough | Count tokens forwarded without trace | edge | |
| 12 | M2-Identity | Full identity resolved from metadata and headers | happy | |
| 13 | M2-Identity | Graceful degradation without task header | edge | |
| 14 | M2-Identity | Graceful degradation without any metadata | edge | |
| 15 | M2-Identity | Invalid workspace produces warning | error | |
| 16 | M2-Identity | Malformed metadata parsed as opaque identifier | error | |
| 17 | M3-Trace | Trace created with full usage data | happy | |
| 18 | M3-Trace | Trace edges link to session, workspace, task | happy | |
| 19 | M3-Trace | Trace without task has workspace edge only | edge | |
| 20 | M3-Trace | Non-streaming response trace structure | edge | |
| 21 | M3-Trace | Trace capture is non-blocking | edge | |
| 22 | M3-Trace | Graph write failure retry and fallback | error | |
| 23 | M3-Trace | Every LLM call has a corresponding trace | property | @property |
| 24 | M4-Cost | Cost computed from Sonnet response with cache | happy | |
| 25 | M4-Cost | Cost computed from Haiku response | happy | |
| 26 | M4-Cost | Spend counters at all granularities | happy | |
| 27 | M4-Cost | Unattributed costs visible | edge | |
| 28 | M4-Cost | Historical costs unaffected by pricing changes | edge | |
| 29 | M4-Cost | Spend API returns breakdown | happy | |
| 30 | M4-Cost | Spend counters consistent with traces | property | @property |
| 31 | M5-Policy | Authorized request passes policy check | happy | |
| 32 | M5-Policy | Unauthorized model blocked with reference | error | |
| 33 | M5-Policy | Budget exceeded blocked with details | error | |
| 34 | M5-Policy | Rate limited with retry guidance | error | |
| 35 | M5-Policy | No policies defaults to permissive | edge | |
| 36 | M5-Policy | Policy check within 10ms latency | edge | |
| 37 | M5-Policy | Policy decision logged for audit | edge | |
| 38 | M6-Dashboard | Workspace spend with budget progress | happy | |
| 39 | M6-Dashboard | Per-project spend breakdown | happy | |
| 40 | M6-Dashboard | Per-session cost breakdown | happy | |
| 41 | M6-Dashboard | Anomaly alert for unusual call rate | error | |
| 42 | M6-Dashboard | Budget threshold alert at 80% | edge | |
| 43 | M7-Audit | Provenance chain for a trace | happy | |
| 44 | M7-Audit | Traces by project and date range | happy | |
| 45 | M7-Audit | Authorization compliance check passes | happy | |
| 46 | M7-Audit | Traces without authorization flagged | error | |

## Coverage Analysis

- **Total scenarios**: 46
- **Walking skeletons**: 3 (7%)
- **Happy path**: 18 (39%)
- **Error path**: 11 (24%)
- **Edge cases**: 12 (26%)
- **Property-based**: 2 (4%)
- **Error + Edge combined**: 23 (50%) -- exceeds 40% threshold

## Story Coverage Map

| User Story | Scenarios | Walking Skeleton | Error Paths |
|------------|-----------|------------------|-------------|
| US-LP-001 | 4-11 | #1 | #7, #8 |
| US-LP-002 | 12-16 | #1, #2 | #15, #16 |
| US-LP-003 | 17-23 | #2 | #22 |
| US-LP-004 | 24-30 | #3 | - |
| US-LP-005 | 31-37 | - | #32, #33, #34 |
| US-LP-006 | 38-42 | - | #41 |
| US-LP-007 | 43-46 | - | #46 |

All 7 user stories have acceptance test coverage. All acceptance criteria from the requirement documents are mapped to at least one scenario.

## Implementation Sequence

Tests follow one-at-a-time enablement:

**Phase 1 (Foundation)**:
1. `llm-proxy-passthrough.test.ts` -- Walking skeleton enabled, 5 scenarios skipped
2. `llm-proxy-identity.test.ts` -- First scenario enabled, 4 skipped
3. `llm-proxy-trace.test.ts` -- Walking skeleton enabled, 4 skipped

**Phase 2 (Value)**:
4. `llm-proxy-cost.test.ts` -- Walking skeleton enabled, 4 skipped
5. `llm-proxy-policy.test.ts` -- First scenario enabled, 5 skipped

**Phase 3 (Visibility)**:
6. `llm-proxy-dashboard.test.ts` -- First scenario enabled, 4 skipped
7. `llm-proxy-audit.test.ts` -- First scenario enabled, 3 skipped
