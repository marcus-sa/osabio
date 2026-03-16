# Definition of Ready Validation: LLM Reasoning Telemetry Stories

## US-01: Persist LLM Reasoning on Observations

| DoR Item | Status | Evidence |
|----------|--------|----------|
| Problem statement clear, domain language | PASS | "Carla Navarro investigates Observer findings... finds it impossible to determine WHY... wastes 30-60 minutes per investigation" |
| User/persona with specific characteristics | PASS | Carla Navarro, workspace admin, 3 active projects, reviews findings daily. Observer agent (programmatic consumer). Behavior scorer (programmatic consumer). |
| 3+ domain examples with real data | PASS | (1) Verification verdict reasoning for billing-tRPC contradiction, (2) Peer review reasoning for Redis caching observation, (3) Anomaly evaluation reasoning for GDPR docs task |
| UAT scenarios in Given/When/Then (3-7) | PASS | 5 scenarios: verification stored, peer review stored, deterministic fallback, LLM failure, contradiction detection |
| AC derived from UAT | PASS | 5 AC items map to the 5 scenarios |
| Right-sized (1-3 days, 3-7 scenarios) | PASS | ~2 days: 1 schema migration + 4 pipeline integration points + createObservation() update. 5 scenarios. |
| Technical notes identify constraints | PASS | Schema migration path, 4 LLM reasoning paths enumerated, option<string> convention noted |
| Dependencies resolved or tracked | PASS | No external dependencies. Self-contained. |

**DoR Status: PASSED**

---

## US-02: Persist LLM Reasoning on Intent Authorization

| DoR Item | Status | Evidence |
|----------|--------|----------|
| Problem statement clear, domain language | PASS | "evaluation.reason shows one-line summary... cannot see full chain-of-thought... making compliance review shallow" |
| User/persona with specific characteristics | PASS | Carla Navarro auditing intent authorization decisions. Compliance reviewer role described. |
| 3+ domain examples with real data | PASS | (1) Deploy billing service with budget reasoning, (2) Policy-only config update (no LLM), (3) Rejected delete-production-records with denial reasoning |
| UAT scenarios in Given/When/Then (3-7) | PASS | 4 scenarios: LLM reasoning stored, policy-only no reasoning, rejected intent reasoning, admin views both fields |
| AC derived from UAT | PASS | 5 AC items covering field addition, pipeline integration, field distinction, policy-only handling |
| Right-sized (1-3 days, 3-7 scenarios) | PASS | ~1.5 days: 1 schema migration + 1 pipeline integration point. 4 scenarios. |
| Technical notes identify constraints | PASS | Schema migration, intent-submission.ts path, naming rationale (llm_reasoning vs reasoning), option<string> |
| Dependencies resolved or tracked | PASS | Depends on US-01 for pattern establishment (soft dependency, not blocking) |

**DoR Status: PASSED**

---

## US-03: "View Logic" Toggle in Observation Detail UI

| DoR Item | Status | Evidence |
|----------|--------|----------|
| Problem statement clear, domain language | PASS | "reasoning exists in data but is not accessible in her normal workflow" |
| User/persona with specific characteristics | PASS | Carla Navarro, workspace admin, web UI workflow |
| 3+ domain examples with real data | PASS | (1) Full reasoning with trace link for contradiction, (2) Deterministic fallback display, (3) Legacy observation empty state |
| UAT scenarios in Given/When/Then (3-7) | PASS | 5 scenarios: full reasoning, fallback, legacy, toggle hide, default collapsed |
| AC derived from UAT | PASS | 7 AC items covering toggle visibility, panel states, model/trace display, access control |
| Right-sized (1-3 days, 3-7 scenarios) | PASS | ~2 days: UI component + API response extension + access control. 5 scenarios. |
| Technical notes identify constraints | PASS | API response extension, access control note, trace linkage query, UI component pattern |
| Dependencies resolved or tracked | PASS | Depends on US-01 (hard dependency -- field must exist) |

**DoR Status: PASSED**

---

## US-04: Observer Reasoning Queries for Drift Detection

| DoR Item | Status | Evidence |
|----------|--------|----------|
| Problem statement clear, domain language | PASS | "cannot audit QUALITY of its own reasoning... degradation is invisible until false positives pile up" |
| User/persona with specific characteristics | PASS | Observer agent (self-calibration), Behavior scorer (evaluation cycle) |
| 3+ domain examples with real data | PASS | (1) Elena's workspace self-calibration with metrics, (2) Monthly behavior scoring with threshold evaluation, (3) New workspace with insufficient data |
| UAT scenarios in Given/When/Then (3-7) | PASS | 4 scenarios: reasoning query, scorer load, empty result, workspace scope |
| AC derived from UAT | PASS | 6 AC items covering query function, filtering, scope, limits, consumer compatibility |
| Right-sized (1-3 days, 3-7 scenarios) | PASS | ~1 day: single query function + caller integration. 4 scenarios. |
| Technical notes identify constraints | PASS | Query function signature, SurrealQL, no new API endpoint, consumer paths listed |
| Dependencies resolved or tracked | PASS | Depends on US-01 (hard dependency -- field must have data) |

**DoR Status: PASSED**

---

## Summary

| Story | DoR Status | Effort Estimate | Priority (MoSCoW) |
|-------|-----------|----------------|-------------------|
| US-01: Persist Reasoning on Observations | PASSED | 2 days | Must Have |
| US-02: Persist Reasoning on Intents | PASSED | 1.5 days | Should Have |
| US-03: View Logic UI Toggle | PASSED | 2 days | Should Have |
| US-04: Observer Reasoning Queries | PASSED | 1 day | Should Have |

### Implementation Order
1. **US-01** first (schema + pipeline -- enables all other stories)
2. **US-02** second (schema + pipeline -- parallel with US-03 if desired)
3. **US-03** and **US-04** can proceed in parallel after US-01

### Total Estimated Effort
~6.5 days for full feature across schema, backend, and UI layers.

### Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Reasoning text is very long for some LLM calls (token-heavy prompts) | Medium | Low | Reasoning is the LLM OUTPUT (chain-of-thought), not the input prompt. Output is typically 100-500 chars. No truncation needed. |
| Legacy observations cause UI confusion (no reasoning) | Low | Medium | US-03 handles three states explicitly: reasoning available, fallback, legacy empty state |
| Access control gap exposes reasoning to non-admin agents | Medium | Medium | US-03 AC includes access control requirement. Reasoning excluded from non-admin API responses. |
| Observer self-calibration creates noise observations | Low | Low | Drift observations should be info severity, not conflict. Behavior scorer is the primary drift consumer. |
