# ADR-054: Vector Search Agent Routing Over Deterministic Rules

## Status
Accepted

## Context
The Agent Coordinator needs to route observations to relevant agents. Observations are created by the Observer, extraction pipeline, or external webhooks. The system must determine which agents should act on each observation.

Two approaches were considered: a deterministic rule-based classifier (lookup table keyed on entity type + transition + severity → notification level per target) vs. vector search using existing observation embeddings against agent description embeddings.

The deterministic approach requires manually maintaining a classification rule table that maps every entity type, transition, and severity combination to agent targets. Adding a new agent type or observation category requires updating the rule table. The rule table cannot handle semantic nuance — an "API latency" observation should route to infrastructure agents, but the rule table can only match on explicit category strings.

## Decision
Use vector search (KNN on HNSW index) to route observations to agents. The observation's existing embedding is searched against agent description embeddings. Agents above a configurable similarity threshold are invoked. The KNN search is scoped to agents with active sessions in the same workspace.

## Alternatives Considered

### Alternative 1: Deterministic Rule-Based Classifier
- **What**: Pure function with lookup table: entity type + transition + severity → array of `{ target, level }`. Classification rules encoded as static table.
- **Expected Impact**: Sub-millisecond classification, fully deterministic, 100% unit-testable.
- **Why Rejected**: Cannot handle semantic relevance. Adding new agent types requires rule changes. Cannot distinguish between "API latency" routing to infrastructure vs. billing agents without explicit category mappings. Violates the project's "agentic design: no hardcoded modes" principle (AGENTS.md) — capabilities should be data-driven, not code branches.

### Alternative 2: LLM-Based Classification
- **What**: Send observation + agent descriptions to a fast model for relevance assessment.
- **Expected Impact**: Most nuanced routing, handles arbitrary observation-to-agent mappings.
- **Why Rejected**: Adds 200-500ms latency per observation. Costs money per event. Non-deterministic. Classification path becomes a point of failure if LLM is unavailable. Vector search provides sufficient semantic matching without these drawbacks.

## Consequences
- **Positive**: Adding a new agent type requires only embedding its description — no rule table changes. Routing is semantic, not syntactic.
- **Positive**: Observations already have embeddings (produced by extraction pipeline). Only new schema: `agent.description_embedding` field + HNSW index.
- **Positive**: KNN on HNSW index is sub-50ms for typical agent counts (< 100 agents per workspace). No LLM latency or cost.
- **Positive**: Similarity score provides a natural confidence/relevance signal — configurable threshold filters low-relevance matches.
- **Negative**: Less predictable than deterministic rules — same observation may route differently depending on which agents are active. Mitigated: similarity scores are logged for auditability.
- **Negative**: Requires the KNN + WHERE two-step query pattern (per SurrealDB v3.0 bug documented in CLAUDE.md).
