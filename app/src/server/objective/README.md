# Objective

Strategic goal tracking with vector-based intent alignment — links objectives to projects, features, and tasks so agent work stays directional.

## The Problem

Agents are productive, but are they productive on the right things? Without objectives, agents optimize locally — completing tasks efficiently but potentially drifting from strategic goals. Objectives provide alignment context: "Is this task aligned with our Q1 goals?" The answer comes from vector similarity between intent embeddings and objective embeddings, not manual tagging.

## What It Does

- **Objective CRUD**: Create, read, update, delete strategic goals with descriptions and embeddings
- **Intent alignment**: KNN vector search matches agent intents to relevant objectives via cosine similarity
- **Progress tracking**: Computes objective progress by traversing linked intents in the graph
- **Similarity thresholds**: >= 0.7 matched (strong alignment), 0.5-0.7 ambiguous (needs review), < 0.5 unaligned

## Key Concepts

| Term | Definition |
|------|------------|
| **Objective** | A strategic goal with title, description, and embedding vector |
| **Alignment** | Cosine similarity between intent and objective embeddings — measures how well agent work serves the goal |
| **KNN Search** | Two-step pattern (SurrealDB v3.0 workaround): HNSW search for candidates, then workspace filter |
| **Progress** | Computed by traversing `supports` edges from intents to objectives — counts completed vs. total |
| **Ambiguous Alignment** | 0.5-0.7 similarity range — surfaced for human review rather than auto-linked |

## How It Works

**Alignment check:**

1. Agent creates intent: "Implement token bucket rate limiter"
2. Intent embedding generated from description
3. KNN search on objective embeddings: `WHERE embedding <|5, COSINE|> $intentVec`
4. Results: "Improve API reliability" (similarity: 0.82), "Reduce infrastructure costs" (similarity: 0.45)
5. First objective passes 0.7 threshold → `supports` edge created automatically
6. Second objective below 0.5 → no alignment

**Progress computation:**

1. `GET /api/workspaces/:id/objectives/:id/progress`
2. Traverse: `objective <-supports<- intent` edges
3. Count intents by status: completed, executing, authorized, failed
4. Return: `{ total: 12, completed: 8, executing: 2, progress: 0.67 }`

## Where It Fits

```text
Strategic Goals (Objectives)
  |
  +---> Embedding vector (for KNN alignment)
  |
  v
Intent Created by Agent
  |
  +---> KNN search against objective embeddings
  |       +-> >= 0.7: auto-link (supports edge)
  |       +-> 0.5-0.7: flag for review
  |       +-> < 0.5: no alignment
  |
  v
Progress Tracking
  +---> Traverse supports edges
  +---> Count intent statuses
  +---> Compute completion ratio
```

**Consumes**: Objective definitions, intent embeddings, graph state
**Produces**: Alignment scores, `supports` edges, progress metrics

## File Structure

```text
objective/
  objective-route.ts     # HTTP endpoints: CRUD + progress computation
  queries.ts             # SurrealDB CRUD for objectives with embedding storage
  alignment-adapter.ts   # KNN search adapter (two-step SurrealDB v3.0 workaround)
  alignment.ts           # Cosine similarity logic and threshold classification
```
