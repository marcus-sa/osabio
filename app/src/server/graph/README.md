# Graph

Core graph query layer — entity search, relationship traversal, embedding-based semantic search, and graph visualization transforms.

## The Problem

The knowledge graph is the single source of truth, but raw SurrealDB queries are complex — especially when combining KNN vector search with workspace scoping (which hits a SurrealDB v3.0 bug), traversing multi-hop relationships, or building BFS views for visualization. This module provides the reusable query layer that all other modules build on.

## What It Does

- **Embedding-based search**: KNN search on HNSW indexes with cosine similarity scoring, using the two-step pattern to work around the SurrealDB v3.0 KNN+WHERE bug
- **Entity detail loading**: Fetches any entity with all incoming/outgoing edges, provenance chains, and neighbor summaries
- **Graph visualization**: BFS traversal from a center entity, output in Reagraph JSON format for the graph view UI
- **Workspace scoping**: All queries enforce workspace isolation via relationship traversal
- **Vector utilities**: Embedding creation and cosine similarity computation

## Key Concepts

| Term | Definition |
|------|------------|
| **Two-Step KNN** | SurrealDB v3.0 bug workaround: KNN in a `LET` subquery (HNSW only), then filter by workspace in a second query (B-tree only) |
| **Entity Neighbors** | Incoming and outgoing edges with relationship kind, used for detail views |
| **Focused Graph View** | BFS from a center entity at configurable depth, returned as nodes + edges for Reagraph |
| **Polymorphic ID** | `table:id` format for cross-type entity references, validated against an allowlist |
| **Reagraph Format** | JSON structure `{ nodes: [...], edges: [...] }` consumed by the React graph visualization component |

## How It Works

**Semantic search:**

1. Query text encoded to embedding vector via model
2. KNN search: `LET $candidates = SELECT ... FROM entity WHERE embedding <|20, COSINE|> $vec`
3. Workspace filter: `SELECT ... FROM $candidates WHERE workspace = $ws ORDER BY similarity DESC`
4. Results returned with cosine similarity scores

**Graph visualization:**

1. `GET /api/graph/:workspaceId?center=task:abc&depth=2`
2. BFS traversal from center entity, collecting all edges within depth
3. Transform SurrealDB output to Reagraph JSON format
4. Return `{ nodes, edges }` for rendering

## Where It Fits

```text
All Server Modules
  |
  v
Graph Query Layer (this module)
  |
  +---> searchEntitiesByEmbedding()  -- KNN with workspace filter
  +---> getEntityDetail()            -- entity + relationships + provenance
  +---> getFocusedGraphView()        -- BFS for visualization
  +---> listConversationEntities()   -- entities from conversation context
  +---> isEntityInWorkspace()        -- access control check
  |
  v
SurrealDB (HNSW + B-tree indexes)
```

**Consumes**: SurrealDB connection, embedding vectors, workspace scope
**Produces**: Search results, entity details, graph views, access control decisions

## File Structure

```text
graph/
  queries.ts      # SurrealDB query builders — search, detail, traversal, access control (~1,800 lines)
  embeddings.ts   # createEmbeddingVector() and cosineSimilarity() utilities
  graph-route.ts  # HTTP endpoints for graph views (workspace overview, focused view)
  transform.ts    # Convert SurrealDB output to Reagraph JSON format
```
