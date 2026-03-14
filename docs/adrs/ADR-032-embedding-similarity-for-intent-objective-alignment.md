# ADR-032: Embedding Similarity for Intent-Objective Alignment

## Status
Proposed

## Context
When an agent submits an intent, the system must determine which strategic objective (if any) the intent serves. Three approaches were considered for computing alignment between intent goals and objectives.

The alignment evaluation runs in the hot path of intent authorization and must complete within 200ms. The workspace may have 5-50 active objectives.

## Decision
Use cosine similarity between pre-computed embeddings (intent.goal embedding vs objective embeddings) via SurrealDB's HNSW index with the two-step KNN pattern.

Thresholds:
- >= 0.7: automatic `supports` edge creation
- 0.5-0.7: link to highest, surface for human confirmation
- < 0.5 for all objectives: warning observation (intent proceeds)

## Alternatives Considered

### Alternative 1: LLM-based alignment evaluation
- **What**: Send intent goal + all objective descriptions to LLM, ask for alignment classification
- **Expected Impact**: Higher accuracy (95%+ vs 85% for embeddings), handles nuance
- **Why Insufficient**: Adds 2-8 seconds to authorization path (violates 200ms requirement). LLM failures would block or degrade intent authorization. Cost scales with objective count per evaluation

### Alternative 2: Rule-based keyword matching
- **What**: Match intent action_spec.action against objective-linked keywords/tags
- **Expected Impact**: Sub-millisecond, deterministic, no LLM cost
- **Why Insufficient**: Requires manual keyword maintenance per objective. Misses semantic relationships ("implement auth flow" aligns with "improve security posture" but shares no keywords). Brittle to phrasing variation

### Alternative 3: Hybrid (embedding pre-filter + LLM confirmation)
- **What**: Use embedding similarity as first pass, then LLM for ambiguous matches (0.5-0.7 range)
- **Expected Impact**: Best accuracy for ambiguous cases
- **Why Insufficient**: Adds complexity. Ambiguous cases already surface for human confirmation via feed cards, making LLM confirmation redundant. Can be added later if human confirmation proves insufficient

## Consequences
- **Positive**: Sub-200ms evaluation. Reuses existing embedding pipeline. No additional LLM calls. Deterministic and auditable (score recorded on `supports` edge)
- **Negative**: May misclassify semantically nuanced alignments (mitigated by human confirmation for 0.5-0.7 range). Embedding quality depends on model quality
- **Risk**: If embedding model changes dimension, all objective embeddings must be regenerated (existing risk shared with all other entity embeddings)
