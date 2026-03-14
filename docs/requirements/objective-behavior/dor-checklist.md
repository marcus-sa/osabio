# Definition of Ready Checklist: Objective & Behavior Nodes

All 7 user stories validated against 8-item DoR hard gate.

---

## US-OB-01: Create Strategic Objectives

| DoR Item | Status | Evidence |
|----------|--------|---------|
| 1. Problem statement clear, domain language | PASS | "Elena finds it impossible to know whether agent work serves business goals because there is no concept of objectives in the knowledge graph." Uses domain language: objectives, knowledge graph, agent work. |
| 2. User/persona with specific characteristics | PASS | Elena Vasquez, Engineering Lead, manages 4 coding agents and 2 management agents, 12-person AI-native startup, reports to board quarterly. |
| 3. 3+ domain examples with real data | PASS | 3 examples: (1) Elena creates "Launch MCP Marketplace" with target June 30 and 10 integrations KPI, (2) objective without target date "Improve Infrastructure Reliability", (3) duplicate detection at 0.97 similarity. |
| 4. UAT scenarios in Given/When/Then (3-7) | PASS | 4 scenarios: creation from chat, missing target date prompt, duplicate detection, workspace scoping with embedding. |
| 5. AC derived from UAT | PASS | 4 acceptance criteria directly derived from the 4 UAT scenarios. |
| 6. Right-sized (1-3 days, 3-7 scenarios) | PASS | 2-3 days effort, 4 scenarios. Single demo: create objective via chat, verify in graph. |
| 7. Technical notes: constraints/dependencies | PASS | New SCHEMAFULL table, extraction pipeline extension, embedding generation reuse, status enum defined. Dependencies: embedding pipeline, extraction pipeline, schema migration. |
| 8. Dependencies resolved or tracked | PASS | Embedding pipeline (existing), extraction pipeline (existing, needs extension), schema migration (tracked as first deliverable). |

**DoR Status: PASSED**

---

## US-OB-02: Automatic Intent-Objective Alignment

| DoR Item | Status | Evidence |
|----------|--------|---------|
| 1. Problem statement clear, domain language | PASS | "Elena cannot tell whether agent intents serve active business objectives... discovers misalignment only through manual review, often days after compute is spent." |
| 2. User/persona with specific characteristics | PASS | Elena Vasquez (same persona as US-OB-01), reviewing agent strategic alignment, wants automatic tracking. |
| 3. 3+ domain examples with real data | PASS | 3 examples: (1) Coder-Alpha "Implement MCP tool discovery endpoint" matches at 0.87, (2) Coder-Beta "Refactor logging" no match at 0.31, (3) ambiguous match with two objectives at 0.72 and 0.68. |
| 4. UAT scenarios in Given/When/Then (3-7) | PASS | 5 scenarios: automatic linking, unaligned warning, manual linking from feed card, no objectives case, ambiguous match. Plus 1 @property scenario for performance. |
| 5. AC derived from UAT | PASS | 5 acceptance criteria + 1 @property criterion, each mapped from UAT scenarios. |
| 6. Right-sized (1-3 days, 3-7 scenarios) | PASS | 2-3 days effort, 5 scenarios (+1 property). Single demo: submit intent, see supports edge or warning. |
| 7. Technical notes: constraints/dependencies | PASS | KNN query for objective matching, supports relation table, warning observation, feed card SSE events. |
| 8. Dependencies resolved or tracked | PASS | US-OB-01 (objectives must exist), intent authorization pipeline (existing), embedding pipeline (existing). |

**DoR Status: PASSED**

---

## US-OB-03: Behavioral Telemetry Collection

| DoR Item | Status | Evidence |
|----------|--------|---------|
| 1. Problem statement clear, domain language | PASS | "Tomasz caught Coder-Alpha shipping 0% test coverage on a payment module by accident during manual code review, 3 days after the fact." |
| 2. User/persona with specific characteristics | PASS | Tomasz Kowalski, Senior Platform Engineer, responsible for agent quality and reliability, manages 6 coding agents. |
| 3. 3+ domain examples with real data | PASS | 3 examples: (1) Coder-Alpha TDD_Adherence 0.42 with 12 files/2 test files, (2) new agent Coder-New with no data, (3) telemetry unavailable -- Observer skips and retries. |
| 4. UAT scenarios in Given/When/Then (3-7) | PASS | 4 scenarios: TDD_Adherence write, Security_First write, new agent no data, telemetry failure resilience. |
| 5. AC derived from UAT | PASS | 5 acceptance criteria covering creation, append-only, failure resilience, new agent handling. |
| 6. Right-sized (1-3 days, 3-7 scenarios) | PASS | 2-3 days effort, 4 scenarios. Single demo: complete agent session, see behavior record. |
| 7. Technical notes: constraints/dependencies | PASS | New behavior + exhibits tables, Observer Agent extension, score normalization, workspace scoping. |
| 8. Dependencies resolved or tracked | PASS | Observer Agent (existing, needs extension), agent session data (existing), schema migration (tracked). |

