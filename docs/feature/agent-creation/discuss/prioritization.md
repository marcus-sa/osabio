# Prioritization: Agent Management

## Release Priority

| Priority | Release | Target Outcome | KPI | Rationale |
|----------|---------|---------------|-----|-----------|
| 1 | Walking Skeleton (R1) | External agent CRUD with governed authority works end-to-end | Agent creation success rate | Validates schema migration, 5-step transaction, authority model, and UI rendering. Derisks the fundamental architecture. |
| 2 | Sandbox Creation (R2) | Sandbox agents can be created with runtime config and sessions spawned | Sandbox agent spawn success rate | Adds the primary value -- sandbox agents are the most complex runtime. Session monitoring reuses existing data. |
| 3 | Operational Dashboard (R3) | Full lifecycle management: edit, monitor, handle idle sessions | Time from agent issue to resolution | Completes the operational surface. Edit and monitoring are quality-of-life improvements on a working base. |

## Prioritization Scores

| Release | Value (1-5) | Urgency (1-5) | Effort (1-5) | Score | Rank |
|---------|-------------|---------------|--------------|-------|------|
| R1: External Agent CRUD | 5 | 5 | 2 | 12.5 | 1 |
| R2: Sandbox Creation | 5 | 4 | 3 | 6.7 | 2 |
| R3: Operational Dashboard | 3 | 2 | 3 | 2.0 | 3 |

R1 scores highest because it validates the riskiest architectural assumptions (schema migration, transactional creation, authority model) with the least effort (external agents have minimal configuration).

## Backlog Suggestions

| Story | Release | Priority | Outcome Link | Dependencies |
|-------|---------|----------|-------------|--------------|
| US-01: View agent registry | R1 | P1 | KPI-1: Registry adoption | Schema migration (runtime field) |
| US-02: Create external agent | R1 | P1 | KPI-2: Agent creation success | US-01 (list page must exist), authority scope API |
| US-03: View agent detail | R1 | P1 | KPI-1: Registry adoption | US-01 |
| US-04: Delete agent | R1 | P1 | KPI-3: Self-service operations | US-01, US-03 |
| US-05: Create sandbox agent | R2 | P2 | KPI-2: Agent creation success | US-02 (shares creation flow), workspace sandbox provider config |
| US-06: Filter by runtime | R2 | P2 | KPI-1: Registry adoption | US-01 |
| US-07: Spawn sandbox session | R2 | P2 | KPI-4: Session spawn success | US-05, orchestrator integration |
| US-08: View session list | R2 | P2 | KPI-5: Session visibility | US-03, US-07 |
| US-09: Edit agent | R3 | P3 | KPI-3: Self-service operations | US-03 |
| US-10: Resume idle session | R3 | P3 | KPI-6: Idle session resolution | US-08, orchestrator feedback API |
| US-11: External connection status | R3 | P3 | KPI-5: Session visibility | US-03, proxy request tracking |
| US-12: Delete with active sessions | R3 | P3 | KPI-3: Self-service operations | US-04, US-07 |
| US-13: Empty states | R3 | P3 | KPI-7: First-agent onboarding | US-01 |

> **Note**: Story IDs (US-01 through US-13) are task-level placeholders from Phase 2.5.
> Full LeanUX story definitions with UAT scenarios are in user-stories.md (Phase 4).

## Riskiest Assumptions

| # | Assumption | Risk if Wrong | Validated By |
|---|-----------|---------------|-------------|
| 1 | 5-step transactional creation works atomically in SurrealDB | Orphaned records corrupt authority model | R1: US-02 (acceptance test) |
| 2 | Authority resolution via authorized_to edges performs adequately | Slow proxy requests, governance delays | R1: US-02 (load test in DESIGN) |
| 3 | agent_session.agent field migration from string to record ID is backward-compatible | Session list breaks for existing sessions | R2: US-08 (migration test) |
| 4 | Workspace sandbox provider config integrates with Sandbox Agent SDK | Spawn failures | R2: US-07 (integration test) |
