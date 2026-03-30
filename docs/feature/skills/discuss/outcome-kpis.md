# Outcome KPIs: Skills Feature (#177)

## Objective

Workspace admins equip agents with governed domain expertise from creation, eliminating per-session re-explanation and establishing the missing layer between tools and learnings.

## Outcome KPIs

| # | Who | Does What | By How Much | Baseline | Measured By | Type |
|---|-----|-----------|-------------|----------|-------------|------|
| 1 | Workspace admins creating sandbox agents | Assign at least 1 skill during agent creation | >50% of sandbox agents created with >= 1 skill | 0% (no skill assignment exists) | possesses edge count per agent at creation | Leading |
| 2 | Workspace admins | Complete the 3-step wizard without abandoning | >85% wizard completion rate (step 1 start to Create Agent click) | ~95% (current 2-step wizard, estimated) | Frontend analytics: step 1 start vs Create Agent submit | Leading |
| 3 | Workspace admins in Step 3 | Correctly explain why an agent has specific tools | >80% comprehension of implicit tool grants | 0% (no tool provenance info exists) | Prototype user testing (H3 hypothesis) | Leading |
| 4 | Sandbox agents with skills | Receive skill source references at session start | 100% of active possessed skills available | 0% (no skills passed to sessions) | Acceptance test: setSkillsConfig call args | Leading |
| 5 | Workspace admins | Create and manage skills through the UI | >90% of skills created via UI | 0% (no UI exists) | API creation source tracking | Leading |
| 6 | Skill-governed tool calls | Pass through policy evaluation when governing policy exists | 100% evaluated | 0% (no governance exists) | Authorizer logs | Leading |

## Metric Hierarchy

- **North Star**: KPI-1 -- Agents with skills assigned. This is the single metric that indicates the feature is delivering its core value (agents equipped with expertise).
- **Leading Indicators**: KPI-2 (wizard completion), KPI-5 (UI adoption) -- these predict whether admins will adopt the feature.
- **Guardrail Metrics**:
  - Agent creation time must not increase by more than 30 seconds vs current wizard (Steps 2+3 are optional/skippable)
  - External agent creation flow must not regress in completion rate
  - Existing agent CRUD operations must not break

## Measurement Plan

| KPI | Data Source | Collection Method | Frequency | Owner |
|-----|------------|-------------------|-----------|-------|
| KPI-1 | SurrealDB graph | `SELECT count() FROM possesses GROUP BY in` | Weekly | Product |
| KPI-2 | Frontend analytics | Step navigation events (step 1 enter, create click) | Weekly | Product |
| KPI-3 | User testing | Prototype walkthrough with 3-5 admins | Pre-release | Product |
| KPI-4 | Acceptance tests | Test verifying setSkillsConfig call arguments | Per deploy | Engineering |
| KPI-5 | API logs | Track creation source (UI form vs raw API call) | Weekly | Product |
| KPI-6 | Authorizer traces | Policy evaluation events for skill-derived tool calls | Weekly | Engineering |

## Hypothesis

We believe that adding a 3-step wizard (Config > Skills > Tools) with a governed skill library for workspace admins will achieve agents equipped with domain expertise from their first session.

We will know this is true when >50% of sandbox agents are created with at least 1 skill (KPI-1) and >85% of wizard flows complete successfully (KPI-2).
