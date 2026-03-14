# Definition of Ready Checklist: Dynamic Behavior Definitions

---

## US-DB-001: Behavior Definition Schema and CRUD

| DoR Item | Status | Evidence |
|----------|--------|----------|
| Problem statement clear, domain language | PASS | "Elena finds it impossible to measure values like honesty because the behavior system only supports 5 hardcoded metric types, and adding a new one requires a code change." Uses domain terms: behavior definition, metric type, workspace admin. |
| User/persona identified | PASS | Elena Vasquez -- Workspace Admin, non-engineer, product management background. Specific characteristics: manages 3 coding agents and 1 design agent, wants to measure honesty and evidence-based reasoning. |
| 3+ domain examples with real data | PASS | 3 examples: (1) Elena creates "Honesty" definition with specific goal text, (2) Elena activates "Evidence-Based Reasoning" draft, (3) Elena archives "Conciseness." Real titles, real goal text, real status transitions. |
| UAT scenarios in Given/When/Then (3-7) | PASS | 5 scenarios: create, activate, archive, edit with version increment, reject missing goal. All use concrete data. |
| AC derived from UAT | PASS | 5 AC groups (AC-001.1 through AC-001.5) derived from the 5 scenarios. Each AC traces to a specific scenario. |
| Right-sized (1-3 days, 3-7 scenarios) | PASS | 5 scenarios. Estimated 2 days: schema migration + CRUD endpoints + validation. Single demonstrable feature: create and activate a definition via API. |
| Technical notes identify constraints | PASS | New SCHEMAFULL table, migration script, no backwards compatibility, deterministic scorers coexist with LLM-scored definitions. |
| Dependencies resolved or tracked | PASS | No dependencies (greenfield table). |

**DoR Status**: PASSED

---

## US-DB-002: Scorer Agent -- Evaluate Telemetry Against Definitions

| DoR Item | Status | Evidence |
|----------|--------|----------|
| Problem statement clear, domain language | PASS | "The existing scoreTelemetry() function only handles two hardcoded metric types with deterministic ratio-based logic. It cannot evaluate 'Does this agent's chat response demonstrate evidence-based reasoning?'" Specific code reference. |
| User/persona identified | PASS | System (automated) is the primary actor. Elena Vasquez is the indirect beneficiary. Coding-agent-alpha and coding-agent-beta are the scored entities with specific scenarios. |
| 3+ domain examples with real data | PASS | 3 examples: (1) Scoring fabricated chat_response for Honesty -> 0.05 with detailed rationale, (2) Scoring well-cited decision_proposal -> 0.85 with rationale, (3) Scorer Agent timeout with retry queue. Real agent names, real scores, real rationale text. |
| UAT scenarios in Given/When/Then (3-7) | PASS | 5 scenarios: score against matching definition, score with evidence, handle timeout, no matching definitions, multiple definitions match. |
| AC derived from UAT | PASS | 7 AC groups (AC-002.1 through AC-002.7) covering matching, context assembly, score production, persistence, multi-definition, failure, and deterministic compatibility. |
| Right-sized (1-3 days, 3-7 scenarios) | PASS | 5 scenarios. Estimated 3 days: Scorer Agent module, telemetry matching logic, evidence lookup, LLM integration, retry queue. Demonstrable: score a telemetry event and see the behavior record. |
| Technical notes identify constraints | PASS | New module location, AI SDK ToolLoopAgent pattern, graph query tools, SCORER_MODEL env var, Haiku-class model for cost. |
| Dependencies resolved or tracked | PASS | Depends on US-DB-001 (behavior_definition table). US-DB-001 has no blockers. |

**DoR Status**: PASSED

---

## US-DB-003: Authorizer Reads Dynamic Behavior Scores

