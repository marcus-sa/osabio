# ADR-037: Deterministic and LLM Scorer Coexistence

## Status
Superseded by [ADR-038](ADR-038-remove-deterministic-scoring.md)

## Context

The existing behavior module has two deterministic scorers (`scoreTddAdherence`, `scoreSecurityFirst`) that compute scores as pure ratios from structured telemetry. The new dynamic behavior definitions introduce an LLM-based scorer for semantic evaluation. Both must coexist:

- Existing deterministic scorers are trusted, fast, and free (no LLM cost)
- LLM scorers enable new capabilities (measuring honesty, evidence-grounding) that ratios cannot capture
- The Authorizer's `enrichBehaviorScores()` must return scores from both sources in a unified `Record<string, number>`
- The Observer's trend analysis (`analyzeTrend`) is already metric-type-agnostic

## Decision

Introduce a **scorer dispatcher** that routes scoring based on the `scoring_mode` field of the matched `behavior_definition`:

- `scoring_mode = "deterministic"` -> delegates to existing `scoreTelemetry()` in `scorer.ts`
- `scoring_mode = "llm"` -> delegates to new `scoreTelemetryWithLlm()` in `llm-scorer.ts`

### Unification Model

Existing hardcoded metrics (TDD_Adherence, Security_First) are represented as `behavior_definition` records with `scoring_mode=deterministic`. These "seed definitions" are created during workspace bootstrap or via migration.

This means:
- **One source of truth**: all behavioral standards are `behavior_definition` records
- **One query path**: `getLatestBehaviorScores()` queries `behavior` table regardless of how scores were produced
- **One UI**: the Behavior Library shows both deterministic and LLM-scored definitions
- **One trend pipeline**: the Observer analyzes trends for all metric types uniformly

### Deterministic Scorer Preservation

The existing `scorer.ts` pure functions are not modified. They remain the fastest, most reliable path for structured telemetry. The dispatcher simply wraps the existing call:

```
telemetry -> definition match -> scoring_mode?
  deterministic: validateTelemetryShape() + scoreTelemetry() -> ScorerResult
  llm:           assembleContext() + generateObject() -> LlmScorerResult
```

Both paths produce a `behavior` record via `createBehavior()`.

### Telemetry Shape Handling

- Deterministic scorers require specific telemetry fields (e.g., `files_changed`, `test_files_changed`). The existing `validateTelemetryShape()` handles this.
- LLM scorers accept any telemetry payload as a JSON object. The LLM interprets the payload in context of the definition's `scoring_logic`.
- The dispatcher validates shape for deterministic mode and passes through for LLM mode.

## Alternatives Considered

### Alternative 1: Rewrite deterministic scorers as LLM scorers
- **What**: Remove deterministic scorers entirely. All scoring goes through LLM.
- **Expected Impact**: Simplifies to one code path.
- **Why Rejected**: Deterministic scorers are faster (0ms vs 2-30s), cheaper (free vs LLM API cost), more predictable (ratio math vs LLM interpretation), and already trusted by users. Replacing them with LLM scorers would be a regression in all three quality attributes. The Four Forces analysis confirms "habit" strength around deterministic scoring.

### Alternative 2: Separate pipelines with separate storage
- **What**: LLM scores stored in a different table (`llm_behavior`) from deterministic scores.
- **Expected Impact**: Clean separation of concerns.
- **Why Rejected**: Breaks the unified `behavior_scores` map that the Authorizer consumes. Forces the Authorizer to query two tables and merge results. Duplicates the trend analysis pipeline. The `behavior` table is already metric-type-agnostic -- there is no reason to split storage by scoring method.

### Alternative 3: Keep deterministic scorers as hardcoded, definitions for LLM only
- **What**: Do not represent TDD_Adherence/Security_First as `behavior_definition` records. Keep them as hardcoded special cases.
- **Expected Impact**: Less migration work, simpler initial implementation.
- **Why Rejected**: Creates two mental models for admins ("some metrics are in the library, some are magic"). The Behavior Library UI would need special-case rendering for hardcoded metrics. The Observer would need two code paths for trend-based learning proposals. Unifying into `behavior_definition` records costs one migration query (seed 2 records) and eliminates all special-casing downstream.

## Consequences

### Positive
- Unified data model: all behavioral standards are definition records
- Unified UI: Behavior Library shows everything in one place
- Deterministic scorers preserved: no regression in speed, cost, or reliability
- Observer and Authorizer need zero changes to their query logic
- Adding a new deterministic scorer in the future follows the same pattern (create definition with `scoring_mode=deterministic`, implement scorer function, register in dispatcher)

### Negative
- Seed definitions must be created for existing metrics. This is a one-time migration step in `0037_behavior_definition.surql`.
- The dispatcher adds a routing layer between telemetry and scoring. Complexity increase is minimal (single switch on `scoring_mode`).
- If the seed definitions are accidentally archived, deterministic scoring stops matching new telemetry. Mitigation: seed definitions should not be archivable (or UI should warn).
