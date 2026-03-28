# Definition of Ready Validation: Agent Management

## US-01: View Agent Registry

| DoR Item | Status | Evidence/Issue |
|----------|--------|----------------|
| Problem statement clear | PASS | Elena cannot see agents without DB queries; domain language used |
| User/persona identified | PASS | Workspace admin at manufacturing company with specific fleet size |
| 3+ domain examples | PASS | 3 examples: full registry, single-runtime, brand new workspace |
| UAT scenarios (3-7) | PASS | 3 scenarios covering registry view, empty state, count display |
| AC derived from UAT | PASS | 7 AC items, each traceable to scenarios |
| Right-sized | PASS | 2 days effort, 3 scenarios, single page rendering |
| Technical notes | PASS | Graph traversal pattern, schema dependency documented |
| Dependencies tracked | PASS | Schema migration (runtime field) identified |
| Outcome KPIs defined | PASS | KPI-1: 100% visibility via UI |

### DoR Status: PASSED

---

## US-02: Create External Agent with Authority Scopes

| DoR Item | Status | Evidence/Issue |
|----------|--------|----------------|
| Problem statement clear | PASS | Rafael must manipulate DB directly to register agents; 15-min pain |
| User/persona identified | PASS | Developer building Vercel AI SDK agents at manufacturing company |
| 3+ domain examples | PASS | 4 examples: happy path, minimal, duplicate name, transaction failure |
| UAT scenarios (3-7) | PASS | 4 scenarios covering creation, duplicate, rollback, defaults |
| AC derived from UAT | PASS | 7 AC items, each from scenario outcomes |
| Right-sized | PASS | 3 days effort, 4 scenarios |
| Technical notes | PASS | Transaction atomicity, token format, hash storage documented |
| Dependencies tracked | PASS | US-01, authority_scope table, proxy_token table |
| Outcome KPIs defined | PASS | KPI-2: under 2 min creation time |

### DoR Status: PASSED

---

## US-03: View Agent Detail Page

| DoR Item | Status | Evidence/Issue |
|----------|--------|----------------|
| Problem statement clear | PASS | Configuration scattered across DB tables, not surfaced in UI |
| User/persona identified | PASS | Workspace admin needing per-agent visibility |
| 3+ domain examples | PASS | 3 examples: sandbox detail, external detail, brain read-only |
| UAT scenarios (3-7) | PASS | 3 scenarios |
| AC derived from UAT | PASS | 5 AC items |
| Right-sized | PASS | 2 days effort, 3 scenarios |
| Technical notes | PASS | Batched query pattern, session list migration documented |
| Dependencies tracked | PASS | US-01 |
| Outcome KPIs defined | PASS | KPI-5: review time under 10 seconds |

### DoR Status: PASSED

---

## US-04: Delete Agent with Confirmation

| DoR Item | Status | Evidence/Issue |
|----------|--------|----------------|
| Problem statement clear | PASS | Multi-record deletion requires manual DB cleanup, risk of orphaned records |
| User/persona identified | PASS | Workspace admin decommissioning agents |
| 3+ domain examples | PASS | 3 examples: clean delete, active sessions, brain agent |
| UAT scenarios (3-7) | PASS | 3 scenarios |
| AC derived from UAT | PASS | 6 AC items |
| Right-sized | PASS | 2 days effort, 3 scenarios |
| Technical notes | PASS | Transactional deletion, session preservation for audit |
| Dependencies tracked | PASS | US-01, US-03 |
| Outcome KPIs defined | PASS | KPI-3: under 30 seconds |

### DoR Status: PASSED

---

## US-05: Create Sandbox Agent with Configuration

