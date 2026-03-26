# Definition of Ready Validation: Evidence-Backed Intent Authorization

## US-01: Evidence Schema and Intent Submission

| DoR Item | Status | Evidence/Issue |
|----------|--------|----------------|
| Problem statement clear | PASS | Ravi cannot verify whether agent justification is grounded or fabricated; no structured link between intent and graph records |
| User/persona identified | PASS | Ravi Patel (workspace admin, 4 agents, supply chain) + Logistics-Planner agent |
| 3+ domain examples | PASS | 3 examples: supply chain routing with decision+task, compliance escalation with observation, no evidence provided |
| UAT scenarios (3-7) | PASS | 3 scenarios: with evidence, without evidence, invalid format |
| AC derived from UAT | PASS | 5 ACs covering schema, API, types, optional field |
| Right-sized | PASS | ~1 day effort: schema migration + API param + TypeScript type |
| Technical notes | PASS | Schema migration, type compatibility with observation.evidence_refs, RecordId wire format |
| Dependencies tracked | PASS | No dependencies -- first story in the chain |
| Outcome KPIs defined | PASS | Field availability on 100% of intents, measured by schema validation |

### DoR Status: PASSED

---

## US-02: Deterministic Evidence Verification Pipeline

| DoR Item | Status | Evidence/Issue |
|----------|--------|----------------|
| Problem statement clear | PASS | References alone are not proof; compromised agent could cite non-existent/invalid records |
| User/persona identified | PASS | Ravi (needs certainty) + Authorization pipeline (needs fast verification) |
| 3+ domain examples | PASS | 3 examples: all valid, non-existent ref, superseded decision |
| UAT scenarios (3-7) | PASS | 5 scenarios: all pass, non-existent, cross-workspace, superseded, temporal violation |
| AC derived from UAT | PASS | 6 ACs covering checks, batching, storage, failure identification, ordering, valid statuses |
| Right-sized | PASS | ~2 days effort: verification query + pipeline integration + result storage |
| Technical notes | PASS | Batch query design, max 10 refs, synchronous in eval flow, authorizer.ts integration |
| Dependencies tracked | PASS | Depends on US-01 (evidence_refs field) |
| Outcome KPIs defined | PASS | 100% catch rate, zero false negatives, acceptance test coverage |

### DoR Status: PASSED

---

## US-03: Soft Enforcement in Risk Router

| DoR Item | Status | Evidence/Issue |
|----------|--------|----------------|
| Problem statement clear | PASS | Cannot flip hard switch overnight; needs gradual ramp from advisory to mandatory |
| User/persona identified | PASS | Ravi (gradual adoption) + Agents (clear feedback without hard rejection) |
| 3+ domain examples | PASS | 3 examples: shortfall elevates risk, full evidence unchanged, zero evidence on low-risk |
| UAT scenarios (3-7) | PASS | 3 scenarios: shortfall penalty, full evidence, enforcement mode from workspace |
| AC derived from UAT | PASS | 6 ACs covering schema, default, penalty, configurability, enforcement read, visibility |
| Right-sized | PASS | ~1.5 days: workspace schema field + risk router modification + penalty logic |
| Technical notes | PASS | Workspace field, tier constants, penalty default, post-LLM application |
| Dependencies tracked | PASS | Depends on US-02 (verification pipeline provides shortfall count) |
| Outcome KPIs defined | PASS | Under-evidenced intents route to veto window, measured by risk score differential |

### DoR Status: PASSED

---

## US-04: Verification Result Storage and LLM Context Enrichment

| DoR Item | Status | Evidence/Issue |
|----------|--------|----------------|
| Problem statement clear | PASS | Verification results vanish after routing; invisible to human reviewer and audit |
| User/persona identified | PASS | Ravi (reviewing intents) + LLM evaluator (better risk assessment) |
| 3+ domain examples | PASS | 3 examples: full verification stored, partial failure stored, audit trail query |
| UAT scenarios (3-7) | PASS | 3 scenarios: result persisted, LLM receives context, failed refs identified |
| AC derived from UAT | PASS | 5 ACs covering schema, storage, LLM prompt, identifiability, queryability |
| Right-sized | PASS | ~1 day: schema fields + write in pipeline + LLM prompt enrichment |
| Technical notes | PASS | Schema object, prompt enrichment location, write-before-LLM ordering |
| Dependencies tracked | PASS | Depends on US-02 (verification pipeline produces results) |
| Outcome KPIs defined | PASS | 100% of evaluated intents include evidence context in evaluator prompt |