**DoR Status: PASSED**

---

## US-OB-04: Behavior-Based Policy Enforcement

| DoR Item | Status | Evidence |
|----------|--------|---------|
| 1. Problem statement clear, domain language | PASS | "Coder-Beta's Security_First score is 0.65 -- below what Tomasz considers safe for production deployment -- but nothing prevents Coder-Beta from deploying to production." |
| 2. User/persona with specific characteristics | PASS | Tomasz Kowalski (same persona as US-OB-03), enforcing agent quality standards. |
| 3. 3+ domain examples with real data | PASS | 4 examples: (1) Coder-Beta vetoed (score 0.65, threshold 0.80), (2) human override for critical hotfix, (3) testing mode observes without blocking, (4) Coder-Gamma passes at 0.93. |
| 4. UAT scenarios in Given/When/Then (3-7) | PASS | 5 scenarios: veto, human override, testing mode, pass, high veto rate detection. |
| 5. AC derived from UAT | PASS | 5 acceptance criteria, each derived from corresponding scenario. |
| 6. Right-sized (1-3 days, 3-7 scenarios) | PASS | 2-3 days effort, 5 scenarios. Single demo: submit intent, see veto or pass. |
| 7. Technical notes: constraints/dependencies | PASS | Policy condition schema extension, behavior score query, override endpoint, observation creation. |
| 8. Dependencies resolved or tracked | PASS | US-OB-03 (behavior records), policy system (existing), Authorizer Agent (existing, needs extension). |

**DoR Status: PASSED**

---

## US-OB-05: Objective Progress Visibility

| DoR Item | Status | Evidence |
|----------|--------|---------|
| 1. Problem statement clear, domain language | PASS | "Elena has no way to see progress toward objectives without running manual graph queries." |
| 2. User/persona with specific characteristics | PASS | Elena Vasquez, monitoring strategic progress, wants at-a-glance objective status. |
| 3. 3+ domain examples with real data | PASS | 3 examples: (1) "Launch MCP Marketplace" at 34% with 14 intents and 3/10 integrations, (2) "Improve Infrastructure Reliability" with 0 intents in 14 days, (3) "Q1 Launch" expired (target March 1). |
| 4. UAT scenarios in Given/When/Then (3-7) | PASS | 3 scenarios: active progress, inactive warning, expired prompt. |
| 5. AC derived from UAT | PASS | 4 acceptance criteria (3 from scenarios + load time). |
| 6. Right-sized (1-3 days, 3-7 scenarios) | PASS | 2 days effort, 3 scenarios. Single demo: navigate to objectives, see dashboard. |
| 7. Technical notes: constraints/dependencies | PASS | Progress computation from supports edges, workspace-scoped query, key result heuristic. |
| 8. Dependencies resolved or tracked | PASS | US-OB-01 (objectives), US-OB-02 (supports edges). |

**DoR Status: PASSED**

---

## US-OB-06: Coherence Auditor

| DoR Item | Status | Evidence |
|----------|--------|---------|
| 1. Problem statement clear, domain language | PASS | "Elena discovered 12 orphaned decisions by accident during a graph visualization session. No systematic way to detect disconnected patterns." |
| 2. User/persona with specific characteristics | PASS | Elena Vasquez, maintaining graph coherence, 847-node graph. |
| 3. 3+ domain examples with real data | PASS | 3 examples: (1) "Standardize on tRPC" decision with no task after 27 days, (2) stale objective with 0 intents in 14 days, (3) info-severity observation correctly excluded from orphan detection. |
| 4. UAT scenarios in Given/When/Then (3-7) | PASS | 4 scenarios: orphaned decision, stale objective, info observation exclusion, coherence score. |
| 5. AC derived from UAT | PASS | 5 acceptance criteria including 30-second performance requirement. |
| 6. Right-sized (1-3 days, 3-7 scenarios) | PASS | 2 days effort, 4 scenarios. Single demo: run auditor, see observations in feed. |
| 7. Technical notes: constraints/dependencies | PASS | Graph queries against multiple tables, configurable staleness threshold, coherence score formula. |
| 8. Dependencies resolved or tracked | PASS | US-OB-01/02 (for objective checks), existing observation system, existing decision/task tables. |

