# Definition of Ready Validation: LLM Proxy Stories

**Date**: 2026-03-15
**Validator**: Luna (product-owner)

---

## US-LP-001: Transparent Proxy Passthrough

| DoR Item | Status | Evidence |
|----------|--------|---------|
| Problem statement clear | PASS | "Priya needs Brain's observability but finds it unacceptable if the proxy adds latency or requires workflow changes" -- domain language, specific pain |
| User/persona identified | PASS | Priya Chandrasekaran, senior developer, daily Claude Code user, 100-500 API calls/day |
| 3+ domain examples | PASS | 4 examples: happy path (8-call session), extended thinking/tool use, upstream failure, count_tokens |
| UAT scenarios (3-7) | PASS | 5 scenarios: streaming passthrough, non-streaming, upstream failure, header forwarding, tool use events |
| AC derived from UAT | PASS | 7 AC items derived from scenarios |
| Right-sized | PASS | 2 days effort, 5 scenarios, walking skeleton exists |
| Technical notes | PASS | Walking skeleton reference, Bun TransformStream, X-Accel-Buffering, partial SSE handling |
| Dependencies tracked | PASS | None (walking skeleton exists) |

**DoR Status**: PASSED

---

## US-LP-002: Identity Resolution

| DoR Item | Status | Evidence |
|----------|--------|---------|
| Problem statement clear | PASS | "Marcus cannot tell which developer or agent made a specific LLM call" -- specific pain, domain language |
| User/persona identified | PASS | Marcus (admin) + Priya (developer), specific characteristics documented |
| 3+ domain examples | PASS | 4 examples: full identity, no task header, no metadata, invalid workspace |
| UAT scenarios (3-7) | PASS | 4 scenarios covering full resolution, graceful degradation (2 variants), invalid workspace |
| AC derived from UAT | PASS | 6 AC items derived from scenarios |
| Right-sized | PASS | 1 day effort, 4 scenarios |
| Technical notes | PASS | Existing parser reference, workspace caching, 10ms budget, task validation |
| Dependencies tracked | PASS | US-LP-001 dependency explicit |

**DoR Status**: PASSED

---

## US-LP-003: Graph-Native Trace Capture

| DoR Item | Status | Evidence |
|----------|--------|---------|
| Problem statement clear | PASS | "Marcus has zero visibility into what his coding agents are doing with the LLM" -- specific pain with current workaround (stdout logs) |
| User/persona identified | PASS | Marcus (admin), Elena (auditor) with specific characteristics |
| 3+ domain examples | PASS | 4 examples: full trace, no task, graph write failure, non-streaming |
| UAT scenarios (3-7) | PASS | 5 scenarios: full trace, edges with/without task, non-blocking, retry/fallback |
| AC derived from UAT | PASS | 6 AC items derived from scenarios |
| Right-sized | PASS | 2 days effort, 5 scenarios (schema migration + async writes) |
| Technical notes | PASS | SCHEMAFULL tables, RELATE edges, inflight tracker, pricing table, migration needed |
| Dependencies tracked | PASS | US-LP-001, US-LP-002 explicit |

**DoR Status**: PASSED

---

## US-LP-004: Cost Attribution

| DoR Item | Status | Evidence |
|----------|--------|---------|
| Problem statement clear | PASS | "Marcus manually checks Anthropic's billing dashboard, estimates allocation, takes 30+ min/week and is inaccurate" -- specific pain with quantified workaround |
| User/persona identified | PASS | Marcus (admin) with specific motivation and context |
| 3+ domain examples | PASS | 4 examples: per-project breakdown, cache-aware cost, unattributed costs, pricing change |
| UAT scenarios (3-7) | PASS | 5 scenarios: Sonnet cost, Haiku cost, counter updates, unattributed, API response |
| AC derived from UAT | PASS | 6 AC items derived from scenarios |
| Right-sized | PASS | 2 days effort, 5 scenarios |
| Technical notes | PASS | Pricing table design, counter strategies, reconciliation, API endpoint spec, SurrealDB aggregation |
| Dependencies tracked | PASS | US-LP-003, US-LP-002 explicit |

