# Suggestion

Agent-to-human proposals — persists suggestions in the graph with embeddings, evidence linking, and collision detection.

## The Problem

Agents notice things humans should consider: optimization opportunities, risks, conflicts, missing elements, potential pivots. These aren't observations (which are signals about current state) — they're proposals for action. Suggestions bridge the gap between agent intelligence and human decision-making, with full provenance so you know why the agent is suggesting it.

## What It Does

- **Suggestion creation**: Persists proposals with text, category, confidence, rationale, and source agent
- **Evidence linking**: Links suggestions to supporting entities (decisions, observations, tasks) via `evidence` edges
- **Target linking**: Connects suggestions to the entity they're about (project, feature, task) via relation edges
- **Embedding generation**: Embeds suggestion text for semantic search and deduplication
- **Collision detection**: Prevents duplicate suggestions via embedding similarity

## Key Concepts

| Term | Definition |
|------|------------|
| **Suggestion** | A proposal from an agent with text, category, confidence (0-1), rationale, and evidence links |
| **Category** | `optimization`, `risk`, `opportunity`, `conflict`, `missing`, `pivot` |
| **Confidence** | Agent's self-reported confidence in the suggestion (0-1) |
| **Evidence** | Supporting entities that justify the suggestion — linked via edges for provenance |
| **Target** | The entity the suggestion is about — a project, feature, task, or decision |

## How It Works

1. Observer detects a pattern of three similar contradictions
2. Pattern synthesizer creates suggestion: "Consider creating a learning to prevent recurring database technology contradictions" (category: `optimization`, confidence: 0.85)
3. `createSuggestion()` generates embedding, creates record, links evidence observations
4. Suggestion appears in workspace feed
5. Human reviews → accepts → converts to task or learning via feed action

## Where It Fits

```text
Agents (Observer, PM, Chat)
  |
  v
Create Suggestion
  +---> text + category + confidence + rationale
  +---> evidence links (supporting entities)
  +---> target link (entity it's about)
  +---> embedding (for dedup and search)
  |
  v
Graph (suggestion node + edges)
  |
  +---> Feed (surfaced to human)
  +---> Accept -> convert to task/learning/decision
  +---> Dismiss -> archived
```

**Consumes**: Agent findings, entity references, confidence scores
**Produces**: Suggestion records with evidence and target edges

## File Structure

```text
suggestion/
  queries.ts   # createSuggestion(), collision detection, pattern synthesis queries
```
