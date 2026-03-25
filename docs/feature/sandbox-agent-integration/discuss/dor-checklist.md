# Definition of Ready Checklist: Sandbox Agent Integration

## US-01: Spawn Coding Agent via SandboxAgent SDK

| DoR Item | Status | Evidence/Issue |
|----------|--------|----------------|
| Problem statement clear | PASS | "Rafael finds it limiting that Brain can only run Claude Code via single-shot SDK with no real isolation" |
| User/persona identified | PASS | Rafael Torres, senior developer, daily coding agent user |
| 3+ domain examples | PASS | Happy path (local spawn), edge case (Docker provider), error (server unavailable) |
| UAT scenarios (3-7) | PASS | 4 scenarios: happy path, Docker, unavailable server, invalid agent type |
| AC derived from UAT | PASS | 5 criteria derived from scenarios |
| Right-sized | PASS | ~2 days effort, 4 scenarios |
| Technical notes | PASS | Files to modify, SDK dependency, worktree retention noted |
| Dependencies tracked | PASS | SandboxAgent SDK, Brain proxy, worktree manager -- all available |
| Outcome KPIs defined | PASS | 100% spawn success rate, measured by trace graph |

### DoR Status: PASSED

---

## US-02: SurrealDB Session Persistence Driver

| DoR Item | Status | Evidence/Issue |
|----------|--------|----------------|
| Problem statement clear | PASS | "Rafael loses all session state when Brain's server restarts because of in-memory handle registry" |
| User/persona identified | PASS | Rafael Torres, long-running coding sessions |
| 3+ domain examples | PASS | Real-time persistence, high-frequency burst, SurrealDB outage |
| UAT scenarios (3-7) | PASS | 4 scenarios: creation, ordering, status update, outage handling |
| AC derived from UAT | PASS | 5 criteria covering interface, schema, ordering, throughput, buffering |
| Right-sized | PASS | ~2-3 days effort, 4 scenarios |
| Technical notes | PASS | Schema extension, batch writes, 5 driver methods listed |
| Dependencies tracked | PASS | SurrealDB agent_session table (exists), SandboxAgent SDK interface (available) |
| Outcome KPIs defined | PASS | 100% event persistence, measured by event count comparison |

### DoR Status: PASSED

---

## US-03: Event Bridge for SandboxAgent Events

| DoR Item | Status | Evidence/Issue |
|----------|--------|----------------|
| Problem statement clear | PASS | "Event bridge tightly coupled to Claude Agent SDK format; SandboxAgent events not understood" |
| User/persona identified | PASS | Rafael Torres, monitors coding agent in real time |
| 3+ domain examples | PASS | Tool call, permission request, unknown event type |
| UAT scenarios (3-7) | PASS | 4 scenarios: tool call, file edit, permission, unknown event |
| AC derived from UAT | PASS | 5 criteria covering translation, latency, trace, permissions, unknown types |
| Right-sized | PASS | ~1-2 days effort, 4 scenarios |
| Technical notes | PASS | File to modify, event schema reference, real-time + pagination |
| Dependencies tracked | PASS | SSE registry (exists), trace graph (exists), US-01 (session exists) |
| Outcome KPIs defined | PASS | < 500ms event delivery latency |

### DoR Status: PASSED

---

## US-04: Multi-Turn Prompts via session.prompt()

| DoR Item | Status | Evidence/Issue |
|----------|--------|----------------|
| Problem statement clear | PASS | "POST .../prompt returns 409 because Claude Agent SDK does not support multi-turn" |
| User/persona identified | PASS | Rafael Torres, iterative coding workflow |
| 3+ domain examples | PASS | Follow-up refinement, concurrent prompt, concluded session |
| UAT scenarios (3-7) | PASS | 4 scenarios: follow-up, queued prompt, concluded session, 3+ chain |
| AC derived from UAT | PASS | 5 criteria covering prompt delivery, context, queuing, 404, chain length |
| Right-sized | PASS | ~1 day effort, 4 scenarios |
| Technical notes | PASS | Route handler, SDK method, queue semantics, context limits |
| Dependencies tracked | PASS | US-01 (session exists) |
| Outcome KPIs defined | PASS | 0% prompt rejection rate (from 100%) |