**DoR Status**: PASSED

---

## US-LP-005: Policy Enforcement

| DoR Item | Status | Evidence |
|----------|--------|---------|
| Problem statement clear | PASS | "A bug in an agent loop could burn through $500 in minutes with no guardrail" -- specific risk, quantified pain |
| User/persona identified | PASS | Marcus (admin granting authority) + autonomous agent (receiving enforcement) |
| 3+ domain examples | PASS | 5 examples: pass, model denied, budget exceeded, rate limited, no policies |
| UAT scenarios (3-7) | PASS | 5 scenarios covering all enforcement types + permissive default |
| AC derived from UAT | PASS | 7 AC items derived from scenarios |
| Right-sized | PASS | 2 days effort, 5 scenarios |
| Technical notes | PASS | Policy graph integration, caching, rate limiting strategy, error format, agent type detection |
| Dependencies tracked | PASS | US-LP-002, US-LP-004, Brain policy engine explicit |

**DoR Status**: PASSED

---

## US-LP-006: Spend Monitoring Dashboard

| DoR Item | Status | Evidence |
|----------|--------|---------|
| Problem statement clear | PASS | "Marcus has no way to monitor LLM spending in real-time, checks Anthropic weekly with no project breakdown" -- specific pain |
| User/persona identified | PASS | Marcus (admin), daily monitoring context, drill-down motivation |
| 3+ domain examples | PASS | 4 examples: daily review, session drill-down, anomaly alert, budget threshold |
| UAT scenarios (3-7) | PASS | 5 scenarios: budget progress, project breakdown, session breakdown, anomaly alert, budget threshold |
| AC derived from UAT | PASS | 7 AC items derived from scenarios |
| Right-sized | PASS | 2-3 days effort, 5 scenarios (web UI + API endpoints) |
| Technical notes | PASS | API endpoints, anomaly detection thresholds, caching strategy, observation system integration |
| Dependencies tracked | PASS | US-LP-003, US-LP-004 explicit |

**DoR Status**: PASSED

---

## US-LP-007: Audit Provenance Chain

| DoR Item | Status | Evidence |
|----------|--------|---------|
| Problem statement clear | PASS | "Elena cannot answer 'was this LLM call authorized?' without manual log archaeology" -- specific pain, auditor context |
| User/persona identified | PASS | Elena (auditor, quarterly cycles, moderate tech proficiency) + Marcus (incident investigation) |
| 3+ domain examples | PASS | 4 examples: single trace, date range query, compliance pass, policy gap flagged |
| UAT scenarios (3-7) | PASS | 4 scenarios: provenance view, date range query, compliance pass, unverified traces |
| AC derived from UAT | PASS | 7 AC items derived from scenarios |
| Right-sized | PASS | 2 days effort, 4 scenarios |
| Technical notes | PASS | SurrealQL queries, export formats, batch compliance check, streaming CSV |
| Dependencies tracked | PASS | US-LP-003, US-LP-005, Brain policy engine explicit |

**DoR Status**: PASSED

---

## Summary

| Story | DoR Status | Items Passed | Items Failed |
|-------|-----------|-------------|-------------|
| US-LP-001 | PASSED | 8/8 | 0 |
| US-LP-002 | PASSED | 8/8 | 0 |
| US-LP-003 | PASSED | 8/8 | 0 |
| US-LP-004 | PASSED | 8/8 | 0 |
| US-LP-005 | PASSED | 8/8 | 0 |
| US-LP-006 | PASSED | 8/8 | 0 |
| US-LP-007 | PASSED | 8/8 | 0 |

**All 7 stories pass Definition of Ready. Package ready for DESIGN wave handoff.**