**DoR Status: PASSED**

---

## US-OB-07: Observer Behavior Learning Loop

| DoR Item | Status | Evidence |
|----------|--------|---------|
| 1. Problem statement clear, domain language | PASS | "Underperforming agents keep making the same mistakes. No mechanism to teach agents based on behavioral telemetry -- only to block them. The Observer already proposes learnings from observation clusters but cannot consume behavior records as input signals." |
| 2. User/persona with specific characteristics | PASS | Tomasz Kowalski, improving agent quality over time. |
| 3. 3+ domain examples with real data | PASS | 5 examples: (1) Observer proposes learning for Coder-Beta (Security_First below 0.80 for 3 sessions, 2 CVE advisories ignored, collision detection passed, dual-gate passed), (2) effective learning (score improved 0.65 to 0.88), (3) ineffective learning (Coder-Delta TDD still 0.45 after 5 sessions), (4) Observer rate-limited (5 proposals in 7 days), (5) learning blocked by policy collision (score 0.45 > 0.40 threshold). |
| 4. UAT scenarios in Given/When/Then (3-7) | PASS | 6 scenarios: Observer proposal with collision/dual-gate checks, approval + JIT injection, effective learning, ineffective escalation, rate limit, policy collision. |
| 5. AC derived from UAT | PASS | 10 acceptance criteria covering Observer extension, proposal via existing API, collision detection, dual-gate safety, approval workflow, JIT injection, effectiveness tracking, escalation, provenance. |
| 6. Right-sized (1-3 days, 3-7 scenarios) | PASS | 2 days effort (leverages existing learning infrastructure), 6 scenarios. Single demo: trigger behavior pattern, see Observer propose learning, approve in Learning Library, verify JIT injection. |
| 7. Technical notes: constraints/dependencies | PASS | Observer extension (behavior record clustering), existing learning API endpoints, existing collision detection thresholds (0.90/0.40/0.55), existing dual-gate safety (5/agent/7 days, 0.85 dismissed), existing JIT injection (500-token budget), existing Learning Library UI. |
| 8. Dependencies resolved or tracked | PASS | US-OB-03 (behavior records). Learning system (PR #145) -- IMPLEMENTED: learning table, CRUD API, collision detection, JIT injection, Learning Library UI, Observer proposal pipeline. All external dependencies resolved. |

**DoR Status: PASSED**

---

## Summary

| Story | DoR Status | Effort | Scenarios | Priority (from Opportunity Scoring) |
|-------|-----------|--------|-----------|--------------------------------------|
| US-OB-01: Create Strategic Objectives | PASSED | 2-3 days | 4 | Must Have (enables all alignment features) |
| US-OB-02: Automatic Intent-Objective Alignment | PASSED | 2-3 days | 5+1 | Must Have (core alignment mechanism) |
| US-OB-03: Behavioral Telemetry Collection | PASSED | 2-3 days | 4 | Must Have (enables all behavior features) |
| US-OB-04: Behavior-Based Policy Enforcement | PASSED | 2-3 days | 5 | Should Have (depends on OB-03) |
| US-OB-05: Objective Progress Visibility | PASSED | 2 days | 3 | Should Have (depends on OB-01, OB-02) |
| US-OB-06: Coherence Auditor | PASSED | 2 days | 4 | Should Have (builds on OB-01, OB-02) |
| US-OB-07: Observer Behavior Learning Loop | PASSED | 2 days | 6 | Should Have (depends on OB-03; learning infra resolved via PR #145) |

### Dependency Graph

```
US-OB-01 (Objectives) -----> US-OB-02 (Alignment) -----> US-OB-05 (Progress View)
                                    |                            |
                                    +----------------------------+--> US-OB-06 (Coherence)

US-OB-03 (Behaviors) ------> US-OB-04 (Policy Enforcement)
                                    |
                                    +--> US-OB-07 (Observer Behavior Learning) -- learning infra RESOLVED (PR #145)
```

### Recommended Implementation Order
1. US-OB-01 + US-OB-03 (parallel -- graph layer foundations, no dependencies on each other)
2. US-OB-02 (depends on OB-01)
3. US-OB-04 (depends on OB-03)
4. US-OB-05 + US-OB-06 (parallel -- depend on OB-01/02)
5. US-OB-07 (depends on OB-03; learning infra available immediately via PR #145)

### Total Estimated Effort
- 13-17 days for all 7 stories
- MVP (Must Have only): OB-01 + OB-02 + OB-03 = 6-9 days

### All Stories Pass DoR: Ready for DESIGN Wave Handoff
