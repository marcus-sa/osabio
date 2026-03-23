# Prioritization: Tool Registry UI

## Release Priority

| Priority | Release | Target Outcome | KPI | Rationale |
|----------|---------|---------------|-----|-----------|
| 1 | Walking Skeleton | Admin sets up integration + agent executes tool end-to-end | First successful tool execution via proxy | Validates the entire pipeline: setup -> injection -> execution -> result |
| 2 | Release 1: Discovery Pipeline | Admin imports tools from MCP servers automatically | Time to onboard new MCP server < 3 min | Eliminates manual tool creation bottleneck (5+ min per tool, 20+ tools per server) |
| 3 | Release 2: Core UI CRUD | Admin fully manages providers + members connect/revoke via UI | % of provider management via UI vs API | Eliminates raw API calls for common operations |
| 4 | Release 3: Access Governance | Admin has full visibility into who can use what | Admin can audit all access without DB queries | Addresses J1 anxiety: "What if an agent makes calls I didn't authorize?" |

## Backlog Suggestions

| Story | Release | Priority | Outcome Link | Dependencies |
|-------|---------|----------|-------------|--------------|
| US-UI-01: Page Shell + Navigation | WS | P1 | Navigation | None |
| US-UI-02: Browse Tools | WS | P1 | Tool visibility | US-UI-01 |
| US-UI-03: Register Provider | WS | P1 | Provider setup | US-UI-01 |
| US-UI-04: Connect Account (Static) | WS | P1 | Account connection | US-UI-03 |
| US-UI-05: Grant Tool Access | WS | P1 | Access management | US-UI-01, US-UI-02 |
| US-UI-11: Tool Execution via Proxy | WS | P1 | Tool execution | MCP client module, mcp_server records |
| US-UI-09: MCP Server Connection | R1 | P2 | Server onboarding | US-UI-01, MCP client module |
| US-UI-10: Tool Discovery + Import | R1 | P2 | Automated tool import | US-UI-09 |
| US-UI-12: MCP Server Management | R1 | P2 | Server monitoring | US-UI-09 |
| US-UI-06: Connect Account (OAuth2) | R2 | P3 | Full connection flow | US-UI-03 |
| US-UI-07: Connected Accounts Dashboard | R2 | P3 | Account visibility | US-UI-04 |
| US-UI-08: Tool Governance UI | R3 | P4 | Governance | US-UI-02 |

> **Note**: US-UI-11 (Tool Execution) has no UI component but is critical infrastructure. It was promoted to the walking skeleton because without it, injected tools are non-functional.

## Value/Effort Matrix

| | Low Effort (1-2 days) | High Effort (3+ days) |
|---|---|---|
| **Critical Value** | US-UI-01 (shell), US-UI-02 (browse), US-UI-05 (grants) | US-UI-11 (tool execution) |
| **High Value** | US-UI-04 (static connect), US-UI-09 (server connect) | US-UI-10 (discovery), US-UI-06 (OAuth2 flow) |
| **Medium Value** | US-UI-12 (server mgmt), US-UI-07 (dashboard) | US-UI-03 (provider form) |
| **Lower Value** | US-UI-08 (governance) | -- |

**Priority order**: Walking skeleton stories first (critical value). Then discovery pipeline (high value, eliminates biggest manual bottleneck). Then UI CRUD polish (medium value, APIs already work). Governance last (lower value, already partially available via Policies page).

## Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| MCP server connection failures in production | Medium | High | Transport auto-detect, clear error messages, server saved with error status |
| OAuth2 token refresh race conditions | Low | Medium | Atomic token update in connected_account, retry on 401 |
| Tool execution latency exceeds user expectations | Medium | Medium | Connect-per-call is simple; add connection pooling in future release if needed |
| SSRF via admin-provided MCP server URLs | Low | High | URL validation (http/https only), network-level restrictions in production |
| Multi-turn loop exceeds safety limit | Low | Medium | Max 10 iterations with descriptive error to user |

---

## Changed Assumptions

### What changed (revision 2, 2026-03-23)

**Walking skeleton expanded**: US-UI-11 (Tool Execution) added to walking skeleton. Without it, the feature is non-functional even with all UI stories complete.

**Release order changed**: Discovery Pipeline (US-UI-09, 10, 12) is now Release 1 (was Release 3). Core UI CRUD (US-UI-06, 07) is now Release 2 (was Release 1). Rationale: manual tool creation is the worst bottleneck; UI polish for existing APIs is less urgent.

**Value matrix restructured**: "Critical Value" tier added above "High Value" to distinguish foundational stories (without which nothing works) from valuable enhancements.

**Risk assessment added**: Five risks identified covering MCP connectivity, OAuth2 token management, latency, SSRF, and multi-turn loop safety.
