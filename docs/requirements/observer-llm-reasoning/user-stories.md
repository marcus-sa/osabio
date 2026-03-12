# User Stories: Observer LLM Reasoning

All stories trace to JTBD job stories in `docs/ux/observer-llm-reasoning/jtbd-job-stories.md`.

## Personas

**Marcus Santos** — Founder/CEO. Manages 5 concurrent projects in Brain. Reviews observation feed 2x daily. Needs high signal-to-noise ratio. Primary pain: subtle contradictions between architecture decisions and shipped code go undetected until production issues surface.

**Jamie Park** — DevOps lead. Configures environment variables and model settings in CI/CD. Needs clear cost/performance controls. Primary pain: no visibility into observer operational costs or latency impact.

**PM Agent** (algorithmic persona) — Creates observations from triage analysis. Needs reasoning quality feedback. Primary pain: no mechanism to distinguish well-grounded observations from noise.

---

## US-1: Surface contradictions between decisions and completed tasks

**As** Marcus (workspace owner),
**I want** contradictions between confirmed decisions and completed tasks surfaced automatically,
**so that** I don't discover misalignment during production incidents weeks after the task shipped.

**Technical notes:** Uses LLM reasoning to evaluate semantic alignment. Extends existing verification pipeline.

**Job trace:** J1
**Requirements:** R1, R2, R3, R5, R7, R8, R9
**Size:** M (est. 3 days)

### Acceptance Criteria
- AC-1.1: When a task completion triggers the observer and related decisions exist, the LLM returns a structured verdict with `observation_type = "contradiction"` and `severity = "conflict"` for mismatches
- AC-1.2: When a semantic contradiction is found (confidence >= 0.5), the observation links to both the decision and task via observes edges, and the text explains the specific conflict
- AC-1.3: When `OBSERVER_SKIP_DETERMINISTIC=true` (default) and the deterministic check returns "match" with confirming external signals, the LLM call is skipped and observation source is "github"
- AC-1.3b: When `OBSERVER_SKIP_DETERMINISTIC=false`, the LLM is always invoked even when deterministic check returns "match"
- AC-1.4: When the LLM call fails (timeout >10s, 500, rate limit), the pipeline creates an observation using the deterministic verdict with source "deterministic_fallback"
- AC-1.5: When the LLM confidence is below 0.5, the verdict is "inconclusive" with severity "info"
- AC-1.6: When LLM returns evidence_refs containing non-existent entity IDs, post-validation strips invalid refs and the observation is still created with remaining valid refs

### Domain Example
> **Decision:** "Minimize external service dependencies. Prefer in-process alternatives over cloud services. Target: <5 external service calls per user session." (confirmed 2026-01-15)
>
> **Task:** "Add Redis caching layer and Kafka event stream" (completed 2026-03-10). Linked commits: `feat: integrate Redis for session cache`, `feat: add Kafka consumer for event processing`.
>
> **Expected:** LLM detects mismatch — task adds 2 external service dependencies (Redis, Kafka) contradicting the "minimize external dependencies" decision. Creates conflict observation linking both entities.

---

## US-2: Surface contradictions when confirming new decisions

**As** Marcus (workspace owner),
**I want** newly confirmed decisions checked against already-shipped work,
**so that** I know immediately if a new architectural direction conflicts with what's already built.

**Technical notes:** Reuses US-1 LLM infrastructure. Inverts the direction: decision triggers check against completed tasks.

**Job trace:** J1
**Requirements:** R1, R5, R7
**Size:** S (est. 1 day)

### Acceptance Criteria
- AC-2.1: When a decision is confirmed, the observer loads all completed tasks in the same project (confirmed decisions, status IN [completed, done])
- AC-2.2: The LLM evaluates each completed task against the newly confirmed decision and returns structured verdicts
- AC-2.3: For each contradiction found, an observation is created with observes edges to both the decision and the contradicting task. Verifiable: `SELECT count() FROM observation WHERE source_agent = "observer_agent" AND observation_type = "contradiction"`

### Domain Example
> **New decision:** "Standardize on tRPC for all API endpoints" (just confirmed).
>
> **Existing completed task:** "Implement billing API with REST endpoints" (completed 2 weeks ago).
>
> **Expected:** LLM detects the billing REST API contradicts the tRPC standardization decision. Creates observation: "Billing API (task:xyz) uses REST endpoints, contradicting the tRPC standardization decision (decision:abc). Consider migrating billing API or revising the standardization scope."

---

## US-3a: Synthesize anomalies into named patterns

**As** Marcus (workspace owner),
**I want** the graph scan to correlate individual anomalies into named systemic patterns,
**so that** I act on root causes (bottleneck decisions, cascade blocks) instead of chasing isolated symptoms.

