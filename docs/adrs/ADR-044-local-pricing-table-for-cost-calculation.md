# ADR-044: Local Pricing Table for Cost Calculation

## Status
Proposed

## Context
Each LLM call's cost must be computed from model-specific token pricing (input, output, cache write, cache read rates per million tokens). Cost must be computed at the time of the call so historical costs are not retroactively altered by pricing changes.

## Decision
Maintain a static TypeScript configuration object mapping model IDs to per-token rates. Updated manually when providers change pricing. Each `trace` records the cost computed at call time.

## Alternatives Considered

### Alternative 1: SurrealDB pricing table
- **What**: Store pricing in a `model_pricing` SCHEMAFULL table; query per request
- **Expected impact**: Admin-editable via UI; pricing changes without code deploy
- **Why insufficient**: Adds DB query to the hot path (or requires caching, which negates the DB benefit). Pricing changes are infrequent (quarterly). A code-level config change with server restart is acceptable for a team of 1-3.

### Alternative 2: Query Anthropic's Usage API per request
- **What**: Call Anthropic's cost API to get exact pricing per call
- **Expected impact**: Always-accurate pricing
- **Why insufficient**: Adds external API call to post-processing. Anthropic's Usage API is batch/billing-oriented, not real-time per-request. Introduces external dependency for cost calculation.

## Consequences
- **Positive**: Zero latency for cost calculation (in-memory lookup); no DB dependency on hot path
- **Positive**: Historical costs immutable (each trace records cost at time of call)
- **Negative**: Manual update required when providers change pricing (mitigated: pricing changes are announced weeks in advance; worst case is brief period of slightly inaccurate costs)
- **Negative**: Unknown model IDs produce zero cost with a warning observation (fail-safe: never blocks the request)
