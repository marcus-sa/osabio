# Outcome KPIs: Agent Management

## Feature: Agent Management

### Objective

Workspace admins and developers can view, create, configure, and monitor agents through the Brain UI with full governance, eliminating direct database manipulation for agent management.

### Outcome KPIs

| # | Who | Does What | By How Much | Baseline | Measured By | Type |
|---|-----|-----------|-------------|----------|-------------|------|
| 1 | Workspace admins | View agent fleet status through UI instead of DB queries | 100% of visibility tasks via UI (from 0%) | All agent visibility requires DB access | Agent page visits vs. DB query logs | Leading |
| 2 | Developers | Register new agents through UI instead of manual DB manipulation | Agent creation time under 2 minutes (from ~15 min) | ~15 minutes manual SurrealQL per agent | Time from create click to token copied | Leading |
| 3 | Workspace admins | Manage agent lifecycle (edit, delete) through UI | Self-service operations under 1 minute (from 10+ min) | Direct DB manipulation for all changes | Time from action start to confirmation | Leading |
| 4 | Workspace admins | Spawn sandbox sessions from agent context | Session spawn time under 10 seconds (from 30+ sec) | Navigate to orchestrator, configure, spawn | Time from spawn click to session active | Leading |
| 5 | Workspace admins | Monitor session status per agent without orchestrator navigation | Status check under 5 seconds per agent | Navigate to orchestrator, filter by agent | Time on agent detail session section | Leading |
| 6 | Workspace admins | Resolve idle sessions from agent context | Idle response time under 15 seconds (from 45+ sec) | Navigate to orchestrator, find session, respond | Time from idle detection to feedback sent | Leading |
| 7 | New workspace users | Create first agent from empty state guidance | First-agent creation rate above 60% in first week | No UI guidance (users must discover independently) | Empty state CTA click-through rate | Leading |

### Metric Hierarchy

- **North Star**: Agent management tasks completed through UI (percentage of total agent management operations performed via the agents page vs. direct DB access)
- **Leading Indicators**:
  - Agent page daily active users
  - Agent creation success rate (creations completed / creations started)
  - Session spawn success rate from agent detail page
  - Empty state CTA click-through rate
- **Guardrail Metrics**:
  - Agent creation error rate must stay below 5%
  - Authority scope misconfiguration rate (agents with incorrect permissions) must stay at 0%
  - Page load time for agents page must stay under 2 seconds
  - No orphaned records from failed transactions (0 tolerance)

### Measurement Plan

| KPI | Data Source | Collection Method | Frequency | Owner |
|-----|------------|-------------------|-----------|-------|
| KPI-1: UI adoption | OTel spans on agent page routes | brain.http.request spans with route=/agents | Weekly | Product |
| KPI-2: Creation time | OTel span duration | brain.agent.create span duration_ms | Per event | Product |
| KPI-3: Self-service ops | OTel span duration | brain.agent.edit + brain.agent.delete spans | Per event | Product |
| KPI-4: Spawn time | Orchestrator session telemetry | Time from spawn request to session active | Per event | Engineering |
| KPI-5: Session visibility | Agent detail page engagement | Time-on-page for agent detail | Weekly | Product |
| KPI-6: Idle response time | Orchestrator feedback telemetry | Time from idle status to feedback received | Per event | Engineering |
| KPI-7: First-agent rate | Empty state interaction tracking | CTA clicks / unique new workspace users | Weekly | Product |

### Hypothesis

We believe that providing a dedicated agents page with creation, configuration, and monitoring capabilities for workspace admins and developers will achieve 100% self-service agent management through the UI.

We will know this is true when workspace admins complete all agent visibility and lifecycle tasks through the UI (KPI-1 at 100%) and developers register new agents in under 2 minutes (KPI-2 baseline met).
