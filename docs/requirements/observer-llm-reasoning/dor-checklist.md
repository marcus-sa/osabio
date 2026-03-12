# Definition of Ready Checklist: Observer LLM Reasoning

## DoR Items

### 1. Problem statement clear and user-centric
- [x] User stories lead with user pain, not solution
- [x] "LLM reasoning" moved to Technical Notes section
- [x] Alternatives considered and documented with rejection rationale (regex, user rules, manual escalation)
- **Evidence:** `user-stories.md` — stories framed as "Surface contradictions..." not "Use LLM to detect..."

### 2. Personas with specific characteristics
- [x] 3 personas defined: Marcus Santos (workspace owner), Jamie Park (DevOps), PM Agent (algorithmic)
- [x] Each persona has role, usage frequency, primary pain point
- [x] Stakeholder table with needs per consumer (chat agent, coding agents, PM agent)
- **Evidence:** `user-stories.md` § Personas, `requirements.md` § Stakeholders

### 3. Domain examples with real data
- [x] US-1: Redis/Kafka vs "minimize external dependencies" with decision text, task details, commit messages
- [x] US-2: REST billing API vs "standardize on tRPC" with timeline context
- [x] US-3a: Python tasks blocked by "TypeScript exclusively" decision with specific entity details and days blocked
- [x] US-4: PM agent risk assessment with evidence evaluation walkthrough
- **Evidence:** Domain Example sections in each user story

### 4. UAT scenarios cover happy path + edge cases
- [x] Happy path: contradiction detected, match confirmed, pattern synthesized, peer review sound
- [x] Error paths: LLM failure fallback, LLM timeout, synthesis failure
- [x] Edge cases: low confidence downgrade, invalid evidence refs, large workspace partitioning, dedup across scans, single-entity pattern discard
- **Evidence:** `acceptance-criteria.md` — 18 acceptance criteria across 4 AC groups

### 5. Acceptance criteria testable
- [x] All AC have observable assertions (field values, edge counts, API call counts)
- [x] Verifiable queries included: `SELECT count() FROM observation WHERE...`
- [x] Confidence thresholds quantified: 0.5 for verification, 0.7/0.4 for peer review
- **Evidence:** `acceptance-criteria.md` — each AC has concrete pass/fail criterion

### 6. Stories right-sized (1-3 days, 3-7 scenarios)
- [x] US-1: M (3 days, 7 AC)
- [x] US-2: S (1 day, 3 AC)
- [x] US-3a: M (3 days, 7 AC) — split from original US-3
- [x] US-3b: S (1 day, 2 AC) — dedup extracted
- [x] US-4: M (2 days, 3 AC)
- [x] US-5: S (0.5 day, 3 AC)
- **Evidence:** `user-stories.md` — 6 stories, all within 0.5-3 day range

### 7. Technical notes identify constraints and NFRs
- [x] Confidence thresholds: 0.5 (verification), 0.7/0.4 (peer review)
- [x] Related decisions scope: confirmed/provisional in task's project, max 20, by recency
- [x] Minimum signals: 2 distinct entities per pattern
- [x] Latency SLA: 10s timeout, p95 ~1.5s expected (R8)
- [x] Cost controls: Haiku model, >= 50% skip rate target (R9)
- [x] Large workspace: partition by type, top 20 per type (R10)
- **Evidence:** `requirements.md` R1-R10

### 8. Stories traceable to jobs
- [x] US-1 → J1, US-2 → J1, US-3a → J3, US-3b → J3, US-4 → J2, US-5 → All
- [x] J4 satisfied implicitly via LLM-generated text in US-1/2/3a/4
- **Evidence:** Job trace annotations in `user-stories.md`

### 9. Dependencies resolved or tracked
- [x] Existing observer pipeline (app/src/server/observer/) — in place
- [x] ToolLoopAgent scaffolding (app/src/server/agents/observer/) — in place
- [x] Model client abstraction — in place (used by chat agent, PM agent)
- [x] SurrealDB EVENTs — in place (5 events, all tested)
- [x] No external dependencies required
- **Evidence:** Codebase exploration confirmed all infrastructure exists

### 10. Risks and mitigations documented
- [x] LLM hallucination → structured output + post-validation (R5, AC-1.6)
- [x] Cost at scale → skip criteria + Haiku model + tracking (R2, R9)
- [x] Latency → async events + 10s timeout + fallback (R3, R8)
- [x] Alert fatigue → minimum signal thresholds + dedup (R4, AC-2.4)
- [x] LLM failure → deterministic fallback (R3, AC-1.4)
- [x] Large workspaces → partitioning + truncation (R10, AC-2.7)
- **Evidence:** `requirements.md` R1-R10, `jtbd-opportunity-scores.md` § Risk Mitigation

## Verdict: READY

All 10 DoR items pass. Feature is ready for DESIGN wave handoff.