**Technical notes:** LLM receives deterministic anomalies as input, produces structured patterns. Minimum 2 contributing entities per pattern.

**Job trace:** J3
**Requirements:** R4, R5, R7, R8, R9, R10
**Size:** M (est. 3 days)

### Acceptance Criteria
- AC-3a.1: After deterministic scan, all anomalies are passed to LLM synthesis. LLM returns 0+ patterns, each with a name from controlled vocabulary
- AC-3a.2: Each pattern links to 2+ distinct contributing entities via observes edges. Patterns with <2 entities are discarded
- AC-3a.3: Synthesis observations have `observation_type = "pattern"`. Verifiable: `SELECT count() FROM observation WHERE observation_type = "pattern" AND status = "open"`
- AC-3a.4: When no anomalies are found, the LLM is not called and scan returns empty
- AC-3a.5: When LLM fails, deterministic anomalies are returned as individual observations (current behavior)
- AC-3a.6: When workspace has 50+ anomalies, anomalies are partitioned by type and top 20 per type are sent to LLM. Remaining are reported as individual observations

### Domain Example
> **Anomalies found by deterministic scan:**
> 1. Task "Add Python data pipeline" — blocked 18 days, reason: decision conflict
> 2. Task "Migrate ML module to TypeScript" — blocked 22 days, reason: depends on decision
> 3. Task "Add Python test framework" — blocked 10 days, reason: decision conflict
> 4. Decision "Use TypeScript exclusively" — confirmed 30 days ago, 0 tasks completed since
>
> **Expected:** LLM synthesizes `bottleneck_decision` pattern: "Decision 'Use TypeScript exclusively' is blocking 3 tasks for 10-22 days. Consider revisiting scope or adding exception for data/ML workloads." Observation links to all 4 entities.

---

## US-3b: Deduplicate pattern observations across scans

**As** Marcus (workspace owner),
**I want** repeated scans to not create duplicate pattern observations for the same systemic issue,
**so that** my feed isn't flooded with repeated bottleneck warnings.

**Job trace:** J3
**Requirements:** R4
**Size:** S (est. 1 day)

### Acceptance Criteria
- AC-3b.1: Before creating a pattern observation, check for existing open observations with `observation_type = "pattern"` linking to the same contributing entities
- AC-3b.2: If a matching open pattern exists, skip creation. Verifiable: run scan twice, assert observation count unchanged after second scan

---

## US-4: Evaluate reasoning quality of peer observations

**As** Marcus (workspace owner),
**I want** the observer to assess whether other agents' observations are well-grounded in evidence,
**so that** I can prioritize sound signals and deprioritize noise in my feed.

**Technical notes:** LLM evaluates claim vs cited evidence. Produces review verdict: "sound" (confidence >= 0.7), "questionable" (0.4-0.7), "unsupported" (<0.4).

**Job trace:** J2
**Requirements:** R6, R5, R7
**Size:** M (est. 2 days)

### Acceptance Criteria
- AC-4.1: When a non-observer observation with observes edges is created, the LLM evaluates whether the claim follows from the linked evidence. Returns structured verdict with confidence
- AC-4.2: The review observation links to the reviewed observation via observes edge. Verifiable: `SELECT count() FROM observes WHERE in.source_agent = "observer_agent" AND out.source_agent != "observer_agent"`
- AC-4.3: The original observation's text, severity, status, and edges are unchanged after review
- AC-4.4: Observer's own observations do not trigger peer review (existing cascade prevention via `source_agent != "observer_agent"` EVENT guard)

### Domain Example
> **PM agent observation:** "Task 'implement rate limiting' is at risk — linked decision about API quotas is 25 days old and unresolved." Links to task:T1 and decision:D1.
>
> **LLM review:** Loads task T1 (status: in_progress, 12 days), decision D1 (status: proposed, 25 days, no activity). Verdict: "sound" (confidence 0.82) — claim is supported by evidence. Review observation: "PM agent's risk assessment for rate limiting is well-grounded. Decision D1 has been unresolved for 25 days with no activity, confirming the stale blocker claim."

---

## US-5: Observer model configuration

**As** Jamie (DevOps lead),
**I want** to configure which LLM model the observer uses via environment variable,
**so that** I can control cost and performance independently of chat and PM agents.

**Job trace:** All (infrastructure)
**Requirements:** R7
**Size:** S (est. 0.5 day)

### Acceptance Criteria
- AC-5.1: `OBSERVER_MODEL` env var configures the model. Verifiable: set to specific model ID, assert API calls use that model
- AC-5.2: When `OBSERVER_MODEL` is not set, LLM reasoning is disabled — pipeline uses deterministic-only mode with zero LLM API calls
- AC-5.3: The model client uses the existing inference provider abstraction (OpenRouter/Ollama), same as chat and PM agents