| DoR Item | Status | Evidence/Issue |
|----------|--------|----------------|
| Problem statement clear | PASS | Sandbox agent creation requires developer intervention and code changes |
| User/persona identified | PASS | Workspace admin deploying automated demand forecasting |
| 3+ domain examples | PASS | 3 examples: full config, minimal, provider not configured |
| UAT scenarios (3-7) | PASS | 3 scenarios |
| AC derived from UAT | PASS | 6 AC items |
| Right-sized | PASS | 3 days effort, 3 scenarios (extends US-02 infrastructure) |
| Technical notes | PASS | Sandbox config fields, provider validation, dependency on US-02 |
| Dependencies tracked | PASS | US-02, workspace sandbox_provider config |
| Outcome KPIs defined | PASS | KPI-2: under 5 minutes setup |

### DoR Status: PASSED

---

## US-06: Filter Agents by Runtime Type

| DoR Item | Status | Evidence/Issue |
|----------|--------|----------------|
| Problem statement clear | PASS | Scanning full registry is slow for 12+ agents |
| User/persona identified | PASS | Workspace admin wanting to focus on sandbox agents |
| 3+ domain examples | PASS | 3 examples: filter sandbox, clear filter, empty filter |
| UAT scenarios (3-7) | PASS | 3 scenarios |
| AC derived from UAT | PASS | 5 AC items |
| Right-sized | PASS | 1 day effort, 3 scenarios, client-side only |
| Technical notes | PASS | Client-side filtering, no API needed |
| Dependencies tracked | PASS | US-01 |
| Outcome KPIs defined | PASS | KPI-1: agent location under 2 seconds |

### DoR Status: PASSED

---

## US-07: Spawn Sandbox Session from Agent Detail

| DoR Item | Status | Evidence/Issue |
|----------|--------|----------------|
| Problem statement clear | PASS | Spawning requires navigating away from agent context |
| User/persona identified | PASS | Workspace admin starting QC batch inspection |
| 3+ domain examples | PASS | 3 examples: spawn with task, spawn without, spawn failure |
| UAT scenarios (3-7) | PASS | 3 scenarios |
| AC derived from UAT | PASS | 5 AC items |
| Right-sized | PASS | 2 days effort, 3 scenarios |
| Technical notes | PASS | Reuses orchestrator endpoint, config from agent record |
| Dependencies tracked | PASS | US-05, US-08, orchestrator spawn endpoint |
| Outcome KPIs defined | PASS | KPI-4: under 10 seconds |

### DoR Status: PASSED

---

## US-08: View Session List on Agent Detail

| DoR Item | Status | Evidence/Issue |
|----------|--------|----------------|
| Problem statement clear | PASS | Session info only in orchestrator, not agent context |
| User/persona identified | PASS | Workspace admin monitoring production QC run |
| 3+ domain examples | PASS | 3 examples: mixed sessions, new agent, error session |
| UAT scenarios (3-7) | PASS | 3 scenarios |
| AC derived from UAT | PASS | 6 AC items |
| Right-sized | PASS | 2 days effort, 3 scenarios |
| Technical notes | PASS | agent_session query, field migration documented |
| Dependencies tracked | PASS | US-03, agent_session.agent field migration |
| Outcome KPIs defined | PASS | KPI-5: under 5 seconds |

### DoR Status: PASSED

---

## US-09: Edit Agent Configuration and Authority Scopes

| DoR Item | Status | Evidence/Issue |
|----------|--------|----------------|
| Problem statement clear | PASS | No way to modify agent config after creation without DB |
| User/persona identified | PASS | Workspace admin adjusting QC Inspector authority |
| 3+ domain examples | PASS | 3 examples: edit scope, add env var, rename agent |
| UAT scenarios (3-7) | PASS | 4 scenarios |
| AC derived from UAT | PASS | 6 AC items |
| Right-sized | PASS | 3 days effort, 4 scenarios |
| Technical notes | PASS | Edge delete/recreate pattern, name sync, active session behavior |
| Dependencies tracked | PASS | US-02/US-05, US-03 |
| Outcome KPIs defined | PASS | KPI-3: under 1 minute |

### DoR Status: PASSED

---

## US-10: Resume or Send Feedback to Idle Sessions

