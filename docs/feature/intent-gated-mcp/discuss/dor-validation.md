# Definition of Ready Validation: Intent-Gated MCP

## Story: US-01 (Dynamic tools/list with Effective Scope)

| DoR Item | Status | Evidence/Issue |
|----------|--------|----------------|
| Problem statement clear | PASS | Agent has no way to discover governed tools; domain language used |
| User/persona identified | PASS | Sandbox coding agent with session context |
| 3+ domain examples | PASS | 3 examples: one intent, no intents, composite intent |
| UAT scenarios (3-7) | PASS | 4 scenarios covering authorized, gated, native, invalid token |
| AC derived from UAT | PASS | 5 ACs map to scenarios |
| Right-sized | PASS | 1-2 days, 4 scenarios |
| Technical notes | PASS | Dependencies, scope computation sharing, gates edge schema |
| Dependencies tracked | PASS | sandbox-agent-integration R2 explicitly noted |
| Outcome KPIs | PASS | tools/list latency + scope correctness |

### DoR Status: PASSED

---

## Story: US-02 (Authorized tools/call with Upstream Forwarding)

| DoR Item | Status | Evidence/Issue |
|----------|--------|----------------|
| Problem statement clear | PASS | Agent cannot execute tool calls through governance pipeline |
| User/persona identified | PASS | Sandbox coding agent with authorized intents |
| 3+ domain examples | PASS | 3 examples: GitHub PR, Stripe refund, Jira timeout |
| UAT scenarios (3-7) | PASS | 4 scenarios: authorized, unauthorized, upstream failure, trace completeness |
| AC derived from UAT | PASS | 6 ACs cover all scenarios |
| Right-sized | PASS | 2-3 days, 4 scenarios |
| Technical notes | PASS | Upstream connection, trace schema, JSON-RPC forwarding |
| Dependencies tracked | PASS | US-01, upstream MCP server registry |
| Outcome KPIs | PASS | 95% success rate for authorized calls |

### DoR Status: PASSED

---

## Story: US-03 (Gated Tool Escalation via create_intent)

| DoR Item | Status | Evidence/Issue |
|----------|--------|----------------|
| Problem statement clear | PASS | Agent stuck on 403 with no escalation mechanism |
| User/persona identified | PASS | Sandbox coding agent encountering gated tool |
| 3+ domain examples | PASS | 3 examples: auto-approve, veto-required, denied |
| UAT scenarios (3-7) | PASS | 5 scenarios covering all outcomes and template usage |
| AC derived from UAT | PASS | 7 ACs map to scenarios |
| Right-sized | PASS | 2-3 days, 5 scenarios |
| Technical notes | PASS | Existing intent system, BrainAction mapping |
| Dependencies tracked | PASS | Existing intent infrastructure referenced |
| Outcome KPIs | PASS | 90% escalation rate after 403 |

### DoR Status: PASSED

---

## Story: US-04 (Human Veto Flow for Pending Intents)

| DoR Item | Status | Evidence/Issue |
|----------|--------|----------------|
| Problem statement clear | PASS | Operator cannot see or act on pending agent tool requests |
| User/persona identified | PASS | Human operator Carla Mendes |
| 3+ domain examples | PASS | 3 examples: approve, veto with reason, timeout expiry |
| UAT scenarios (3-7) | PASS | 4 scenarios |
| AC derived from UAT | PASS | 5 ACs |
| Right-sized | PASS | 1-2 days, 4 scenarios (builds on existing feed + intent endpoints) |
| Technical notes | PASS | Existing endpoints, veto-manager, feed card content |
| Dependencies tracked | PASS | Existing intent approval endpoints, governance feed |
| Outcome KPIs | PASS | 80% human resolution before timeout |

### DoR Status: PASSED

---

## Story: US-05 (Observer Resume Trigger for Idle Sessions)

