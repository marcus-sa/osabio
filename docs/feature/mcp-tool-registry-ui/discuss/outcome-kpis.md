# Outcome KPIs -- Tool Registry UI

## Feature: mcp-tool-registry-ui

### Objective
Workspace admins and members manage integration tools, providers, accounts, and access entirely through the Brain web UI -- and those tools work end-to-end when agents use them -- eliminating manual API calls, manual tool creation, and silent tool execution failures.

### Outcome KPIs

| # | Who | Does What | By How Much | Baseline | Measured By | Type |
|---|-----|-----------|-------------|----------|-------------|------|
| 1 | Workspace admins | Register credential providers via UI instead of API calls | 90% of provider registrations via UI | 0% (no UI) | Provider creation source tracking (UI vs API) | Leading |
| 2 | Workspace members | Connect accounts (OAuth2/static) via UI | 80% of account connections via UI within 30 days | 0% (no UI) | Connected account creation source | Leading |
| 3 | Workspace admins | Find and audit tool access without database queries | 100% self-service (zero DB queries for access audit) | 100% DB-dependent | Admin survey / DB query log reduction | Leading |
| 4 | Workspace members | Identify and resolve expired accounts without admin help | 90% of reconnections done self-service | 0% (requires admin) | Reconnect action source tracking | Leading |
| 5 | Workspace admins | Time to set up a new integration (provider + tools + grants) | Under 5 minutes end-to-end | 15+ minutes via API | Time-to-completion tracking | Leading |
| 6 | Agents (via proxy) | Successfully execute integration tool calls end-to-end | 95% tool call success rate (excluding upstream failures) | 0% (tool calls classified but never executed) | Proxy trace: tool_use -> tool_result completion rate | Leading |
| 7 | Workspace admins | Import tools from MCP servers without manual JSON creation | Under 2 minutes for 20+ tools | 30+ minutes (manual creation per tool) | Time from "Discover" click to tools in registry | Leading |
| 8 | Workspace admins | Onboard a new MCP server (connect + discover + import) | Under 3 minutes total | No capability exists | Time from "Add MCP Server" to tools available | Leading |

### Metric Hierarchy

- **North Star**: % of integration tool calls that execute successfully end-to-end (KPI #6)
- **Leading Indicators**:
  - Provider registrations via UI (KPI #1)
  - Account connections via UI (KPI #2)
  - Tool discovery imports (KPI #7)
  - MCP server onboarding time (KPI #8)
  - Grant management via UI
  - Revoke/reconnect actions via UI (KPI #4)
- **Guardrail Metrics**:
  - Page load time must stay under 1 second
  - Tool execution proxy overhead under 500ms (excluding MCP server response time)
  - Zero credential leaks in API responses (already enforced by backend)
  - Accessibility: all actions completable via keyboard
  - MCP server connection timeout under 10 seconds

### Measurement Plan

| KPI | Data Source | Collection Method | Frequency | Owner |
|-----|------------|-------------------|-----------|-------|
| Provider creation source | API request headers | User-Agent or source param | Per event | Backend |
| Account connection source | API request headers | User-Agent or source param | Per event | Backend |
| Self-service audit actions | UI analytics | Page view + filter/search events | Weekly | Frontend |
| Time to completion | UI analytics | Timestamp deltas (start to success) | Weekly | Frontend |
| Page load time | Browser performance API | Lighthouse or RUM | Weekly | Frontend |
| Tool execution success rate | Proxy trace logs | tool_use classification -> tool_result completion | Per event | Proxy |
| Tool execution latency | Proxy trace spans | Span duration for tool executor step | Per event | Proxy |
| Discovery import time | Backend logs | Timestamp from discover request to sync completion | Per event | Backend |
| MCP server connection success | mcp_server.last_status | Status field on mcp_server records | Per event | Backend |

### Hypothesis
We believe that providing a Tool Registry UI with end-to-end tool execution, automated discovery, and self-service management will achieve functional integration management. We will know this is true when:
- 95%+ of integration tool calls execute successfully (KPI #6)
- 80%+ of provider registrations and account connections happen through the UI within 30 days (KPIs #1, #2)
- New MCP server onboarding takes under 3 minutes (KPI #8)

---

## Changed Assumptions

### What changed (revision 2, 2026-03-23)

**North Star metric changed**: Previously "% of integration management actions performed via UI." Now "% of integration tool calls that execute successfully end-to-end." Rationale: the UI is a means to an end -- the real outcome is that agents can use integration tools. If tool execution fails, the UI is useless regardless of adoption rate.

**3 new KPIs added**:
- KPI #6 (tool execution success rate): the most critical new metric. Baseline is 0% because tool calls are currently silently dropped.
- KPI #7 (discovery import time): measures the value of automated tool import vs manual creation.
- KPI #8 (MCP server onboarding time): measures the end-to-end server onboarding experience.

**Guardrail metrics expanded**: Added tool execution proxy overhead (under 500ms) and MCP server connection timeout (under 10 seconds).

**Measurement plan expanded**: Added proxy trace log collection for tool execution metrics and backend logs for discovery timing.
