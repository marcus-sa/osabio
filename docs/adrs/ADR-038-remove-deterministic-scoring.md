# ADR-038: Remove Deterministic Scoring Mode

## Status
Accepted

## Context

ADR-037 introduced a `scoring_mode` field on `behavior_definition` to route scoring between deterministic pure-function scorers and the LLM scorer. In practice:

- No deterministic definitions were created by users — all definitions use LLM scoring
- The deterministic scorers (`scoreTddAdherence`, `scoreSecurityFirst`) were seed-data artifacts, not user-facing features
- The `scoring_mode` field and dispatcher routing added complexity without delivering value
- Maintaining two scoring paths increases the surface area for bugs and testing burden
- The LLM scorer handles structured telemetry equally well when given appropriate `scoring_logic` instructions

The original rejection reason for removing deterministic scorers (ADR-037, Alternative 1) cited speed, cost, and predictability. These concerns are less relevant now:

- **Speed**: LLM scoring is async and non-blocking; latency does not impact the agent's current action
- **Cost**: LLM scoring cost is negligible per-evaluation and amortized across the value of behavioral governance
- **Predictability**: The `scoring_logic` field in the definition gives admins explicit control over evaluation criteria

## Decision

Remove the deterministic scoring path entirely:

1. Delete the `ScoringMode` type and `scoring_mode` field from all type definitions
2. Delete `scorer.ts` (deterministic scorer functions) and its unit tests
3. Simplify `scorer-dispatcher.ts` to always use the LLM scorer
4. Remove `scoring_mode` from the `behavior_definition` schema via migration `0038_remove_scoring_mode.surql`
5. Remove `scoring_mode` from API request/response serialization
6. Remove `seedDeterministicDefinition` test helper

All scoring now flows through a single path:

```
telemetry -> definition match -> LLM scorer -> behavior record
```

## Migration

```sql
-- 0038_remove_scoring_mode.surql
BEGIN TRANSACTION;
REMOVE FIELD scoring_mode ON behavior_definition;
UPDATE behavior_definition UNSET scoring_mode;
COMMIT TRANSACTION;
```

## Consequences

### Positive
- Single scoring path: simpler dispatcher, fewer tests, less code
- No seed definitions needed during workspace bootstrap
- Definition authors have full control via `scoring_logic` text — no hidden routing logic
- Removes a type (`ScoringMode`) and field that leaked implementation detail into the domain model

### Negative
- If a use case emerges that genuinely needs deterministic scoring (e.g., high-frequency telemetry where LLM cost matters), a new mechanism would need to be designed. This is unlikely given current usage patterns.

## Supersedes

[ADR-037: Deterministic and LLM Scorer Coexistence](ADR-037-deterministic-llm-scorer-coexistence.md)