### DoR Status: PASSED

---

## US-05: Authorship Independence Check

| DoR Item | Status | Evidence/Issue |
|----------|--------|----------------|
| Problem statement clear | PASS | Agent can author its own evidence then cite it; self-referencing loop |
| User/persona identified | PASS | Ravi (preventing fabrication) + Security auditor (authorship independence) |
| 3+ domain examples | PASS | 3 examples: mixed authorship passes, all self-authored fails, agent-confirmed counts |
| UAT scenarios (3-7) | PASS | 4 scenarios: sufficient independent, self-referencing fails, agent-confirmed valid, low-risk exempt |
| AC derived from UAT | PASS | 6 ACs covering resolution, medium/high thresholds, low exempt, agent counts, warnings |
| Right-sized | PASS | ~2 days: author resolution query + independence logic + tiered thresholds |
| Technical notes | PASS | Author field resolution per entity type, verification query extension |
| Dependencies tracked | PASS | Depends on US-02 (verification pipeline) + US-07 (risk tiers) |
| Outcome KPIs defined | PASS | 100% high-risk intents under hard enforcement have 2+ independent refs |

### DoR Status: PASSED

---

## US-06: Minimum Evidence Age and Hard Enforcement

| DoR Item | Status | Evidence/Issue |
|----------|--------|----------------|
| Problem statement clear | PASS | Timing exploit (create-and-reference); no hard stop for clearly insufficient evidence |
| User/persona identified | PASS | Ravi (timing exploits, hard enforcement) + Agents (clear rejection messages) |
| 3+ domain examples | PASS | 3 examples: timing attack blocked, hard enforcement rejects, maturity auto-transition |
| UAT scenarios (3-7) | PASS | 3 scenarios: min age warning, hard rejection, auto-transition |
| AC derived from UAT | PASS | 7 ACs covering min age, hard rejection, error reason, threshold, auto-transition, lazy eval |
| Right-sized | PASS | ~2 days: age check + hard enforcement gate + maturity transition logic |
| Technical notes | PASS | Age calculation, pre-LLM check, lazy maturity evaluation, workspace update |
| Dependencies tracked | PASS | Depends on US-02 (pipeline), US-03 (enforcement mode), US-07 (tier requirements) |
| Outcome KPIs defined | PASS | 100% insufficient intents rejected pre-LLM under hard enforcement |

### DoR Status: PASSED

---

## US-07: Risk-Tiered Evidence Requirements

| DoR Item | Status | Evidence/Issue |
|----------|--------|----------------|
| Problem statement clear | PASS | One-size-fits-all either over-burdens low-risk or under-protects high-risk |
| User/persona identified | PASS | Ravi (proportionate security) + Agents (predictable expectations) |
| 3+ domain examples | PASS | 3 examples: low-risk minimal, medium-risk needs decision/task, high-risk multiple types |
| UAT scenarios (3-7) | PASS | 3 scenarios: low-risk met, medium needs types, high fails missing types |
| AC derived from UAT | PASS | 6 ACs covering tier definitions, type requirements, configurability, score basis |
| Right-sized | PASS | ~1.5 days: tier constants + type checking in verification + configurable overrides |
| Technical notes | PASS | Tier thresholds match existing router, entity type in verification query, policy override |
| Dependencies tracked | PASS | Depends on US-02 (pipeline), US-03 (enforcement mode) |
| Outcome KPIs defined | PASS | >95% tier compliance rate for legitimate intents |

### DoR Status: PASSED

---

## US-08: Governance Feed Evidence Chain Display