| DoR Item | Status | Evidence/Issue |
|----------|--------|----------------|
| Problem statement clear | PASS | Agent stuck idle after approval; no resume mechanism |
| User/persona identified | PASS | Observer agent scanning graph |
| 3+ domain examples | PASS | 3 examples: approved resume, vetoed resume, multiple pending |
| UAT scenarios (3-7) | PASS | 3 scenarios |
| AC derived from UAT | PASS | 5 ACs |
| Right-sized | PASS | 2 days, 3 scenarios |
| Technical notes | PASS | Observer query, resume prompt content, idempotency |
| Dependencies tracked | PASS | US-04, observer infrastructure, adapter.resumeSession |
| Outcome KPIs | PASS | 95% resume within 60s |

### DoR Status: PASSED

---

## Story: US-06 (Constraint Enforcement on tools/call)

| DoR Item | Status | Evidence/Issue |
|----------|--------|----------------|
| Problem statement clear | PASS | Agent can exceed authorized limits without enforcement |
| User/persona identified | PASS | Sandbox coding agent with constrained intents |
| 3+ domain examples | PASS | 3 examples: within bounds, exceeding, currency mismatch |
| UAT scenarios (3-7) | PASS | 4 scenarios |
| AC derived from UAT | PASS | 6 ACs |
| Right-sized | PASS | 1-2 days, 4 scenarios (reuses rar-verifier.ts) |
| Technical notes | PASS | rar-verifier reuse, constraint field mapping |
| Dependencies tracked | PASS | US-02, rar-verifier.ts |
| Outcome KPIs | PASS | 100% violation catch rate |

### DoR Status: PASSED

---

## Story: US-07 (Composite Intents for Multi-Step Tool Chains)

| DoR Item | Status | Evidence/Issue |
|----------|--------|----------------|
| Problem statement clear | PASS | Multi-step workflows require multiple intents, excessive friction |
| User/persona identified | PASS | Sandbox coding agent planning multi-tool workflows |
| 3+ domain examples | PASS | 3 examples: search-then-refund, read chain, partial denial |
| UAT scenarios (3-7) | PASS | 3 scenarios |
| AC derived from UAT | PASS | 5 ACs |
| Right-sized | PASS | 1-2 days, 3 scenarios |
| Technical notes | PASS | Existing authorization_details array, fail-closed semantics |
| Dependencies tracked | PASS | US-03 |
| Outcome KPIs | PASS | Composite vs individual intent ratio |

### DoR Status: PASSED

---

## Story: US-08 (Operational Hardening)

| DoR Item | Status | Evidence/Issue |
|----------|--------|----------------|
| Problem statement clear | PASS | Production reliability under concurrent sessions |
| User/persona identified | PASS | Platform operations team |
| 3+ domain examples | PASS | 3 examples: timeout, dedup, cache |
| UAT scenarios (3-7) | PASS | 3 scenarios |
| AC derived from UAT | PASS | 5 ACs |
| Right-sized | PASS | 2-3 days, 3 scenarios |
| Technical notes | PASS | Cache strategy, dedup query, AbortController |
| Dependencies tracked | PASS | US-01 through US-07 |
| Outcome KPIs | PASS | <1% timeout rate |

### DoR Status: PASSED

---

## Summary

| Story | DoR Status | Items Passed | Release |
|-------|-----------|-------------|---------|
| US-01 | PASSED | 9/9 | Walking Skeleton |
| US-02 | PASSED | 9/9 | Walking Skeleton |
| US-03 | PASSED | 9/9 | Walking Skeleton |
| US-04 | PASSED | 9/9 | Release 1 |
| US-05 | PASSED | 9/9 | Release 1 |
| US-06 | PASSED | 9/9 | Release 2 |
| US-07 | PASSED | 9/9 | Release 2 |
| US-08 | PASSED | 9/9 | Release 3 |

All 8 stories pass Definition of Ready. Ready for handoff to DESIGN wave.
