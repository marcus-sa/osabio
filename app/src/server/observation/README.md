# Observation

Lightweight cross-cutting signals — agents write observations to the graph to surface contradictions, risks, patterns, and gaps for human review.

## The Problem

Agents discover things while working. A coding agent notices the implementation contradicts a confirmed decision. An observer detects that a task marked "done" has failing tests. These signals don't fit into existing entity types — they're not tasks (no one assigned them), not decisions (nothing was decided), and not questions (the agent isn't asking). Observations are the lightweight signal type that fills this gap.

## What It Does

- **Observation CRUD**: Create observations with severity, category, and evidence references
- **Severity levels**: `conflict` (contradictions needing human resolution), `warning` (risks), `info` (awareness)
- **Lifecycle management**: `open` -> `acknowledged` -> `resolved`
- **Entity linking**: `observes` edge connects observations to any entity (project, feature, task, decision, question)
- **Embedding generation**: Optional vector embeddings for semantic search and pattern detection

## Key Concepts

| Term | Definition |
|------|------------|
| **Observation** | A signal with text, severity, status, category, source agent, workspace, and optional embedding |
| **Severity** | `conflict` (needs human resolution), `warning` (risk to address), `info` (awareness only) |
| **Status** | `open` (new finding), `acknowledged` (human saw it), `resolved` (addressed) |
| **Category** | Classification: contradiction, duplication, missing, deprecated, pattern, anomaly |
| **observes Edge** | Relation linking observation to any graph entity — polymorphic target |

## How It Works

1. Agent detects issue: "REST endpoint in billing contradicts tRPC standardization decision"
2. Creates observation: `{ text: "...", severity: "conflict", category: "contradiction" }`
3. `observes` edge created to both the billing task and the tRPC decision
4. Observation appears in workspace feed (blocking tier for conflicts)
5. Human acknowledges → status: `acknowledged`
6. Migration task created → observation resolved: `resolved`

## Where It Fits

```text
Agents (coding, observer, PM)
  |
  v
Create Observation
  +---> severity: conflict | warning | info
  +---> category: contradiction | duplication | missing | ...
  +---> observes edge -> target entity
  |
  v
Graph (observation node + edges)
  |
  +---> Feed (prioritized by severity)
  +---> Observer (pattern detection)
  +---> Learning (suggests rules from recurring patterns)
```

**Consumes**: Agent findings, entity references, workspace scope
**Produces**: Observation records, `observes` edges, feed signals

## File Structure

```text
observation/
  queries.ts   # SurrealDB CRUD: create, acknowledge, resolve, list by workspace/entity
```
