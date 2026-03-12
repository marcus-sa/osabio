# Opportunity Scores: Observer LLM Reasoning

Scoring method: Importance (1-10) vs Current Satisfaction (1-10).
Opportunity Gap = Importance - Satisfaction.
Higher gap = stronger opportunity.

| Rank | Job | Importance | Satisfaction | Gap | Rationale |
|:----:|-----|:----------:|:------------:|:---:|-----------|
| **1** | J1 — Semantic contradiction detection | 9 | 3 | **6** | Core value proposition. Deterministic matching catches <20% of real contradictions. Highest user pain. |
| **2** | J3 — Cross-signal pattern synthesis | 8 | 2 | **6** | No current capability at all. Manual triage doesn't scale. Equal gap but slightly lower importance than J1. |
| **3** | J2 — Reasoning-quality peer review | 7 | 4 | **3** | Current peer review exists but is shallow. Incremental improvement over baseline. |
| **4** | J4 — Contextual NL verdicts | 6 | 5 | **1** | Templates work. Nice-to-have upgrade. Comes nearly free once LLM is in the loop for J1/J3. |

## Implementation Sequencing

1. **J1 first** — extends the existing per-event verification pipeline. Natural entry point for LLM integration. Each verification type (task, decision, intent, commit) gets a reasoning step.
2. **J3 second** — extends graph scan with LLM synthesis. Builds on J1's LLM infrastructure (model client, prompt patterns, grounding strategy).
3. **J4 implicitly** — once J1/J3 produce LLM-generated reasoning, the observation text quality improves as a side effect. May need minimal formatting work.
4. **J2 last** — peer review reasoning is the most nuanced (judging another agent's logic). Benefits from patterns established in J1/J3.

## Risk Mitigation for Top Opportunities

| Risk | Mitigation |
|------|------------|
| LLM hallucination (false contradictions) | Ground LLM with structured graph context. Require entity references in output. Confidence threshold before creating observations. |
| Cost at scale | Use Haiku-class model. Cache workspace context across verifications in same scan. Skip LLM for high-confidence deterministic matches. |
| Latency on event path | LLM reasoning runs async (observer already fires via ASYNC events). User never waits for observer. |
| Alert fatigue from synthesis | Synthesis observations require minimum 2 contributing signals. Dedup against existing open observations. |
