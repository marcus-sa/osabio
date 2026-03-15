# ADR-043: Reuse Existing Policy Engine for LLM Enforcement

## Status
Proposed

## Context
The proxy must enforce model access restrictions, budget limits, and rate limits before forwarding LLM requests. Brain already has a policy engine (`policy-gate.ts`) with condition evaluation, priority-sorted rules, and policy trace generation. The engine evaluates policies against an `IntentEvaluationContext`.

The question is whether to reuse this engine or build a separate enforcement system for the proxy.

## Decision
Reuse `evaluatePolicyGate()` from `policy-gate.ts` for model access enforcement. Extend the policy condition vocabulary to support LLM-specific predicates (`model`, `provider`). Implement budget and rate limiting as separate checks outside the policy gate (they require different data sources: spend counters and in-memory sliding windows).

Policy evaluation flow:
1. **Model access**: Evaluate via `evaluatePolicyGate()` with context `{ action: "llm_call", resource: modelId, agent_role: agentType }`
2. **Budget**: Query spend counter, compare against workspace-configured limit (separate from policy rules)
3. **Rate limit**: Check in-memory sliding window counter (not a DB query)

## Alternatives Considered

### Alternative 1: Build a dedicated LLM policy engine
- **What**: New `proxy-policy.ts` with LLM-specific rule evaluation
- **Expected impact**: Optimized for LLM enforcement, no adaptation needed
- **Why insufficient**: Duplicates policy evaluation logic. Two policy systems to maintain. Workspace admins would need to configure policies in two different places. Breaks Brain's principle that governance is unified in the policy graph.

### Alternative 2: Full intent system integration (create intent per LLM call)
- **What**: Create an `intent` record for each LLM request, run full authorization pipeline
- **Expected impact**: Complete provenance (intent -> authorized_by -> policy -> trace)
- **Why insufficient**: Intent creation requires DB write before forwarding (5-50ms). At 100-500 calls/day this adds significant overhead. The intent system is designed for discrete agent actions, not high-frequency LLM calls. A lightweight policy check (cached policies, in-memory evaluation) is more appropriate.

## Consequences
- **Positive**: Single policy graph for all Brain governance (agents + LLM calls); workspace admins configure in one place
- **Positive**: Policy trace entries on trace via `governed_by` edge provide audit trail without full intent overhead
- **Negative**: Policy condition vocabulary needs extension for LLM predicates (model, provider) -- small scope change to predicate-evaluator.ts
- **Negative**: Budget and rate limiting are not part of the policy gate (they live alongside it as separate pre-request checks)
