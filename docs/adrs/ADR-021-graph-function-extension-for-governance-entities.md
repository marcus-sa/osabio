# ADR-021: Graph Function Extension for Governance Entities

## Status
Proposed

## Context

The graph view queries use three SurrealQL functions to discover and connect entities:
- `fn::workspace_entity_ids` -- collects all entity record IDs in a workspace
- `fn::edges_between` -- finds relation edges between a set of entity IDs
- `fn::graph_neighbors` -- finds adjacent entities for focused view traversal

Policy and intent tables exist in the schema (migrations 0021, 0024) with governance relation tables (`governing`, `protects`, `triggered_by`, `gates`, `vetoed_by`), but these are NOT included in the graph functions. Policy/intent nodes and governance edges are invisible in the graph view.

We need to decide how to include governance entities in graph traversal.

## Decision

Extend the existing SurrealQL graph functions via a new migration (`DEFINE FUNCTION OVERWRITE`):

1. **`fn::workspace_entity_ids`**: Add `$policies` (via `protects` edge to workspace) and `$intents` (via `workspace` field) to the returned entity ID array.
2. **`fn::edges_between`**: Add `governing, protects, triggered_by, gates, vetoed_by` to the FROM clause.
3. **`fn::graph_neighbors`**: Add the same five governance relation tables to the FROM clause.

## Alternatives Considered

### Alternative 1: Separate governance graph endpoint
- **What**: New `/api/workspaces/:id/graph/governance` endpoint that queries only policy/intent subgraph
- **Expected Impact**: 100% of governance visualization (separate view)
- **Why Insufficient**: Fragments the graph view. Users want to see policies alongside the entities they govern, not in isolation. Would require client-side graph merging for unified view.

### Alternative 2: Client-side overlay query
- **What**: Frontend makes a second API call to fetch governance nodes/edges, merges them into the existing graph
- **Expected Impact**: 100% of visualization, avoids server function changes
- **Why Insufficient**: Duplicates graph construction logic on the client. Creates consistency issues between main graph and overlay. Doubles API calls per graph load.

## Consequences

### Positive
- Single graph query returns complete topology including governance relationships
- No new API endpoints or client-side merging logic
- Governance edges visible in focused view (clicking a policy shows connected workspace, clicking an intent shows connected task/session)
- Consistent with how all other entity types are integrated

### Negative
- Graph query returns more nodes -- policy/intent nodes appear alongside domain entities (mitigated by color-coding and edge styling to distinguish governance topology)
- Migration replaces three SurrealQL functions atomically -- failure requires rollback (mitigated by `BEGIN TRANSACTION`)
- Intent nodes may be numerous in active workspaces (mitigated by SurrealDB query planning; workspace-scoped filter keeps result set bounded)