| DoR Item | Status | Evidence/Issue |
|----------|--------|----------------|
| Problem statement clear | PASS | Evidence verification happens behind scenes; invisible to human reviewer |
| User/persona identified | PASS | Ravi (making veto decisions with evidence context) |
| 3+ domain examples | PASS | 3 examples: all verified, partial failure, zero evidence warning |
| UAT scenarios (3-7) | PASS | 4 scenarios: verified chain, failed highlighted, navigation, zero evidence |
| AC derived from UAT | PASS | 6 ACs covering display, indicators, summary, navigation, warning, lazy loading |
| Right-sized | PASS | ~2 days: feed card component + evidence section + entity navigation |
| Technical notes | PASS | Entity title join, existing routes for navigation, lazy loading consideration |
| Dependencies tracked | PASS | Depends on US-04 (verification result stored on intent) |
| Outcome KPIs defined | PASS | 80%+ veto-window intents reviewed with evidence context |

### DoR Status: PASSED

---

## US-09: Workspace Bootstrapping and Enforcement Transitions

| DoR Item | Status | Evidence/Issue |
|----------|--------|----------------|
| Problem statement clear | PASS | Evidence requirements block new workspace with zero graph state |
| User/persona identified | PASS | Ravi (new workspace setup) + Agents (operating before evidence pool exists) |
| 3+ domain examples | PASS | 3 examples: bootstrap mode, first decision triggers soft, maturity triggers hard |
| UAT scenarios (3-7) | PASS | 5 scenarios: bootstrap default, soft transition, hard transition, exemption logging, manual override |
| AC derived from UAT | PASS | 7 ACs covering default, transitions, logging, override, configurability, lazy checks |
| Right-sized | PASS | ~2 days: workspace defaults + transition logic + admin override + logging |
| Technical notes | PASS | Event trigger or lazy check, workspace API, default threshold values |
| Dependencies tracked | PASS | Depends on US-03 (enforcement mode field) |
| Outcome KPIs defined | PASS | 100% new workspaces reach soft enforcement within 48 hours |

### DoR Status: PASSED

---

## US-10: Policy Evidence Rules and Observer Anomaly Detection

| DoR Item | Status | Evidence/Issue |
|----------|--------|----------------|
| Problem statement clear | PASS | Default tiers insufficient for specific action types; no anomaly detection for fabrication |
| User/persona identified | PASS | Ravi (custom rules) + Observer (anomaly detection) |
| 3+ domain examples | PASS | 3 examples: custom refund policy, Observer spam detection, deployment override |
| UAT scenarios (3-7) | PASS | 3 scenarios: custom policy, override default, anomaly detection |
| AC derived from UAT | PASS | 6 ACs covering rule type, selector, override, scan pattern, observation type |
| Right-sized | PASS | ~3 days: policy rule type + selector integration + Observer scan pattern |
| Technical notes | PASS | PolicyRule extension, policy gate integration, Observer scan, schema migration |
| Dependencies tracked | PASS | Depends on US-07 (tier requirements to override), existing policy and Observer systems |
| Outcome KPIs defined | PASS | At least 1 custom evidence policy per workspace with high-risk actions |

### DoR Status: PASSED

---

## Summary

| Story | DoR Status | Estimated Effort | Dependencies |
|-------|------------|-----------------|--------------|
| US-01 | PASSED | 1 day | None |
| US-02 | PASSED | 2 days | US-01 |
| US-03 | PASSED | 1.5 days | US-02 |
| US-04 | PASSED | 1 day | US-02 |
| US-05 | PASSED | 2 days | US-02, US-07 |
| US-06 | PASSED | 2 days | US-02, US-03, US-07 |
| US-07 | PASSED | 1.5 days | US-02, US-03 |
| US-08 | PASSED | 2 days | US-04 |
| US-09 | PASSED | 2 days | US-03 |
| US-10 | PASSED | 3 days | US-07, existing policy + Observer |

**Total estimated effort**: ~18 days across 4 releases.

All 10 stories pass the 9-item DoR gate. Ready for DESIGN wave handoff.