| DoR Item | Status | Evidence |
|----------|--------|----------|
| Problem statement clear, domain language | PASS | "The existing enrichBehaviorScores() already populates behavior_scores in the IntentEvaluationContext... However, this only works because the metric types are hardcoded strings." References specific function and type. |
| User/persona identified | PASS | System (Authorizer) is primary actor. Elena Vasquez sees feed items. Coding-agent-alpha is the affected agent with specific score values. |
| 3+ domain examples with real data | PASS | 3 examples: (1) Block agent with Honesty 0.05 (threshold 0.50), specific scopes listed, (2) Allow agent with recovered Honesty 0.88, (3) Handle missing Collaboration score for new definition. Real metric names, real scores, real scopes. |
| UAT scenarios in Given/When/Then (3-7) | PASS | 4 scenarios: deny below threshold, allow above threshold, allow when no score exists, multiple scores evaluated together. |
| AC derived from UAT | PASS | 5 AC groups (AC-003.1 through AC-003.5) covering enrichment, enforcement, missing scores, recovery, and feed items. |
| Right-sized (1-3 days, 3-7 scenarios) | PASS | 4 scenarios. Estimated 1-2 days: verify existing enrichment works with dynamic types, validate policy parser, add feed items. Mostly verification + feed item generation. |
| Technical notes identify constraints | PASS | enrichBehaviorScores() already exists, policy predicate parser needs validation, no new DB schema. |
| Dependencies resolved or tracked | PASS | Depends on US-DB-002 (dynamic metric_type in behavior records). Tracked. |

**DoR Status**: PASSED

---

## US-DB-004: Observer Proposes Learnings from Dynamic Behavior Scores

| DoR Item | Status | Evidence |
|----------|--------|----------|
| Problem statement clear, domain language | PASS | "The Observer already scans for behavior trends via behavior/trends.ts, but its trend analysis uses the hardcoded metric types." References specific module. |
| User/persona identified | PASS | System (Observer Agent) is primary actor. Elena Vasquez approves proposed learnings. Coding-agent-alpha and coding-agent-beta are affected agents with specific scenarios. |
| 3+ domain examples with real data | PASS | 3 examples: (1) Diagnose fabrication -> propose "Verify claims against graph" learning, (2) Detect drift in Evidence-Based Reasoning scores (0.82, 0.75, 0.68, 0.61) -> propose learning, (3) Hit rate limit -> create critical observation instead. Real score sequences, real learning titles. |
| UAT scenarios in Given/When/Then (3-7) | PASS | 4 scenarios: propose learning from critical score, detect drift, create observation when rate limited, ignore archived definitions. |
| AC derived from UAT | PASS | 4 AC groups (AC-004.1 through AC-004.4) covering scanning, content, rate limiting, and archived exclusion. |
| Right-sized (1-3 days, 3-7 scenarios) | PASS | 4 scenarios. Estimated 2 days: extend Observer scan query, add definition context to diagnosis, verify rate limit applies. |
| Technical notes identify constraints | PASS | Observer graph-scan.ts needs dynamic query, learning-diagnosis.ts needs definition context, trends.ts is already metric-type-agnostic. |
| Dependencies resolved or tracked | PASS | Depends on US-DB-001 and US-DB-002. Both tracked. |

**DoR Status**: PASSED

---

## US-DB-005: Behavior Library Page -- Browse and Create

| DoR Item | Status | Evidence |
|----------|--------|----------|
| Problem statement clear, domain language | PASS | "Elena can create behavior definitions via the API but there is no web UI. She wants to browse existing definitions, see scores and trends at a glance, find community templates." |
| User/persona identified | PASS | Elena Vasquez -- Workspace Admin, non-engineer. Specific interaction: navigates to Library page, sees cards with scores and trends. |
| 3+ domain examples with real data | PASS | 3 examples: (1) Browse 2 active definitions with specific scores (TDD: 0.82, Security: 0.91), (2) Use "Honesty" community template, (3) Empty library for new workspace. |
| UAT scenarios in Given/When/Then (3-7) | PASS | 5 scenarios: browse with scores, empty state, create from template, validation preview, filter by status. |
| AC derived from UAT | PASS | 5 AC groups (AC-005.1 through AC-005.5). |
| Right-sized (1-3 days, 3-7 scenarios) | PASS | 5 scenarios. Estimated 2-3 days: new route, card components, template section, creation form, validation preview. Follows Learning Library pattern. |
| Technical notes identify constraints | PASS | Follow Learning Library patterns, existing card component patterns, new route path. |
| Dependencies resolved or tracked | PASS | Depends on US-DB-001 (CRUD API). Tracked. |

**DoR Status**: PASSED