### DoR Status: PASSED

---

## US-05: Session Restoration from Persisted Events

| DoR Item | Status | Evidence/Issue |
|----------|--------|----------------|
| Problem statement clear | PASS | "Rafael loses 30-minute session when network drops; 10-15 minutes duplicated work per incident" |
| User/persona identified | PASS | Rafael Torres, long-running sessions (15-60 min) |
| 3+ domain examples | PASS | Network timeout, server restart, large session replay cap |
| UAT scenarios (3-7) | PASS | 4 scenarios: auto-restore, server restart, capped replay, provider unavailable |
| AC derived from UAT | PASS | 6 criteria covering auto-restore, restart, replay, limits, notification, success rate |
| Right-sized | PASS | ~2 days effort, 4 scenarios |
| Technical notes | PASS | SDK restoration mechanism, replay limits, US-02 dependency |
| Dependencies tracked | PASS | US-02 (persistence driver) is hard dependency |
| Outcome KPIs defined | PASS | > 95% restoration success rate |

### DoR Status: PASSED

---

## US-06: Dynamic MCP Endpoint per Agent Session

| DoR Item | Status | Evidence/Issue |
|----------|--------|----------------|
| Problem statement clear | PASS | "stdio MCP server requires bundling CLI in sandbox; does not work for Docker/E2B" |
| User/persona identified | PASS | Brain Orchestrator (internal system actor) |
| 3+ domain examples | PASS | Filtered tools/list, OAuth credential injection, policy rejection |
| UAT scenarios (3-7) | PASS | 4 scenarios: filtered list, credential injection, rejection, setMcpConfig |
| AC derived from UAT | PASS | 6 criteria covering endpoint, filtering, policy, credentials, rejection, config |
| Right-sized | PASS | ~3 days effort, 4 scenarios |
| Technical notes | PASS | #183 infrastructure, grant resolution logic, token auth pattern |
| Dependencies tracked | PASS | MCP tool registry #183 (exists), credential broker (exists) |
| Outcome KPIs defined | PASS | 100% MCP tool calls through policy evaluation |

### DoR Status: PASSED

---

## US-07: Permission Request Handling

| DoR Item | Status | Evidence/Issue |
|----------|--------|----------------|
| Problem statement clear | PASS | "No way to approve/reject individual permissions; bypassPermissions: true for everything" |
| User/persona identified | PASS | Rafael Torres, supervising coding agent execution |
| 3+ domain examples | PASS | Auto-approve in-scope, manual approve destructive, timeout |
| UAT scenarios (3-7) | PASS | 4 scenarios: auto-approve, manual approve, rejection, timeout |
| AC derived from UAT | PASS | 5 criteria covering UI surfacing, decision types, auto-approve, trace, timeout |
| Right-sized | PASS | ~2 days effort, 4 scenarios |
| Technical notes | PASS | SDK permission API, decision types, timeout config, SSE bridge |
| Dependencies tracked | PASS | US-01 (session), US-03 (event bridge) |
| Outcome KPIs defined | PASS | < 5 second average permission response time |

### DoR Status: PASSED

---

## Summary

| Story | DoR Status | Notes |
|-------|-----------|-------|
| US-01: Spawn via SandboxAgent | PASSED | Walking skeleton entry point |
| US-02: SurrealDB Persistence | PASSED | Prerequisite for US-05 |
| US-03: Event Bridge | PASSED | Depends on US-01 |
| US-04: Multi-Turn Prompts | PASSED | Depends on US-01; highest opportunity score |
| US-05: Session Restoration | PASSED | Depends on US-02 |
| US-06: Dynamic MCP Endpoint | PASSED | Release 2; depends on US-01 |
| US-07: Permission Handling | PASSED | Release 2; depends on US-01, US-03 |

All 7 stories pass Definition of Ready. Ready for DESIGN wave handoff.