| DoR Item | Status | Evidence/Issue |
|----------|--------|----------------|
| Problem statement clear | PASS | Must leave agent context to respond to idle sessions |
| User/persona identified | PASS | Workspace admin responding to QC anomaly review |
| 3+ domain examples | PASS | 3 examples: send feedback, resume, no idle sessions |
| UAT scenarios (3-7) | PASS | 3 scenarios |
| AC derived from UAT | PASS | 4 AC items |
| Right-sized | PASS | 1 day effort, 3 scenarios |
| Technical notes | PASS | Reuses orchestrator feedback endpoint |
| Dependencies tracked | PASS | US-08 |
| Outcome KPIs defined | PASS | KPI-6: under 15 seconds |

### DoR Status: PASSED

---

## US-11: View External Agent Connection Status

| DoR Item | Status | Evidence/Issue |
|----------|--------|----------------|
| Problem statement clear | PASS | No visibility into external agent connectivity |
| User/persona identified | PASS | Developer checking Compliance Bot connection |
| 3+ domain examples | PASS | 3 examples: online, offline, never connected |
| UAT scenarios (3-7) | PASS | 3 scenarios |
| AC derived from UAT | PASS | 4 AC items |
| Right-sized | PASS | 1 day effort, 3 scenarios |
| Technical notes | PASS | Derived from proxy/trace records, threshold configurable |
| Dependencies tracked | PASS | US-03, proxy session tracking |
| Outcome KPIs defined | PASS | KPI-5: under 3 seconds |

### DoR Status: PASSED

---

## US-12: Delete Agent with Active Session Warning

| DoR Item | Status | Evidence/Issue |
|----------|--------|----------------|
| Problem statement clear | PASS | Uncertain impact on in-progress sessions during deletion |
| User/persona identified | PASS | Workspace admin decommissioning agent with active work |
| 3+ domain examples | PASS | 3 examples: active sessions, mixed sessions, cancel |
| UAT scenarios (3-7) | PASS | 3 scenarios |
| AC derived from UAT | PASS | 5 AC items |
| Right-sized | PASS | 1 day effort, 3 scenarios (extends US-04) |
| Technical notes | PASS | Session termination via orchestrator abort |
| Dependencies tracked | PASS | US-04, US-08 |
| Outcome KPIs defined | PASS | KPI-3: zero accidental terminations |

### DoR Status: PASSED

---

## US-13: Empty States for Agent Sections

| DoR Item | Status | Evidence/Issue |
|----------|--------|----------------|
| Problem statement clear | PASS | Blank sections confuse new users with no guidance |
| User/persona identified | PASS | Developer in new workspace |
| 3+ domain examples | PASS | 3 examples: sandbox empty, external empty, both empty |
| UAT scenarios (3-7) | PASS | 3 scenarios |
| AC derived from UAT | PASS | 4 AC items |
| Right-sized | PASS | 1 day effort, 3 scenarios |
| Technical notes | PASS | Client-side rendering, CTA passes runtime to creation |
| Dependencies tracked | PASS | US-01 |
| Outcome KPIs defined | PASS | KPI-7: 60% first-agent rate |

### DoR Status: PASSED

---

## Summary

| Story | DoR Status | Scenarios | Estimated Days |
|-------|-----------|-----------|----------------|
| US-01 | PASSED | 3 | 2 |
| US-02 | PASSED | 4 | 3 |
| US-03 | PASSED | 3 | 2 |
| US-04 | PASSED | 3 | 2 |
| US-05 | PASSED | 3 | 3 |
| US-06 | PASSED | 3 | 1 |
| US-07 | PASSED | 3 | 2 |
| US-08 | PASSED | 3 | 2 |
| US-09 | PASSED | 4 | 3 |
| US-10 | PASSED | 3 | 1 |
| US-11 | PASSED | 3 | 1 |
| US-12 | PASSED | 3 | 1 |
| US-13 | PASSED | 3 | 1 |
| **Total** | **13/13 PASSED** | **41** | **24** |

All 13 stories pass the 9-item DoR gate. Ready for DESIGN wave handoff.
