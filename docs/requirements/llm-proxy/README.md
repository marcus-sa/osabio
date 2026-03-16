# LLM Proxy Requirements Package

**Epic**: llm-proxy
**Date**: 2026-03-15
**Author**: Luna (product-owner)

---

## Story Map

```
Workflow:  [Connect]  -->  [Authenticate]  -->  [Authorize]  -->  [Forward]  -->  [Capture]  -->  [Monitor]  -->  [Audit]
             |                |                    |                 |               |               |              |
Row 1:    US-LP-001        US-LP-002           US-LP-005         US-LP-001       US-LP-003       US-LP-006      US-LP-007
(MVP)     Passthrough      Identity            Policy            Passthrough     Trace           Dashboard      Provenance
                                               Enforcement       (same story)    Capture
             |                                                                     |
Row 2:                                                                          US-LP-004
(MVP)                                                                           Cost
                                                                                Attribution
```

## Stories Summary

| ID | Title | Priority | Size | Depends On |
|----|-------|----------|------|------------|
| US-LP-001 | Transparent Proxy Passthrough | Must Have | 2 days, 5 scenarios | None (walking skeleton exists) |
| US-LP-002 | Identity Resolution | Must Have | 1 day, 4 scenarios | US-LP-001 |
| US-LP-003 | Graph-Native Trace Capture | Must Have | 2 days, 5 scenarios | US-LP-001, US-LP-002 |
| US-LP-004 | Cost Attribution + Spend Tracking | Must Have | 2 days, 5 scenarios | US-LP-003, US-LP-002 |
| US-LP-005 | Policy Enforcement | Must Have | 2 days, 5 scenarios | US-LP-002, US-LP-004 |
| US-LP-006 | Spend Monitoring Dashboard | Should Have | 2-3 days, 5 scenarios | US-LP-003, US-LP-004 |
| US-LP-007 | Audit Provenance Chain | Should Have | 2 days, 4 scenarios | US-LP-003, US-LP-005 |

## Dependency Graph

```
US-LP-001 (Passthrough)
   |
   v
US-LP-002 (Identity)
   |
   +---> US-LP-003 (Trace Capture)
   |        |
   |        +---> US-LP-004 (Cost Attribution)
   |        |        |
   |        |        +---> US-LP-005 (Policy Enforcement)
   |        |        |        |
   |        |        |        +---> US-LP-007 (Audit Provenance)
   |        |        |
   |        |        +---> US-LP-006 (Spend Dashboard)
   |        |
   |        +---> US-LP-007 (Audit Provenance)
   |
   +---> US-LP-005 (Policy Enforcement)
```

## Delivery Order (Recommended)

**Phase 1 -- Foundation (Week 1)**:
1. US-LP-001: Solidify passthrough (walking skeleton exists; add tests + error handling)
2. US-LP-002: Identity resolution
3. US-LP-003: Graph trace capture (schema migration + async writes)

**Phase 2 -- Value (Week 2)**:
4. US-LP-004: Cost attribution + spend tracking
5. US-LP-005: Policy enforcement

**Phase 3 -- Visibility (Week 3)**:
6. US-LP-006: Spend monitoring dashboard
7. US-LP-007: Audit provenance chain

## Job Story Traceability

| Job Story | Stories |
|-----------|---------|
| JS-1: Transparent Cost Visibility | US-LP-003, US-LP-004, US-LP-006 |
| JS-2: Zero-Friction Agent Gateway | US-LP-001, US-LP-002 |
| JS-3: Governed Agent Autonomy | US-LP-005 |
| JS-4: Auditable Agent Provenance | US-LP-002, US-LP-003, US-LP-007 |

## Non-Functional Requirements

| NFR | Threshold | Story Reference |
|-----|-----------|----------------|
| Proxy latency overhead | < 50ms p95 time-to-first-token | US-LP-001 |
| Policy check latency | < 10ms p99 | US-LP-005 |
| Dashboard load time | < 2 seconds | US-LP-006 |
| Audit query response | < 2 seconds any date range | US-LP-007 |
| Trace completeness | 100% of forwarded calls have traces | US-LP-003 |
| Spend accuracy | Counters match SUM(trace costs) | US-LP-004 |

## Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Proxy adds perceptible latency | Low | High | Raw byte passthrough; no transformation on hot path |
| Graph writes slow down under load | Medium | Medium | Async writes via inflight tracker; batching |
| Pricing table goes stale | Medium | Low | Periodic sync; costs are per-trace (not retroactive) |
| Policy cache stale during rapid changes | Low | Medium | Short TTL (60s); manual cache invalidation option |
| SurrealDB unavailable during trace write | Low | Medium | 3x retry + stderr fallback; reconciliation on reconnect |

## Artifacts

### UX Journey
- `docs/ux/llm-proxy/jtbd-analysis.md` -- JTBD analysis with personas, job stories, forces, opportunity scoring
- `docs/ux/llm-proxy/journey-proxy-gateway-visual.md` -- Visual journey map with ASCII mockups and emotional annotations
- `docs/ux/llm-proxy/journey-proxy-gateway.yaml` -- Structured journey schema
- `docs/ux/llm-proxy/journey-proxy-gateway.feature` -- Gherkin acceptance scenarios
- `docs/ux/llm-proxy/shared-artifacts-registry.md` -- Shared data tracking across journey steps

### Requirements
- `docs/requirements/llm-proxy/US-LP-001-transparent-proxy-passthrough.md`
- `docs/requirements/llm-proxy/US-LP-002-identity-resolution.md`
- `docs/requirements/llm-proxy/US-LP-003-graph-trace-capture.md`
- `docs/requirements/llm-proxy/US-LP-004-cost-attribution.md`
- `docs/requirements/llm-proxy/US-LP-005-policy-enforcement.md`
- `docs/requirements/llm-proxy/US-LP-006-spend-monitoring-dashboard.md`
- `docs/requirements/llm-proxy/US-LP-007-audit-provenance.md`

### Research
- `docs/research/llm-proxy-research.md` -- Proxy architecture, SSE passthrough, cost attribution patterns
- `docs/research/coding-agent-internals-research.md` -- Agent loop patterns, traffic volumes, multi-model strategy
