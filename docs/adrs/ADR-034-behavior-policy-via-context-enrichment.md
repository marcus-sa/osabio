# ADR-034: Behavior Policy Enforcement via Context Enrichment

## Status
Proposed

## Context
Policy rules must evaluate agent behavior scores (e.g., "deny production deploy if Security_First < 0.8"). The existing policy system uses `IntentEvaluationContext` with dot-path field resolution and comparison operators. The question is how to make behavior scores available to policy rules.

## Decision
Enrich `IntentEvaluationContext` with a `behavior_scores` object (keyed by metric_type) before passing to the existing policy gate. Policy rules reference scores via dot-path: `behavior_scores.security_first` with operator `lt` and value `0.8`.

No changes to the policy table schema, predicate evaluator, or rule condition format. The existing `RulePredicate` type with `field`, `operator`, `value` already supports this pattern.

## Alternatives Considered

### Alternative 1: Dedicated behavior condition type in policy rules
- **What**: Add a new `behavior_condition` field type to `PolicyRule` alongside `condition`. New evaluator function specific to behavior lookups
- **Expected Impact**: Type-safe behavior references. Explicit separation from general-purpose conditions
- **Why Insufficient**: Requires schema migration to add new field to policy rules. Requires new evaluator code path. The existing predicate evaluator with dot-path resolution already handles nested object field access (`behavior_scores.security_first`). Adding a parallel evaluation path increases complexity without adding capability

### Alternative 2: SurrealDB-side behavior lookup in policy evaluation
- **What**: Policy evaluation queries run in SurrealDB stored functions that join behavior data at query time
- **Expected Impact**: No application-level context enrichment needed
- **Why Insufficient**: SurrealDB stored functions have limitations (no `search::score` in functions, etc.). Moving evaluation logic into SurrealQL reduces testability (can't unit test pure functions). Existing policy gate is a well-tested pure pipeline in TypeScript -- adding SurrealQL evaluation breaks that pattern

### Alternative 3: Behavior scores as a separate gate (not part of policy)
- **What**: Dedicated "behavior gate" running after policy gate, with its own configuration separate from policies
- **Expected Impact**: Clean separation of concerns. Behavior rules managed independently
- **Why Insufficient**: Duplicates the gate pattern (load rules, evaluate conditions, build result). Users would need to manage two rule systems. Policy rules with dot-path already provide a unified governance model. The "behavior gate" is just a policy with behavior_scores in the condition -- no need for a separate concept

## Consequences
- **Positive**: Zero schema changes to policy system. Zero changes to predicate evaluator. Existing policy creation UI/API works unchanged. Policy rules are the single governance model for all intent evaluation. Fully testable (enrichment + evaluation are separate pure steps)
- **Negative**: `IntentEvaluationContext` grows with each new enrichment source. Behavior score lookup adds latency to authorization (mitigated: single indexed query, sub-millisecond). If no behavior record exists for a metric, the field is undefined and the predicate returns false (safe default: condition doesn't match, intent proceeds)
- **Risk**: Policy creators must know the dot-path format (`behavior_scores.<metric_type>`). Mitigated by documentation and future UI autocomplete for condition fields
