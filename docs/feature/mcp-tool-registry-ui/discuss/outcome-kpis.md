# Outcome KPIs -- Tool Registry UI

## Feature: mcp-tool-registry-ui

### Objective
Workspace admins and members manage integration tools, providers, accounts, and access entirely through the Brain web UI, eliminating the need for raw API calls or database queries.

### Outcome KPIs

| # | Who | Does What | By How Much | Baseline | Measured By | Type |
|---|-----|-----------|-------------|----------|-------------|------|
| 1 | Workspace admins | Register credential providers via UI instead of API calls | 90% of provider registrations via UI | 0% (no UI) | Provider creation source tracking (UI vs API) | Leading |
| 2 | Workspace members | Connect accounts (OAuth2/static) via UI | 80% of account connections via UI within 30 days | 0% (no UI) | Connected account creation source | Leading |
| 3 | Workspace admins | Find and audit tool access without database queries | 100% self-service (zero DB queries for access audit) | 100% DB-dependent | Admin survey / DB query log reduction | Leading |
| 4 | Workspace members | Identify and resolve expired accounts without admin help | 90% of reconnections done self-service | 0% (requires admin) | Reconnect action source tracking | Leading |
| 5 | Workspace admins | Time to set up a new integration (provider + tools + grants) | Under 5 minutes end-to-end | 15+ minutes via API | Time-to-completion tracking | Leading |

### Metric Hierarchy

- **North Star**: % of integration management actions performed via UI (vs API/DB)
- **Leading Indicators**:
  - Provider registrations via UI
  - Account connections via UI
  - Grant management via UI
  - Revoke/reconnect actions via UI
- **Guardrail Metrics**:
  - Page load time must stay under 1 second
  - Zero credential leaks in API responses (already enforced by backend)
  - Accessibility: all actions completable via keyboard

### Measurement Plan

| KPI | Data Source | Collection Method | Frequency | Owner |
|-----|------------|-------------------|-----------|-------|
| Provider creation source | API request headers | User-Agent or source param | Per event | Backend |
| Account connection source | API request headers | User-Agent or source param | Per event | Backend |
| Self-service audit actions | UI analytics | Page view + filter/search events | Weekly | Frontend |
| Time to completion | UI analytics | Timestamp deltas (start to success) | Weekly | Frontend |
| Page load time | Browser performance API | Lighthouse or RUM | Weekly | Frontend |

### Hypothesis
We believe that providing a Tool Registry UI for workspace admins and members will achieve self-service integration management. We will know this is true when 80%+ of provider registrations and account connections happen through the UI within 30 days of launch.
