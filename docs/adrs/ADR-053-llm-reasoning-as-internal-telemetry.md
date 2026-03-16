# ADR-053: Store LLM Reasoning as Internal Telemetry on Intent and Observation Nodes

## Status

Proposed

## Context

Brain's Observer agent and Intent Authorizer both invoke LLMs to produce structured verdicts (verification, peer review, contradiction detection, anomaly evaluation, authorization risk assessment). Each verdict includes a `reasoning` field -- the LLM's chain-of-thought explaining why it reached its conclusion.

Currently this reasoning is:
- **Used at runtime** (e.g. `applyLlmVerdict` copies `llmVerdict.reasoning` into `VerificationResult.text`, `evaluateAnomalies` returns per-entity `reasoning` used in observation text construction)
- **Not persisted as a distinct field** on the observation or intent record
- **Conflated with observation text** -- the observation's `text` field sometimes contains raw LLM reasoning, sometimes a deterministic template, sometimes a hybrid (template + appended LLM reasoning)

This creates three problems:
1. **Forensic opacity** -- workspace admins cannot distinguish LLM-generated reasoning from deterministic observation text
2. **Self-calibration blind spot** -- the Observer cannot query its own past reasoning to detect drift or calibrate confidence thresholds
3. **Behavior scorer limitation** -- behavior scoring cannot evaluate reasoning quality without parsing free-text observation bodies

The Intent Authorizer has a parallel gap: `createLlmEvaluator` returns `{ decision, risk_score, reason }` where `reason` is a one-line summary. The full chain-of-thought from the LLM evaluation prompt is not captured. The existing `evaluation.reason` field on the intent record stores this summary but not the deeper reasoning.

## Decision

Add `reasoning` as an optional string field to the `observation` table, and `llm_reasoning` as an optional string field to the `intent` table. These fields store the raw LLM chain-of-thought from the generating pipeline, distinct from the human-facing `text` (observation) or `reasoning` (intent, which is the human-provided rationale).

### Observation reasoning

Pipe the LLM `reasoning` string from each of the 4 observer LLM paths through to `createObservation`:

| LLM Path | Source Function | Reasoning Field |
|----------|----------------|-----------------|
| Verification verdict | `generateVerificationVerdict` | `LlmVerdict.reasoning` |
| Peer review | `generatePeerReviewVerdict` | `PeerReviewVerdict.reasoning` |
| Contradiction detection | `detectContradictions` (graph-scan) | `DetectedContradiction.reasoning` |
| Anomaly evaluation | `evaluateAnomalies` | `AnomalyEvaluation.reasoning` |

Additionally, trace-response-analyzer's `verifyContradiction` and `verifyMissingDecision` produce reasoning that should be persisted.

Deterministic observations (no LLM call) have no reasoning -- the field is omitted.

### Intent LLM reasoning

Capture the Authorizer LLM's chain-of-thought from `createLlmEvaluator` and persist it as `llm_reasoning` on the intent record alongside the existing `evaluation` object. This is distinct from:
- `intent.reasoning` -- human-provided rationale for why the agent wants to take the action
- `intent.evaluation.reason` -- one-line summary from the LLM evaluator

When evaluation is policy-only (no LLM called), `llm_reasoning` is omitted.

### No model_stats duplication

Model telemetry (tokens, cost, latency, provider) already lives on the `trace` table. Observations link to traces via `source_session` -> `agent_session` -> `invoked` -> `trace`. Intents link via `trace_id`. No model statistics are duplicated on observation or intent records.

### Access control

LLM reasoning is internal telemetry, not user-facing content. API responses for observation and intent detail include reasoning only for workspace admin roles. The UI renders reasoning in a collapsible panel with three states: reasoning available, deterministic (no reasoning), legacy (pre-migration, no reasoning).

## Alternatives Considered

### Alternative 1: Embed reasoning in observation text (current behavior)

- **What**: Continue appending LLM reasoning to the observation `text` field
- **Expected impact**: Zero implementation effort
- **Why insufficient**: Cannot distinguish LLM reasoning from deterministic text programmatically. Observer self-calibration and behavior scorer cannot extract reasoning without fragile text parsing. Forensic debugging requires manual inspection.

### Alternative 2: Separate reasoning_trace table with edges

- **What**: Create a `reasoning_trace` table linked to observations/intents via graph edges
- **Expected impact**: Full separation of concerns, supports versioning and multi-step reasoning chains
- **Why insufficient**: Over-engineering for current needs. Single LLM call per observation/intent means one reasoning string, not a chain. The trace table already captures call-level telemetry. Adding a table + edges + queries for a single string field violates simplest-solution-first. Can evolve to this later if multi-step reasoning pipelines emerge.

### Alternative 3: Store reasoning on the trace record instead

- **What**: Add `reasoning` field to the existing `trace` table
- **Expected impact**: Centralizes all LLM output in traces
- **Why insufficient**: Not all observations have a direct trace link (graph-scan observations are created in bulk without per-observation traces). Would require creating trace records for every observation, changing the graph-scan pipeline significantly. The reasoning is a property of the observation/intent, not of the LLM call itself.

## Consequences

### Positive

- Forensic debugging: admins can inspect exactly why the Observer or Authorizer made a decision
- Self-calibration: Observer can query past reasoning to detect drift patterns
- Behavior scoring: scorer can evaluate reasoning quality directly
- Backward compatible: existing observations/intents without reasoning continue to work (field is optional)

### Negative

- Storage increase: ~200-500 bytes per LLM-generated observation (reasoning text)
- Schema migration required: new fields on two SCHEMAFULL tables
- API surface increase: observation detail and intent detail responses grow for admin users
