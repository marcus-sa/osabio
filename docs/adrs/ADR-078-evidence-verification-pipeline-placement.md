# ADR-078: Evidence Verification Pipeline Placement in Intent Evaluation

## Status
Proposed

## Context

The intent evaluation pipeline currently runs: policy gate (~5ms) -> LLM evaluation (~2-5s) -> risk routing. A new evidence verification pipeline (~10-30ms) must be inserted to validate that agent-submitted `evidence_refs` are legitimate graph records before authorization decisions are made.

The evidence verification pipeline serves two purposes:
1. **Hard gate**: Under hard enforcement, reject intents with insufficient evidence before the expensive LLM call
2. **Context enrichment**: Provide verification results to the LLM evaluator and risk router

The placement must satisfy: p95 verification latency < 100ms, zero false negatives, and evidence context available to both LLM and risk router.

## Decision

Insert the evidence verification pipeline **after the policy gate and before the LLM evaluator** in the `evaluateIntent` function:

```
policy gate (~5ms) -> evidence verification (~10-30ms) -> [hard enforcement gate] -> LLM evaluation (~2-5s) -> risk routing
```

The pipeline follows the same architectural pattern as `evaluatePolicyGate`: pure functions composed around a single effect boundary (one batched SurrealDB query).

## Alternatives Considered

### Before policy gate
- **Rejected**: Wastes 10-30ms verifying evidence on intents that the policy gate would reject for free in ~5ms. The policy gate is the cheapest check and should remain first.

### After LLM evaluator
- **Rejected**: Hard enforcement cannot reject pre-LLM (wasting 2-5s on an intent that will be rejected anyway). The LLM evaluator cannot use evidence context in its assessment.

### Parallel with LLM evaluator
- **Rejected**: Adds concurrency complexity. Hard enforcement requires sequential access to verification results before the LLM call. The 10-30ms verification cost is negligible compared to the 2-5s LLM call, so parallelism provides no meaningful latency improvement.

## Consequences

### Positive
- Policy-rejected intents skip evidence verification (cheapest-first ordering)
- Hard enforcement rejects insufficient intents before the expensive LLM call
- LLM evaluator receives evidence context for better risk assessment
- Risk router has verification results for evidence shortfall penalty
- Verification latency (~10-30ms) does not meaningfully impact end-to-end pipeline time

### Negative
- The `evaluateIntent` function grows in complexity (one more pipeline stage)
- Evidence verification must complete synchronously before LLM evaluation can start
