# JTBD Analysis: Store LLM Reasoning as Internal Telemetry

## Context

LLM reasoning (chain of thought) produced by the Observer verification pipeline, peer review, graph scan anomaly evaluation, contradiction detection, and learning diagnosis is currently used at runtime but discarded after execution. This reasoning is the justification trail for every autonomous agent action -- critical for forensics, auditing, and drift detection.

### Current State

- `generateVerificationVerdict()` returns `LlmVerdict` with `reasoning` field -- used in `applyLlmVerdict()` to set `VerificationResult.text`, but the original structured reasoning is not persisted on the observation.
- `generatePeerReviewVerdict()` returns `PeerReviewVerdict` with `reasoning` -- logged but not stored.
- Graph scan anomaly evaluation returns `reasoning` per entity -- logged at `observer.scan.llm_filtered` but not persisted.
- Contradiction detection returns `reasoning` per contradiction pair -- used in observation text but chain-of-thought lost.
- Learning diagnosis returns `rootCauseSchema` with `reasoning` -- used but not stored separately.
- The `observation` table has NO `reasoning` field.
- The `intent` table HAS a `reasoning` field but it stores human-provided rationale, not LLM chain-of-thought.
- The `trace` table captures model stats (tokens, cost, latency) per LLM call but NOT the chain-of-thought content.

### Design Constraint

`model_stats` is NOT needed on observation or intent -- the existing `trace` table already captures model, input_tokens, output_tokens, cost_usd, latency_ms per trace entry. The feature stores reasoning text only, linking to traces for cost/performance data.

---

## Job 1: Forensic Debugging

### Job Story

**When** a workspace admin discovers that an agent took an unexpected action (e.g., the Observer flagged a task as contradicting a confirmed decision, and the admin is unsure why),
**I want to** see the LLM's chain-of-thought reasoning that led to that action,
**so I can** quickly determine whether the agent reasoned correctly or hallucinated, and take corrective action within minutes instead of hours.

### Functional Job
Retrieve and read the exact LLM reasoning behind a specific observation or intent evaluation to diagnose whether the agent's logic was sound.

### Emotional Job
Feel confident and in control when investigating agent failures -- knowing the full "why" is available, not just the "what."

### Social Job
Demonstrate to the team that autonomous agents are debuggable and transparent, not black boxes that require blind trust.

### Four Forces Analysis

| Force | Description |
|-------|-------------|
| **Push** | When an agent creates a false-positive conflict observation, the admin currently has no way to see WHY the LLM reached that conclusion. They must re-run the scan mentally, guess at the prompt, or read raw logs. This wastes 30-60 minutes per incident. |
| **Pull** | One-click "View Logic" toggle on any observation or intent shows the exact chain-of-thought. Root cause identified in under 2 minutes. The reasoning is right there, next to the observation text. |
| **Anxiety** | "Will storing reasoning bloat the database?" / "Will this expose prompt internals that shouldn't be visible to all users?" / "Will the reasoning be stale or misleading if the underlying data changed?" |
| **Habit** | Currently, admins grep server logs (`observer.llm.call`, `observer.scan.llm_filtered`) to find reasoning. It works but is slow and requires terminal access. |

### Assessment
- Switch likelihood: **High** -- the push is strong (no current way to see reasoning in-context) and the pull is immediately tangible.
- Key blocker: Anxiety about access control (reasoning is internal telemetry, not for all agents).
- Key enabler: Push from painful log-grepping workflow.
- Design implication: Reasoning must be stored as internal telemetry visible to Observer and workspace admins only. "View Logic" toggle in UI, not shown by default.

---

## Job 2: Drift Detection

### Job Story

**When** the Observer agent is evaluating whether agent behavior has degraded over time (e.g., verification confidence scores are trending downward, or anomaly evaluations are increasingly being filtered as false positives),
**I want to** audit the reasoning across multiple observations to detect patterns of degraded reasoning quality,
**so I can** catch behavioral drift before it compounds into systemic failures.

### Functional Job
Query and compare LLM reasoning across a time range of observations to identify reasoning quality degradation patterns.

### Emotional Job
Feel proactive rather than reactive -- catching drift early rather than discovering it after a cascade of bad decisions.

### Social Job
Demonstrate to stakeholders that the autonomous system has self-monitoring capabilities -- it does not just act, it audits its own logic.

### Four Forces Analysis

| Force | Description |
|-------|-------------|
| **Push** | The Observer currently detects drift through signals (stale tasks, status mismatches) but cannot audit its own reasoning quality. If the LLM starts producing lower-quality verdicts, this is invisible until false positives pile up. The behavior scorer has no access to reasoning content. |
| **Pull** | Reasoning stored on observations enables the behavior scorer to evaluate reasoning quality over time. The Observer can load recent reasoning as context for self-calibration. Trend analysis becomes possible: "In the last 50 observations, reasoning length dropped 40% and confidence scores clustered at 0.71 (just above threshold)." |
| **Anxiety** | "Will programmatic reasoning analysis itself be unreliable?" / "How much additional token cost to analyze stored reasoning?" |
| **Habit** | Currently, drift is detected through output patterns only (observation severity distribution, confidence histograms). Adding reasoning analysis is a new capability, not a replacement. |

