# Evolution: Observer LLM Reasoning

**Date**: 2026-03-12
**Feature**: observer-llm-reasoning
**Branch**: marcus-sa/observer-agent

## Summary

Added optional LLM reasoning to the observer agent's verification, peer review, and graph scan pipelines. The observer previously relied on deterministic string matching and keyword heuristics, catching roughly 20% of semantic contradictions. With LLM reasoning enabled (via `OBSERVER_MODEL` env var), the observer now uses Vercel AI SDK `generateObject` with structured Zod schemas to perform semantic analysis -- detecting contradictions that require understanding intent behind decisions, not just keyword overlap.

The feature is fully optional. When `OBSERVER_MODEL` is unset, the observer operates in deterministic-only mode with zero LLM calls and no behavioral change from the pre-existing baseline.

## What Was Built

### Semantic Verification Pipeline (Event-Triggered)

When a task completes or a decision is confirmed, the observer:
1. Runs existing deterministic claim-vs-reality comparison
2. Optionally invokes LLM with entity context + related decisions + external signals (CI status)
3. Produces a structured verdict (match/mismatch/inconclusive) with confidence score and evidence references
4. Creates observations with `observes` edges linking to both the entity and any contradicted decisions

### Pattern Synthesis Pipeline (Scan-Triggered)

After the existing graph scan collects anomalies (stale blockers, status drift, contradictions):
1. Anomalies are partitioned by type (top 20 per type for large workspaces)
2. LLM synthesizes anomalies into named patterns (bottleneck_decision, cascade_block, priority_drift, etc.)
3. Patterns with fewer than 2 contributing entities are discarded
4. Duplicate patterns (same entities, same type) are deduplicated against existing open observations

### Peer Review Pipeline (Event-Triggered)

When a non-observer agent creates an observation with cited evidence (`observes` edges):
1. LLM evaluates the observation's claim against the linked entity details
2. Produces a review verdict: sound (>=0.7 confidence), questionable (0.4-0.7), or unsupported (<0.4)
3. Review observation links back to the original via `observes` edge
4. Cascade prevention: observer never peer-reviews its own observations

### Skip Optimization

Per-workspace setting (`workspace.settings.observer_skip_deterministic`, defaults to `true`) that skips LLM calls when the deterministic verdict is "match" and CI is passing. Targets >= 50% cost reduction on typical workspaces. Disabling forces full LLM coverage for high-risk workspaces.

### Graceful Degradation

Every LLM call path has a deterministic fallback:
- LLM timeout (10s) -> deterministic verdict with `source=deterministic_fallback`
- LLM rate limit or error -> same fallback
- LLM confidence < 0.5 -> downgrade to inconclusive, severity=info
- Hallucinated entity refs -> post-validation strips invalid references

## Architecture

```
SurrealDB EVENT (task/decision state change)
  |
  v
Observer Route (effect shell)
  |-- Context Loader (effect boundary) -- loads related decisions, constraints, tasks
  |-- Deterministic Pipeline (pure core) -- existing claim-vs-reality comparison
  |-- Verdict Logic (pure core) -- skip optimization, confidence thresholds, fallback
  |-- LLM Reasoning (effect boundary) -- generateObject with structured verdict schema
  |-- Evidence Validator (pure core) -- strips invalid entity refs from LLM output
  |-- Observation Writer (effect boundary) -- creates observation + observes edges
```

Follows the codebase's pure core / effect shell pattern. Pure functions handle skip logic, confidence thresholds, evidence validation. Effect boundaries handle DB queries, LLM calls, and observation persistence. Dependencies point inward.

## Key Decisions

### ADR-023: Observer LLM Reasoning via generateObject

Selected `generateObject` (single-shot structured output) over ToolLoopAgent, embedding similarity, or fine-tuned classifiers. Rationale: observer reasoning is bounded -- context is pre-assembled from the triggering event. Tool use would add unpredictable latency and cost without benefit. Structured output eliminates free-text parsing.

### ADR-024: Observer Deterministic Skip Optimization

Per-workspace configurable skip optimization. When deterministic verdict + CI confirmation are strong, skip the LLM call. Controlled via `workspace.settings.observer_skip_deterministic` (not a global env var) because different workspaces have different risk profiles.

### ADR-025: Observer Model Optional with Graceful Degradation

`OBSERVER_MODEL` is optional with no implicit fallback to another model. Either explicitly configured or LLM reasoning is off. This preserves backward compatibility, avoids surprise cost from implicit model sharing, and keeps the deterministic pipeline as the tested baseline.

## Implementation Stats

- **Phases**: 4 (infrastructure, semantic verification, decision/synthesis, peer review/observability)
- **Steps**: 12 (all completed 2026-03-12)
- **New files**: 5 (schemas.ts, llm-reasoning.ts, llm-synthesis.ts, context-loader.ts, evidence-validator.ts)
- **Modified files**: 8 (config.ts, dependencies.ts, types.ts, observer-route.ts, verification-pipeline.ts, graph-scan.ts, agent.ts, queries.ts)
- **Schema migration**: 1 (0029_observer_llm_fields.surql -- confidence, evidence_refs on observation; settings on workspace)
- **Zero new dependencies**: All functionality built on existing ai, zod, surrealdb, @openrouter/ai-sdk-provider packages

## Test Coverage

### Acceptance Tests

Organized by milestone, covering the full feature surface:

- **Milestone 1 (Schema)**: Schema validation -- new fields exist on observation and workspace tables
- **Milestone 2 (Semantic Verification)**: Task verification with passing CI, failing CI, no signals, graceful degradation when model unavailable
- **Milestone 3 (Decision/Synthesis)**: Graph scan contradiction detection, stale blocked tasks, deduplication, status drift, LLM synthesis patterns
- **Milestone 4 (Peer Review)**: PM observation peer review, architect observation review, no-loop guard (observer does not review own observations), cascade prevention

### Eval Suite

- `observer-llm-reasoning.eval.ts`: Exercises LLM reasoning effect boundary with real model calls (verification verdicts, peer review verdicts)

### Unit Tests

- Schema parsing (verdict, synthesis pattern, peer review verdict schemas)
- Evidence validator (strips invalid refs, preserves valid ones)
- Skip optimization logic (workspace setting, deterministic match + CI passing)
- Confidence threshold logic (< 0.5 downgrade)

### Observability

Structured logging across all pipelines:
- `observer.llm.call` -- LLM invocation with latency_ms and model ID
- `observer.llm.skip` -- skip with reason (deterministic_match, no_model)
- `observer.llm.error` / `observer.llm.fallback` -- failure tracking
- `observer.llm.synthesis` -- pattern synthesis results
- `observer.llm.peer_review` -- peer review verdicts

## Future Considerations

- **Confidence calibration**: Track predicted vs actual contradiction rates to tune confidence thresholds over time
- **Batch verification on project import**: When a new project is imported with many tasks/decisions, batch-verify alignment instead of waiting for individual events
- **Cross-project pattern synthesis**: Currently synthesis is workspace-scoped; cross-project patterns (e.g., conflicting decisions across related projects) could surface higher-order insights
- **Model selection per pipeline**: Different pipelines may benefit from different models (e.g., larger model for synthesis, smaller for simple verification)
- **User feedback loop**: Allow users to mark observations as accurate/inaccurate to improve prompt tuning
