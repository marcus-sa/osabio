# ADR-023: Observer LLM Reasoning via generateObject

## Status

Accepted

## Context

The observer agent currently uses deterministic string matching and keyword-based heuristics to detect contradictions between decisions and tasks. This catches ~20% of real semantic contradictions (per opportunity score analysis). The remaining ~80% require understanding intent behind decisions — e.g., "minimize external dependencies" vs a task adding Redis and Kafka.

The observer operates via SurrealDB ASYNC EVENTs, which fire HTTP webhooks to the observer route on entity state transitions. The current pipeline is: gather signals -> deterministic comparison -> persist observation.

We need to add LLM reasoning to this pipeline without breaking the deterministic fallback, without adding latency to user requests, and without introducing new deployment infrastructure.

## Decision

Use Vercel AI SDK `generateObject` with Zod-validated structured output schemas for all observer LLM reasoning. The LLM step is inserted after the deterministic pipeline as an optional enhancement.

Specifically:
- LLM is invoked via `generateObject({ model, schema, prompt })` — same pattern used by extraction pipeline, onboarding, and intent authorizer
- Output is constrained to Zod schemas (verdict, confidence, reasoning, evidence_refs) ensuring parseable, validatable results
- LLM is configured via `OBSERVER_MODEL` env var; when unset, deterministic-only mode
- All LLM failures fall back to deterministic verdicts

## Alternatives Considered

### Alternative 1: ToolLoopAgent (like PM agent)
- **What**: Use ToolLoopAgent with observer tools to let the LLM call search_entities, get_entity_detail, etc.
- **Expected impact**: Richer reasoning via tool use; LLM could explore the graph dynamically
- **Why rejected**: Observer reasoning is bounded — context is pre-assembled from the triggering event + related entities. Tool use adds unpredictable latency (multiple LLM round-trips), cost (tool calls multiply tokens), and complexity (agent loop management). The observer's job is to evaluate pre-gathered evidence, not explore. `generateObject` (single-shot structured output) is sufficient and cheaper.

### Alternative 2: Embedding similarity scoring
- **What**: Compare embeddings of decisions vs task titles/descriptions using vector cosine similarity
- **Expected impact**: Fast, cheap, no LLM call per event
- **Why rejected**: Cosine similarity measures semantic distance but not semantic contradiction. "Add Redis caching layer" and "minimize external dependencies" may have moderate similarity (both are about infrastructure) but are contradictory in intent. Reasoning about contradiction requires understanding intent, not just proximity.

### Alternative 3: Custom fine-tuned classifier
- **What**: Train a classifier on labeled contradiction/match pairs
- **Expected impact**: Lower per-call cost, deterministic latency
- **Why rejected**: Requires labeled training data we don't have. Fine-tuning adds maintenance overhead. Haiku-class models at ~$0.25/M tokens are already cost-effective for our volume (<1000 events/month per workspace).

## Consequences

### Positive
- Reuses existing `generateObject` pattern — no new abstractions
- Structured output eliminates free-text parsing
- Single-shot call keeps latency predictable (~1.5s p95 for Haiku)
- Deterministic fallback maintains reliability on LLM failure
- Provider-agnostic: works with OpenRouter and Ollama

### Negative
- Prompt engineering required for each verification type (task, decision, peer review)
- Structured output can still contain hallucinated entity references (mitigated by post-validation)
- Cost per event (~$0.001 for Haiku on 4k context) scales linearly with event volume
- Both paths (LLM-enabled and deterministic-only) require acceptance test coverage since OBSERVER_MODEL is optional
