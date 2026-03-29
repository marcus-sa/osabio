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

| 47 | M8-Context Injection | Workspace decisions and learnings injected into request | walking_skeleton | |
| 48 | M8-Context Injection | Original system prompt preserved (append-only) | happy | |
| 49 | M8-Context Injection | Token budget respected | happy | |
| 50 | M8-Context Injection | Context injection disabled — forwarded without modification | edge | |
| 51 | M8-Context Injection | Context injection failure — forwarded without modification (fail-open) | error | |
| 52 | M8-Context Injection | Session cache hit — no DB query on repeated request | edge | |
| 53 | M8-Context Injection | Array-form system prompt preserved with osabio-context appended | edge | |
| 54 | M8-Context Injection | Empty workspace — no context block appended | edge | |
| 55 | M9-Conversation Hash | Identical requests grouped into same conversation | walking_skeleton | |
| 56 | M9-Conversation Hash | Different content produces different conversation | happy | |
| 57 | M9-Conversation Hash | Conversation title derived from first user message | happy | |
| 58 | M9-Conversation Hash | Missing system prompt — trace without conversation link | error | |
| 59 | M9-Conversation Hash | Missing first user message — trace without conversation link | error | |
| 60 | M9-Conversation Hash | Multiple turns preserve same conversation identity | happy | |
| 61 | M10-Session Resolution | Trace linked to agent session via X-Osabio-Session header | walking_skeleton | |
| 62 | M10-Session Resolution | Claude Code metadata.user_id session extraction | happy | |
| 63 | M10-Session Resolution | Unknown client — trace linked to workspace only | edge | |
| 64 | M10-Session Resolution | Nonexistent session ID — trace linked to workspace only | error | |
| 65 | M10-Session Resolution | Session activity timestamp updated on proxy request | happy | |
| 66 | M11-Observer Trace | Contradiction detected between trace and confirmed decision | walking_skeleton | |
| 67 | M11-Observer Trace | Missing decision detected from unrecorded approach choice | happy | |
| 68 | M11-Observer Trace | Tool-use stop reason — trace analysis skipped | edge | |
| 69 | M11-Observer Trace | No contradiction when response aligns with decisions | happy | |
| 70 | M11-Observer Trace | Observer analysis failure — trace still exists (fail-skip) | error | |
| 71 | M11-Observer Trace | Multiple contradictions detected in single trace | happy | |
| 72 | M11-Observer Trace | Low-confidence contradiction discarded by Tier 2 | edge | |
| 73 | M12-Observer Session End | Approach drift detected across session traces | walking_skeleton | |
| 74 | M12-Observer Session End | Consistent traces — no cross-trace observations | happy | |
| 75 | M12-Observer Session End | Single trace — no cross-trace patterns possible | edge | |
| 76 | M12-Observer Session End | Session-end analysis failure — session still ends | error | |
| 77 | M12-Observer Session End | Accumulated contradiction across multiple traces | happy | |
| 78 | M13-Reverse Coherence | Implementation without decision detected | walking_skeleton | |
| 79 | M13-Reverse Coherence | Task WITH decision link — no observation | happy | |
| 80 | M13-Reverse Coherence | Recent task (under age threshold) — not flagged | edge | |
| 81 | M13-Reverse Coherence | Multiple implementations — separate observations | happy | |
| 82 | M13-Reverse Coherence | Duplicate scan — no duplicate observations | edge | |

## Coverage Analysis

- **Total scenarios**: 82
- **Walking skeletons**: 9 (11%)
- **Happy path**: 32 (39%)
- **Error path**: 18 (22%)
- **Edge cases**: 21 (26%)
- **Property-based**: 2 (2%)
- **Error + Edge combined**: 39 (48%) -- exceeds 40% threshold

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
| Intelligence: Context Injection (ADR-046) | 47-54 | #47 | #51 |
| Intelligence: Conversation Hash (ADR-050) | 55-60 | #55 | #58, #59 |
| Intelligence: Session Resolution (ADR-049) | 61-65 | #61 | #64 |
| Intelligence: Observer Trace (ADR-047/051) | 66-72 | #66 | #70 |
| Intelligence: Observer Session End (ADR-048) | 73-77 | #73 | #76 |
| Intelligence: Reverse Coherence (ADR-051) | 78-82 | #78 | - |

All user stories and intelligence capabilities have acceptance test coverage. All acceptance criteria from the requirement and ADR documents are mapped to at least one scenario.

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

**Phase 4 (Intelligence)**:
8. `llm-proxy-context-injection.test.ts` -- Walking skeleton enabled, 7 scenarios skipped
9. `llm-proxy-conversation-hash.test.ts` -- Walking skeleton enabled, 5 scenarios skipped
10. `llm-proxy-session-resolution.test.ts` -- Walking skeleton enabled, 4 scenarios skipped
11. `llm-proxy-observer-trace.test.ts` -- Walking skeleton enabled, 6 scenarios skipped
12. `llm-proxy-observer-session-end.test.ts` -- Walking skeleton enabled, 4 scenarios skipped
13. `llm-proxy-observer-coherence.test.ts` -- Walking skeleton enabled, 4 scenarios skipped
