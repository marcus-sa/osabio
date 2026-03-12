# ADR-024: Observer Deterministic Skip Optimization

## Status

Accepted

## Context

The observer LLM reasoning step adds cost (~$0.001/event for Haiku) and latency (~1.5s p95) per verification. Many events have high-confidence deterministic results — e.g., a task with linked commits and passing CI is verifiably complete without LLM analysis.

We need a cost optimization strategy that avoids unnecessary LLM calls while preserving the ability to force full LLM coverage when desired (e.g., for workspaces where semantic contradictions are high-value).

## Decision

Implement a configurable skip optimization controlled per-workspace via `workspace.settings.observer_skip_deterministic` (defaults to `true` when absent).

When enabled (default):
- If deterministic verdict is `match` AND external signals confirm (e.g., CI passing), skip the LLM call
- Observation is created with the deterministic verdict (source: `github` or equivalent)
- Target: >= 50% of events skip LLM

When disabled (`false`):
- LLM is always invoked regardless of deterministic result
- Ensures every event gets semantic reasoning (higher cost, higher coverage)

This is a workspace-level setting, not a global env var, because different workspaces have different risk profiles — a production infrastructure workspace may want full LLM coverage while a documentation workspace can safely skip.

Skip rate is tracked via logging for observability regardless of setting.

## Alternatives Considered

### Alternative 1: Always invoke LLM (no skip optimization)
- **What**: Every event goes through LLM reasoning
- **Expected impact**: Maximum semantic coverage
- **Why rejected as default**: Majority of events are routine state transitions with clear external validation. LLM adds cost without value when deterministic + CI already confirm. Available via `OBSERVER_SKIP_DETERMINISTIC=false` for users who want it.

### Alternative 2: Token budget / rate limiter
- **What**: Set a max LLM calls per hour/day per workspace
- **Expected impact**: Hard cost cap
- **Why rejected**: Arbitrary limits may skip important events. Skip optimization is semantically driven (skip when evidence is strong), not budget-driven. Cost visibility through logging is sufficient for Haiku-class models.

### Alternative 3: Batch events and reason in bulk
- **What**: Collect events over N minutes, send batch to LLM
- **Expected impact**: Fewer LLM calls, amortized cost
- **Why rejected**: Adds delay to observation surfacing. Batching logic adds complexity (event queue, deduplication, partial failures). The observer's value is timely feedback. Async events already decouple from user latency.

## Consequences

### Positive
- >= 50% cost reduction on typical workspaces
- Zero latency for high-confidence deterministic events
- User can opt out of optimization when semantic coverage is more important than cost
- Observable: skip rate logged for tuning

### Negative
- Skipped events miss potential semantic contradictions that deterministic check cannot detect
- Additional conditional logic in verdict pipeline (small complexity cost)
- Configuration surface grows by one workspace setting field
