# Prioritization: Tool Registry UI

## Release Priority

| Priority | Release | Target Outcome | KPI | Rationale |
|----------|---------|---------------|-----|-----------|
| 1 | Walking Skeleton | Admin can set up provider + browse tools + grant access via UI | Time to first tool grant via UI < 5 min | Validates core admin workflow end-to-end |
| 2 | Release 1: Core CRUD | Admin fully manages providers; members connect + revoke accounts | % of provider management done via UI vs API | Eliminates raw API calls for common operations |
| 3 | Release 2: Access Governance | Admin has full visibility into who can use what | Admin can audit all access without DB queries | Addresses J1 anxiety: "What if an agent makes calls I didn't authorize?" |
| 4 | Release 3: Discovery | Admin imports tools from MCP servers | Time to onboard new MCP server < 3 min | Automates manual tool definition; derisks US-2 backend dependency |

## Backlog Suggestions

| Story | Release | Priority | Outcome Link | Dependencies |
|-------|---------|----------|-------------|--------------|
| US-UI-01: Page Shell + Navigation | WS | P1 | Navigation | None |
| US-UI-02: Browse Tools | WS | P1 | Tool visibility | US-UI-01 |
| US-UI-03: Register Provider | WS | P1 | Provider setup | US-UI-01 |
| US-UI-04: Connect Account (Static) | WS | P1 | Account connection | US-UI-03 |
| US-UI-05: Grant Tool Access | WS | P1 | Access management | US-UI-01, US-UI-02 |
| US-UI-06: Connect Account (OAuth2) | R1 | P2 | Full connection flow | US-UI-03 |
| US-UI-07: Connected Accounts Dashboard | R1 | P2 | Account visibility | US-UI-04 |
| US-UI-08: Tool Governance UI | R2 | P3 | Governance | US-UI-02 |

> **Note**: Story IDs (US-UI-01 through US-UI-08) are assigned in the user-stories.md file. Each maps to a sub-capability of the original US-11.

## Value/Effort Matrix

| | Low Effort (1-2 days) | High Effort (3+ days) |
|---|---|---|
| **High Value** | US-UI-01 (shell), US-UI-02 (browse), US-UI-05 (grants) | US-UI-06 (OAuth2 flow) |
| **Medium Value** | US-UI-04 (static connect), US-UI-07 (dashboard) | US-UI-03 (provider form) |
| **Lower Value** | US-UI-08 (governance) | -- |

Quick wins (high value, low effort) first: page shell, tool browsing, and grant management form the walking skeleton.
