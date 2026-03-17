# ADR-061: LLM Classification Over KNN for Agent Activation

## Status
Accepted

## Context
The Agent Activator needs to decide which registered agents should be started when an observation is created. Two approaches were considered:

1. **KNN vector search**: Embed observation text and agent descriptions, run cosine similarity, activate agents above a threshold.
2. **LLM classification**: Send observation + agent descriptions to a fast LLM, let it judge which agents can act on the observation.

## Decision
Use LLM classification (fast model, e.g. Haiku) instead of KNN vector search.

## Rationale
The question is "which agents can **act** on this observation?" — a judgment problem, not a proximity problem.

- **KNN measures word similarity, not capability**: "API latency exceeding SLA" is textually similar to both "infrastructure engineering" and "API documentation writer". KNN can't distinguish that only the infrastructure agent can act on the problem.
- **Agent descriptions are short text**: Cosine similarity on short text embeddings is noisy. High similarity doesn't mean relevance; low similarity doesn't mean irrelevance.
- **Edge cases require reasoning**: An observation about "billing API down" should go to both infra AND billing agents even if their descriptions don't textually overlap. LLM reasoning handles this naturally.
- **Severity context matters**: A `conflict` observation about a security vulnerability needs different agents than an `info` observation about the same topic. KNN ignores severity.
- **No threshold tuning**: KNN requires a similarity threshold that's hard to calibrate and varies by embedding model. LLM classification is a yes/no judgment per agent.

## Trade-offs
- LLM adds ~200-500ms latency per activation (Haiku). Acceptable: activations are async background work, not user-facing.
- LLM costs ~$0.001 per activation call. Negligible at expected observation volume.
- LLM can hallucinate agent IDs. Mitigated: validate returned IDs against registered agents.

## Alternatives Rejected
- **KNN vector search** (ADR-054): Too noisy for short descriptions, can't reason about capabilities vs similarity.
- **Deterministic rules** (original US-GRC-02): Can't handle new agent types without rule updates.
- **Hybrid (KNN pre-filter + LLM)**: Unnecessary complexity when agent count per workspace is small (< 100). LLM can handle the full list directly.

## Consequences
- `description_embedding` on `agent` table is no longer used by the activator (may be useful for other features later, kept in schema).
- Agent descriptions must be written for LLM comprehension, not embedding similarity.
- The activator depends on an LLM model (uses `extractionModel` / Haiku).
