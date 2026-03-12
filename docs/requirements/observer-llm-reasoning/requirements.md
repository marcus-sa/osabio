# Requirements: Observer LLM Reasoning

## Stakeholders

| Stakeholder | Role | Needs |
|-------------|------|-------|
| Marcus Santos | Workspace owner | High signal-to-noise observations; catch semantic contradictions automatically |
| Jamie Park | DevOps lead | Cost controls, latency visibility, model configuration |
| Chat Agent | System consumer | Low-latency observations in context for entity queries |
| PM Agent | System producer/consumer | Reasoning quality feedback on its own observations |
| Coding Agents (MCP) | System consumer | Clear, actionable contradiction signals before implementing tasks |

## Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| Enhanced regex/keyword matching | Requires human-curated rules per decision type. Current deterministic observer uses this approach and catches ~20% of real contradictions. Does not generalize to novel decision language. |
| User-defined contradiction rules | High maintenance burden. Users would need to tag every decision with contradiction patterns. Doesn't scale beyond 10-20 active decisions. |
| Manual escalation (flag ambiguous cases) | Adds human review overhead. Defeats the purpose of autonomous observation. Acceptable as fallback (see R3) but not primary mechanism. |

---

## R1 — LLM Verification Pipeline Integration

The observer verification pipeline must support an optional LLM reasoning step that evaluates semantic contradictions between entities and their related decisions/constraints.

**Traces to:** J1 (Semantic Contradiction Detection)

**Constraints:**
- LLM call is optional — deterministic pipeline remains the fallback
- LLM receives structured context (entity + decisions + constraints + signals), never raw graph queries
- LLM produces structured output (verdict, confidence, reasoning, evidence refs)
- Confidence threshold = 0.5: verdicts >= 0.5 create conflict/match observations; < 0.5 downgrade to inconclusive
- Related decisions scope: all confirmed/provisional decisions in the task's project, ordered by updated_at DESC, limited to 20

## R2 — Configurable LLM Skip Optimization

The pipeline must support a configurable skip optimization that bypasses the LLM call when the deterministic verification already produces a high-confidence result. Users control whether this optimization is active.

**Traces to:** J1 (Four Forces — Anxiety: cost at scale)

**Constraints:**
- Environment variable: `OBSERVER_SKIP_DETERMINISTIC` (default: `true`)
- When `true`: skip LLM if deterministic verdict == "match" AND external signals confirm (e.g. CI passing). Reduces cost by avoiding redundant LLM calls
- When `false`: always invoke LLM regardless of deterministic result. Ensures every event gets semantic reasoning (higher cost, higher coverage)
- Track LLM call count and skip rate for observability regardless of setting
- Use Haiku-class model (cheapest capable model)
- Target skip rate when enabled: >= 50% of events

## R3 — LLM Fallback on Failure

When the LLM call fails (timeout, rate limit, service unavailable), the pipeline must fall back to the deterministic verdict without blocking or erroring.

**Traces to:** J1 (Four Forces — Anxiety: LLM reliability)

**Constraints:**
- Timeout per LLM call: 10s (configurable)
- Fallback observation includes source "deterministic_fallback" for tracking
- No retry within the same event (SurrealDB EVENT RETRY handles full-pipeline retry)

## R4 — Cross-Signal Pattern Synthesis

The graph scan must support an LLM synthesis step that correlates individual anomalies into named patterns with minimum evidence thresholds.

**Traces to:** J3 (Cross-Signal Pattern Synthesis)

**Constraints:**
- Minimum 2 contributing entities per pattern (2 distinct entities, not 2 anomaly types)
- Pattern names from controlled vocabulary: `bottleneck_decision`, `cascade_block`, `priority_drift`, `stale_cluster`, `contradiction_cluster`
- Synthesis observations link to all contributing entities via observes edges
- Deduplication against existing open pattern observations before creation

## R5 — Structured LLM Output Schema

All LLM interactions must use structured output (JSON schema) to ensure parseable, validatable results and prevent hallucinated entity references.

**Traces to:** J1, J3 (Four Forces — Anxiety: hallucination)

**Constraints:**
- Verification verdict schema: verdict, confidence (float 0-1), reasoning, evidence_refs, optional contradiction
- Synthesis pattern schema: pattern_name (enum), description, contributing_entities, severity, suggested_action
- Post-validation: strip evidence_refs that don't resolve to real entity IDs in the workspace

## R6 — LLM Reasoning Peer Review

The observer's peer review path (triggered by observation_peer_review EVENT) must use LLM reasoning to evaluate whether a non-observer observation's claim follows from its cited evidence.

**Traces to:** J2 (Reasoning-Quality Peer Review)

**Constraints:**
- Only reviews observations that cite evidence (have observes edges)
- Creates a review observation linked to the reviewed observation
- Review verdict: "sound" (confidence >= 0.7), "questionable" (0.4-0.7), "unsupported" (<0.4)
- Does not modify or delete the reviewed observation
- Cascade prevention unchanged (source_agent != "observer_agent" guard)

## R7 — Model Configuration

The observer LLM model must be configurable via environment variable, consistent with the existing model configuration pattern.

**Traces to:** All jobs (infrastructure)

**Constraints:**
- Environment variable: `OBSERVER_MODEL` (follows `CHAT_AGENT_MODEL`, `PM_AGENT_MODEL` pattern)
- When unset: LLM reasoning disabled, deterministic-only mode
- Model client reuses existing inference provider abstraction (OpenRouter/Ollama)

## R8 — Latency Constraints (NFR)

LLM reasoning must not degrade event processing or user experience.

**Traces to:** All jobs (non-functional)

**Constraints:**
- Observer already runs via ASYNC events — user never waits for observer
- LLM call must complete within 10s or fall back to deterministic (per R3)
- Expected p95 latency: ~1.5s for Haiku on 4k context window
- Track p95 latency per model for observability

## R9 — Cost Controls (NFR)

Observer LLM usage must have measurable and controllable cost impact.

**Traces to:** All jobs (non-functional)

**Constraints:**
- Haiku-class model default (est. <$5/month per typical workspace with skip optimization)
- Skip optimization (R2) targets >= 50% of events to avoid unnecessary LLM calls
- Track actual LLM call count per workspace for cost visibility

## R10 — Large Workspace Handling (NFR)

Pattern synthesis must handle workspaces with many anomalies without exceeding LLM context limits.

**Traces to:** J3 (non-functional)

**Constraints:**
- For workspaces with 50+ anomalies, partition by type (contradictions, stale blockers, drift) and send top 20 per type to LLM
- Remaining anomalies reported as individual standard observations
- If single partition exceeds context window, truncate to most recent 20 by created_at
