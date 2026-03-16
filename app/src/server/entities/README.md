# Entities

Entity search, detail retrieval, and work item acceptance — the read/write API for interacting with knowledge graph nodes.

## The Problem

The knowledge graph contains thousands of entities across 15+ types (tasks, decisions, projects, features, observations). Users need to find entities by text, view their relationships and provenance, and accept suggested work items into the graph. The search must be fast (BM25 full-text, not vector) for the UI, while the detail view must expose the full relationship web around any entity.

## What It Does

- **BM25 full-text search**: Per-entity-type SQL queries with literal string interpolation (SurrealDB limitation — `@N@` doesn't work with bound parameters)
- **Entity detail**: Loads an entity with all relationships, provenance chains, and neighboring nodes
- **Work item acceptance**: Converts PM agent suggestions into actual task/feature/project records with embeddings and project linking
- **Action endpoints**: Entity-specific mutations (confirm decision, acknowledge observation, etc.)

## Key Concepts

| Term | Definition |
|------|------------|
| **BM25 Search** | SurrealDB's built-in full-text search with snowball stemming — used for UI search, not semantic |
| **Entity Detail** | Full entity record + incoming/outgoing edges + provenance + neighbors |
| **Work Item Accept** | Flow: PM suggests → user accepts → task/feature created in graph with embedding |
| **Fulltext Index** | Per-field `FULLTEXT ANALYZER` index with `BM25(1.2, 0.75)` scoring |

## How It Works

**Search flow:**

1. User types "rate limiting" in search bar
2. `GET /api/entities/search?q=rate+limiting&workspace=...`
3. Handler escapes single quotes, builds per-type SQL with `@1@` match operator
4. SurrealDB returns BM25-scored results across task, decision, feature, project, observation tables
5. Results ranked by `search::score(1)`, deduplicated, returned to UI

**Work item acceptance:**

1. PM agent suggests: `{ type: "task", title: "Migrate billing to tRPC", project: "infra" }`
2. User clicks "Accept" in chat UI
3. `POST /api/workspaces/:id/work-items/accept` with suggestion payload
4. Handler creates `task` record, generates embedding, links to project via `belongs_to` edge
5. Returns created entity ID for UI navigation

## Where It Fits

```text
UI Search Bar                PM Agent Suggestions
  |                              |
  v                              v
GET /entities/search        POST /work-items/accept
  |                              |
  v                              v
BM25 fulltext queries       Create task/feature record
  |                           + embedding
  v                           + belongs_to edge
Scored results                   |
                                 v
                            Created entity in graph
```

**Consumes**: Search queries, work item suggestions from PM agent
**Produces**: Search results, entity detail views, created graph nodes

## File Structure

```text
entities/
  entity-search-route.ts       # BM25 full-text search with per-type SQL generation
  entity-detail-route.ts       # Entity detail with relationships and provenance
  entity-action-route.ts       # Entity-specific mutations (confirm, acknowledge, etc.)
  work-item-accept-route.ts    # Convert PM suggestions into graph records
```
