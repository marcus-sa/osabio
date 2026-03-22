# Definition of Ready -- Tool Registry UI

## Summary

8 stories validated. All pass DoR. Ready for DESIGN wave handoff.

---

## US-UI-01: Page Shell and Navigation

| DoR Item | Status | Evidence |
|----------|--------|---------|
| Problem statement clear | PASS | "Priya must use raw API calls to manage integrations; tedious context-switching between UI and terminal" |
| User/persona identified | PASS | Priya Sharma, DevOps lead, 6-person team, workspace admin |
| 3+ domain examples | PASS | 3 examples: first visit empty state, returning admin with tools, member view |
| UAT scenarios (3-7) | PASS | 3 scenarios: sidebar nav, empty state, tab rendering |
| AC derived from UAT | PASS | 5 acceptance criteria derived from scenarios |
| Right-sized (1-3 days) | PASS | 1 day estimate; route + sidebar + tab shell + empty state |
| Technical notes | PASS | TanStack Router pattern, WorkspaceSidebar pattern, shadcn Tabs |
| Dependencies tracked | PASS | None -- first story in build order |
| Outcome KPIs defined | PASS | 95% find Tool Registry on first attempt |

### DoR Status: PASSED

---

## US-UI-02: Browse Tools

| DoR Item | Status | Evidence |
|----------|--------|---------|
| Problem statement clear | PASS | "Priya manages 15+ tools but can only view them via database queries" |
| User/persona identified | PASS | Priya Sharma, workspace admin, needs tool overview |
| 3+ domain examples | PASS | 3 examples: grouped tools, filter high-risk, search by name |
| UAT scenarios (3-7) | PASS | 4 scenarios: grouped display, filter risk, search, empty search |
| AC derived from UAT | PASS | 7 acceptance criteria |
| Right-sized (1-3 days) | PASS | 2 days; list component + grouping + filters + search |
| Technical notes | PASS | learnings-page pattern, grant_count subquery, badge colors |
| Dependencies tracked | PASS | Depends on US-UI-01 (page shell) |
| Outcome KPIs defined | PASS | Find tool under 10 seconds |

### DoR Status: PASSED

---

## US-UI-03: Register Credential Provider

| DoR Item | Status | Evidence |
|----------|--------|---------|
| Problem statement clear | PASS | "Priya must construct POST requests manually with correct JSON for each auth method" |
| User/persona identified | PASS | Priya Sharma, workspace admin |
| 3+ domain examples | PASS | 3 examples: OAuth2 provider, API key provider, duplicate rejection |
| UAT scenarios (3-7) | PASS | 4 scenarios: adaptive OAuth2, adaptive API key, success, duplicate |
| AC derived from UAT | PASS | 7 acceptance criteria |
| Right-sized (1-3 days) | PASS | 2 days; dialog + adaptive form + validation |
| Technical notes | PASS | CreatePolicyDialog pattern, existing registration endpoint, URL validation |
| Dependencies tracked | PASS | Depends on US-UI-01 |
| Outcome KPIs defined | PASS | Under 2 minutes per provider registration |

### DoR Status: PASSED

---

## US-UI-04: Connect Account (Static)

| DoR Item | Status | Evidence |
|----------|--------|---------|
| Problem statement clear | PASS | "Carlos has no secure UI path to provide API keys" |
| User/persona identified | PASS | Carlos Mendez, senior developer, daily agent user |
| 3+ domain examples | PASS | 3 examples: API key, basic auth, bearer token |
| UAT scenarios (3-7) | PASS | 4 scenarios: API key form, basic auth form, success, empty validation |
| AC derived from UAT | PASS | 6 acceptance criteria |
| Right-sized (1-3 days) | PASS | 1 day; dialog + 3 form variants + validation |
| Technical notes | PASS | Existing connection endpoint, AES-256-GCM server-side, one account per identity+provider |
| Dependencies tracked | PASS | Depends on US-UI-03 (providers must exist first) |
| Outcome KPIs defined | PASS | Under 30 seconds per connection |

### DoR Status: PASSED

---

## US-UI-05: Grant Tool Access

