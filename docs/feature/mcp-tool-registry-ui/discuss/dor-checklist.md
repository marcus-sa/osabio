# Definition of Ready -- Tool Registry UI

## Summary

12 stories validated. All pass DoR. Ready for DESIGN wave handoff.

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

## US-UI-09: MCP Server Connection

| DoR Item | Status | Evidence |
|----------|--------|---------|
| Problem statement clear | PASS | "Every mcp_tool must be created manually with exact JSON schemas -- tedious, error-prone, does not scale for 20+ tools" |
| User/persona identified | PASS | Priya Sharma, DevOps lead, workspace admin managing MCP integrations |
| 3+ domain examples | PASS | 3 examples: unauthenticated server, authenticated server with credential provider, connection failure |
| UAT scenarios (3-7) | PASS | 5 scenarios: unauthenticated, authenticated, failure, transport fallback, duplicate name |
| AC derived from UAT | PASS | 7 acceptance criteria (AC-09a through AC-09g) |
| Right-sized (1-3 days) | PASS | 2 days; Add MCP Server dialog + transport selection + credential linking + error handling |
| Technical notes | PASS | mcp_server migration, MCP client module, transport auto-detect, credential injection, ADR-070 |
| Dependencies tracked | PASS | Depends on: MCP client module (mcp-client.ts), mcp_server table migration, US-UI-01 (page shell) |
| Outcome KPIs defined | PASS | Under 30 seconds per server connection |

### DoR Status: PASSED

---

## US-UI-10: Tool Discovery and Import

| DoR Item | Status | Evidence |
|----------|--------|---------|
| Problem statement clear | PASS | "Admin must manually inspect tools/list response and create each mcp_tool by hand -- copying names, descriptions, JSON schemas one at a time" |
| User/persona identified | PASS | Priya Sharma, workspace admin, needs to onboard tools from 20+ tool servers |
| 3+ domain examples | PASS | 3 examples: first discovery (all new), re-sync with changes, server removed tools |
| UAT scenarios (3-7) | PASS | 5 scenarios: first discovery, selective import, re-sync diff, risk inference, risk override |
| AC derived from UAT | PASS | 8 acceptance criteria (AC-10a through AC-10h) |
| Right-sized (1-3 days) | PASS | 3 days; discovery dry-run + review panel + selective import + risk inference + re-sync diff |
| Technical notes | PASS | Discovery service, sync algorithm, risk inference from MCP annotations, source_server linking |
| Dependencies tracked | PASS | Depends on: US-UI-09 (server must be connected), discovery service (discovery.ts) |
| Outcome KPIs defined | PASS | Under 2 minutes for 20+ tools (vs 30+ minutes manually) |

### DoR Status: PASSED

---

## US-UI-11: Tool Execution via Proxy

| DoR Item | Status | Evidence |
|----------|--------|---------|
| Problem statement clear | PASS | "Proxy classifies tool calls as 'integration' but has no executor -- tool calls silently dropped, agent gets no result, conversation stalls" |
| User/persona identified | PASS | Proxy pipeline (automated); affects coding-agent-1, review-agent, and all agents using injected tools |
| 3+ domain examples | PASS | 3 examples: single tool call, multi-turn loop, execution failure with graceful degradation |
| UAT scenarios (3-7) | PASS | 5 scenarios: single execution, multi-turn loop, server unreachable, credential injection, OAuth2 refresh |
| AC derived from UAT | PASS | 8 acceptance criteria (AC-11a through AC-11h) |
| Right-sized (1-3 days) | PASS | 3 days; tool executor module + credential injection + OAuth2 refresh + multi-turn loop + error handling |
| Technical notes | PASS | tool-executor.ts, MCP client reuse, credential resolution chain, multi-turn safety limit, ADR-070 on-demand |
| Dependencies tracked | PASS | Depends on: MCP client module, credential brokerage (existing), mcp_server records, tool-router.ts classification |
| Outcome KPIs defined | PASS | 95% tool call success rate (excluding upstream failures) |

### DoR Status: PASSED

---

## US-UI-12: MCP Server Management

| DoR Item | Status | Evidence |
|----------|--------|---------|
| Problem statement clear | PASS | "No way to know if a server went offline, when tools were last synced, or how to clean up decommissioned servers" |
| User/persona identified | PASS | Priya Sharma, workspace admin, managing multiple MCP server connections over time |
| 3+ domain examples | PASS | 3 examples: view status dashboard, remove decommissioned server, disconnect without removing |
| UAT scenarios (3-7) | PASS | 4 scenarios: view server list, remove + disable tools, re-sync, empty state |
| AC derived from UAT | PASS | 7 acceptance criteria (AC-12a through AC-12g) |
| Right-sized (1-3 days) | PASS | 1-2 days; server list + status indicators + remove with tool disable + empty state |
| Technical notes | PASS | mcp-servers API endpoints, relative time display, collapsible section in Tools tab per ADR-070 |
| Dependencies tracked | PASS | Depends on: US-UI-09 (servers must exist to manage), US-UI-01 (page shell) |
| Outcome KPIs defined | PASS | 100% self-service server management via UI |

### DoR Status: PASSED

---

## Overall Assessment

All 12 stories pass all 9 DoR items. Feature is ready for handoff to DESIGN wave.

| Story | Size | Release | DoR |
|-------|------|---------|-----|
| US-UI-01 | S (1d) | Walking Skeleton | PASSED |
| US-UI-02 | M (2d) | Walking Skeleton | PASSED |
| US-UI-03 | M (2d) | Walking Skeleton | PASSED |
| US-UI-04 | S (1d) | Walking Skeleton | PASSED |
| US-UI-05 | M (2d) | Walking Skeleton | PASSED |
| US-UI-11 | L (3d) | Walking Skeleton | PASSED |
| US-UI-09 | M (2d) | Release 1: Discovery | PASSED |
| US-UI-10 | L (3d) | Release 1: Discovery | PASSED |
| US-UI-12 | S (1-2d) | Release 1: Discovery | PASSED |
| US-UI-06 | M (2d) | Release 2: Core CRUD | PASSED |
| US-UI-07 | M (2d) | Release 2: Core CRUD | PASSED |
| US-UI-08 | S (1-2d) | Release 3: Governance | PASSED |

Total estimated effort: 22-26 days across 4 releases (walking skeleton + 3 releases).

---

## Changed Assumptions

### What changed (revision 2, 2026-03-23)

**4 new stories validated**: US-UI-09 (MCP Server Connection), US-UI-10 (Tool Discovery), US-UI-11 (Tool Execution), US-UI-12 (MCP Server Management). All pass DoR.

**US-UI-11 in walking skeleton**: Tool Execution is classified as walking skeleton because without it, injected tools are non-functional.

**Release assignment updated**: US-UI-09, 10, 12 are Release 1 (Discovery Pipeline). US-UI-06, 07 moved from Release 1 to Release 2 (Core CRUD).

**Total effort increased**: From 12-14 days to 22-26 days due to 4 additional stories.