### Assessment
- Switch likelihood: **High** -- this is a new capability that does not exist today. No habit to overcome.
- Key blocker: Anxiety about reliability of meta-reasoning (LLM evaluating LLM reasoning).
- Key enabler: Strong pull from behavior scoring system that already exists but lacks reasoning data.
- Design implication: Reasoning must be queryable by the Observer agent and behavior scorer programmatically. Not just a UI feature.

---

## Job 3: Audit and Compliance

### Job Story

**When** reviewing a sequence of agent-authorized actions for compliance (e.g., an intent was authorized that spent budget, or an observation led to an automated learning proposal),
**I want to** see the full provenance chain -- from intent reasoning through evaluation through observation reasoning through learning proposal,
**so I can** verify that every step in the autonomous chain was justified by sound logic and evidence.

### Functional Job
Trace the complete reasoning chain from intent submission through authorization evaluation through observation creation through learning diagnosis, with LLM reasoning visible at each node.

### Emotional Job
Feel assured that the autonomous system is auditable and that no agent action happened without traceable justification.

### Social Job
Demonstrate to external auditors, compliance reviewers, or skeptical stakeholders that autonomous agent actions have complete, machine-readable provenance.

### Four Forces Analysis

| Force | Description |
|-------|-------------|
| **Push** | The intent table stores human `reasoning` and the trace table stores model stats, but the LLM's actual chain-of-thought for authorization evaluation (`evaluation.reason` is a one-line summary) is not captured. For observations, the `text` field is the agent's output, not its reasoning process. Auditors cannot distinguish "what the agent concluded" from "how it got there." |
| **Pull** | Full provenance: Intent has human reasoning + LLM authorization reasoning. Observation has agent conclusion text + LLM verification reasoning. Trace has model stats. Together: complete audit trail from intent to action to verification to learning. |
| **Anxiety** | "Will reasoning storage create legal liability?" / "Will it be used against us if reasoning contains errors?" / "Is this GDPR-relevant if reasoning mentions user names?" |
| **Habit** | Currently, `evaluation.reason` on intent is the only LLM reasoning persisted, and it's a one-line summary. Teams treat this as sufficient. Changing the expectation to full chain-of-thought requires culture shift. |

### Assessment
- Switch likelihood: **Medium** -- habit of treating one-line summaries as sufficient is real. Push becomes stronger as the system handles higher-stakes actions.
- Key blocker: Habit of treating summary-level reasoning as "good enough."
- Key enabler: Pull from increasing autonomy scope (budget-spending intents, automated learning proposals) making full audit trails non-negotiable.
- Design implication: LLM reasoning on intents needs a distinct field from human `reasoning`. Naming must be unambiguous: `llm_reasoning` vs existing `reasoning`.

---

## Opportunity Scoring

| # | Outcome Statement | Imp. (%) | Sat. (%) | Score | Priority |
|---|-------------------|----------|----------|-------|----------|
| 1 | Minimize the time to determine why an agent created a specific observation | 95 | 15 | 17.6 | Extremely Underserved |
| 2 | Minimize the likelihood of undetected reasoning quality degradation | 85 | 10 | 16.0 | Extremely Underserved |
| 3 | Maximize the likelihood that every autonomous action has traceable justification | 90 | 40 | 14.0 | Underserved |
| 4 | Minimize the time to trace provenance from intent through observation to learning | 80 | 25 | 12.4 | Underserved |
| 5 | Minimize the likelihood of exposing internal reasoning to unauthorized consumers | 75 | 60 | 9.0 | Overserved (existing access control patterns) |
| 6 | Minimize the storage cost of persisting LLM reasoning | 60 | 70 | 6.0 | Overserved |

### Scoring Method
- Importance: estimated % of workspace admins/Observer use cases rating 4+ on 5-point scale
- Satisfaction: estimated % satisfied with current state (log-grepping, one-line summaries)
- Score: Importance + max(0, Importance - Satisfaction)
- Source: team estimate based on codebase analysis and issue #154 discussion
- Confidence: Medium (team estimates, not user interviews)

### Top Opportunities (Score >= 12)
1. **Root cause diagnosis speed** (17.6) -- Store reasoning on observation, expose via "View Logic"
2. **Reasoning drift detection** (16.0) -- Make reasoning queryable for behavior scoring
3. **Full provenance chain** (14.0) -- Add `llm_reasoning` field to intent for authorization chain-of-thought
4. **Cross-entity provenance tracing** (12.4) -- Enable trace navigation from intent -> observation -> learning with reasoning at each node

### Overserved Areas (Score < 10)
1. **Access control** (9.0) -- Existing workspace-scoped access patterns are sufficient; no new auth model needed
2. **Storage cost** (6.0) -- Reasoning strings are small relative to embeddings already stored; not a real concern

---

## Job-to-Story Mapping (Preview)

| Job | Primary Stories |
|-----|----------------|
| J1: Forensic Debugging | US-01: Persist LLM reasoning on observations, US-03: "View Logic" toggle in observation detail UI |
| J2: Drift Detection | US-01 (shared), US-04: Observer loads reasoning for self-calibration |
| J3: Audit/Compliance | US-02: Persist LLM reasoning on intents, US-05: Provenance chain navigation |

Note: US-01 serves both J1 and J2 (N:1 mapping). All stories detailed in `docs/requirements/intent-llm-traces/`.