| DoR Item | Status | Evidence |
|----------|--------|---------|
| Problem statement clear | PASS | "Priya must construct RELATE queries to create can_use edges" |
| User/persona identified | PASS | Priya Sharma, workspace admin |
| 3+ domain examples | PASS | 3 examples: grant with rate limit, view grants, duplicate prevention |
| UAT scenarios (3-7) | PASS | 3 scenarios: grant access, view sources, duplicate rejection |
| AC derived from UAT | PASS | 5 acceptance criteria |
| Right-sized (1-3 days) | PASS | 2 days; access tab + grant dialog + grant list + cache invalidation |
| Technical notes | PASS | Identity API, tool grant endpoint, cross-tab cache invalidation |
| Dependencies tracked | PASS | Depends on US-UI-01 and US-UI-02 (tools must be browsable) |
| Outcome KPIs defined | PASS | Under 30 seconds per grant |

### DoR Status: PASSED

---

## US-UI-06: Connect Account (OAuth2)

| DoR Item | Status | Evidence |
|----------|--------|---------|
| Problem statement clear | PASS | "Carlos cannot initiate OAuth consent flow from UI; requires manual API orchestration" |
| User/persona identified | PASS | Carlos Mendez, senior developer |
| 3+ domain examples | PASS | 3 examples: successful GitHub OAuth, consent denied, token exchange failure |
| UAT scenarios (3-7) | PASS | 4 scenarios: pre-redirect, success, denial, exchange failure |
| AC derived from UAT | PASS | 5 acceptance criteria |
| Right-sized (1-3 days) | PASS | 2 days; pre-redirect dialog + redirect logic + callback handler |
| Technical notes | PASS | State param CSRF, backend generates auth URL, same-window redirect decision |
| Dependencies tracked | PASS | Depends on US-UI-03 (OAuth2 provider must be registered) |
| Outcome KPIs defined | PASS | Under 60 seconds from click to "Connected" |

### DoR Status: PASSED

---

## US-UI-07: Connected Accounts Dashboard

| DoR Item | Status | Evidence |
|----------|--------|---------|
| Problem statement clear | PASS | "Carlos has no visibility into which accounts are active/expired/revoked" |
| User/persona identified | PASS | Carlos Mendez, workspace member |
| 3+ domain examples | PASS | 3 examples: mixed-status view, revoke active, reconnect expired |
| UAT scenarios (3-7) | PASS | 4 scenarios: view accounts, revoke, reconnect, empty state |
| AC derived from UAT | PASS | 8 acceptance criteria |
| Right-sized (1-3 days) | PASS | 2 days; account list + status badges + revoke dialog + reconnect flow |
| Technical notes | PASS | Connected accounts endpoint, revocation endpoint, status badge colors |
| Dependencies tracked | PASS | Depends on US-UI-04 or US-UI-06 (accounts must exist to display) |
| Outcome KPIs defined | PASS | 90% self-service reconnections |

### DoR Status: PASSED

---

## US-UI-08: Tool Governance UI

| DoR Item | Status | Evidence |
|----------|--------|---------|
| Problem statement clear | PASS | "Priya must construct governs_tool edges via raw API calls" |
| User/persona identified | PASS | Priya Sharma, workspace admin |
| 3+ domain examples | PASS | 3 examples: attach approval policy, view governed tools, ungoverned tool |
| UAT scenarios (3-7) | PASS | 3 scenarios: attach policy, view details, active-only picker |
| AC derived from UAT | PASS | 5 acceptance criteria |
| Right-sized (1-3 days) | PASS | 1-2 days; governance dialog + indicator + detail view |
| Technical notes | PASS | Existing policies API, governs_tool endpoint, shield icon indicator |
| Dependencies tracked | PASS | Depends on US-UI-02 (tools tab must exist) and existing Policies feature |
| Outcome KPIs defined | PASS | Under 60 seconds per governance attachment |

### DoR Status: PASSED

---

## Overall Assessment

All 8 stories pass all 9 DoR items. Feature is ready for handoff to DESIGN wave.

| Story | Size | Release | DoR |
|-------|------|---------|-----|
| US-UI-01 | S (1d) | Walking Skeleton | PASSED |
| US-UI-02 | M (2d) | Walking Skeleton | PASSED |
| US-UI-03 | M (2d) | Walking Skeleton | PASSED |
| US-UI-04 | S (1d) | Walking Skeleton | PASSED |
| US-UI-05 | M (2d) | Walking Skeleton | PASSED |
| US-UI-06 | M (2d) | Release 1 | PASSED |
| US-UI-07 | M (2d) | Release 1 | PASSED |
| US-UI-08 | S (1-2d) | Release 2 | PASSED |

Total estimated effort: 12-14 days across 3 releases.