---

## US-DB-006: Score Dashboard -- View and Inspect Scores

| DoR Item | Status | Evidence |
|----------|--------|----------|
| Problem statement clear, domain language | PASS | "Elena has active definitions producing scores but cannot see them in a meaningful way. The existing endpoint returns raw behavior records. Elena needs a per-definition score dashboard." |
| User/persona identified | PASS | Elena Vasquez -- Workspace Admin reviewing agent behavior patterns. |
| 3+ domain examples with real data | PASS | 3 examples: (1) Review 15 scores over 3 days, avg 0.73, per-agent comparison, (2) Inspect rationale for score 0.62 with specific text, (3) View trend after definition edit with version markers. |
| UAT scenarios in Given/When/Then (3-7) | PASS | 3 scenarios: timeline view, rationale inspection, per-agent breakdown. |
| AC derived from UAT | PASS | 3 AC groups (AC-006.1 through AC-006.3). |
| Right-sized (1-3 days, 3-7 scenarios) | PASS | 3 scenarios. Estimated 2 days: detail page, timeline chart, rationale modal, per-agent breakdown. |
| Technical notes identify constraints | PASS | Reuse existing query infrastructure, need filtered-by-definition query, frontend chart library. |
| Dependencies resolved or tracked | PASS | Depends on US-DB-002 (scores with rationale) and US-DB-005 (navigation). Tracked. |

**DoR Status**: PASSED

---

## US-DB-007: Warn-Only Mode and Manual Override

| DoR Item | Status | Evidence |
|----------|--------|----------|
| Problem statement clear, domain language | PASS | "Elena is anxious about automatic scope restriction based on behavior scores. She worries about false positives disrupting legitimate agent work." Addresses the strongest demand-reducing force (anxiety) identified in Four Forces analysis. |
| User/persona identified | PASS | Elena Vasquez -- Workspace Admin managing enforcement policy. Specific anxiety: false positive from eventual consistency lag. |
| 3+ domain examples with real data | PASS | 3 examples: (1) Warn-only mode with score 0.35, feed item without restriction, (2) Enable automatic enforcement after 2 weeks confidence, (3) Override false positive caused by graph consistency lag. Real scores, real scopes. |
| UAT scenarios in Given/When/Then (3-7) | PASS | 4 scenarios: warn-only feed item, automatic enforcement, manual override, enable automatic mode. |
| AC derived from UAT | PASS | 4 AC groups (AC-007.1 through AC-007.4). |
| Right-sized (1-3 days, 3-7 scenarios) | PASS | 4 scenarios. Estimated 2 days: enforcement_mode field, Authorizer mode check, override endpoint, feed item differentiation. |
| Technical notes identify constraints | PASS | New field on behavior_definition, Authorizer checks mode, override endpoint path. |
| Dependencies resolved or tracked | PASS | Depends on US-DB-003 (Authorizer integration) and US-DB-001 (enforcement_mode field). Tracked. |

**DoR Status**: PASSED

---

## Summary

| Story | DoR Status | Scenarios | Estimated Days | Priority |
|-------|-----------|-----------|---------------|----------|
| US-DB-001 | PASSED | 5 | 2 | Must Have |
| US-DB-002 | PASSED | 5 | 3 | Must Have |
| US-DB-003 | PASSED | 4 | 1-2 | Must Have |
| US-DB-004 | PASSED | 4 | 2 | Should Have |
| US-DB-005 | PASSED | 5 | 2-3 | Should Have |
| US-DB-006 | PASSED | 3 | 2 | Should Have |
| US-DB-007 | PASSED | 4 | 2 | Could Have |

### Walking Skeleton (Feature 0) Delivery Order
1. US-DB-001 (Schema + CRUD) -- no dependencies
2. US-DB-002 (Scorer Agent) -- depends on US-DB-001
3. US-DB-003 (Authorizer integration) -- depends on US-DB-002
4. US-DB-004 (Observer integration) -- depends on US-DB-001 + US-DB-002

After Feature 0 is proven end-to-end, Feature 1 (UI) and Feature 6 (Graduated Enforcement) can proceed in parallel.

### All 7 stories pass DoR. Ready for handoff to DESIGN wave.
