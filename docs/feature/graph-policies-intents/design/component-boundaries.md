# Component Boundaries: Graph Policies and Intents

## Overview

This feature requires NO new components. All changes extend existing modules within established boundaries. The architecture follows the existing modular monolith with dependency inversion (contracts.ts as shared contract, server queries as driven adapters, React components as driving adapters).

## Modified Components

### 1. Shared Contract Layer

**File**: `app/src/shared/contracts.ts`
**Boundary**: Type definitions shared between server and client
**Change**: Add `"policy"` to `EntityKind` union type

This is the single highest-risk change -- `EntityKind` is consumed by every component that renders or processes entities. Adding a new member requires all exhaustive switch statements to handle it.

**Downstream impact**:
- `graph-theme.ts` -- entityColor, entityMutedColor (both CSS and hex variants)
- `EntityBadge.tsx` -- KIND_LABELS
- `transform.ts` -- entityColor (hex)
- Any component doing exhaustive EntityKind matching

### 2. Graph Query Layer (Server)

**File**: `app/src/server/graph/queries.ts`
**Boundary**: SurrealDB graph traversal and entity resolution
**Changes**:
- Extend `GraphEntityTable` union with `"intent"` | `"policy"`
- Extend `readEntityName()` to handle `intent` (read `goal` field) and `policy` (read `title` field)

**Constraint**: `GraphEntityRecord` type is derived from `GraphEntityTable`, so both update together.

### 3. SurrealQL Graph Functions (Schema)

**File**: `schema/surreal-schema.surql` (via migration)
**Boundary**: Server-side graph traversal functions
**Changes**:
- `fn::workspace_entity_ids` -- add policy traversal (via `protects` edge) and intent traversal (via `workspace` field)
- `fn::edges_between` -- add `governing, protects, triggered_by, gates, vetoed_by` to FROM clause
- `fn::graph_neighbors` -- add same governance relation tables to FROM clause

**Constraint**: These are `DEFINE FUNCTION OVERWRITE` -- migration replaces existing definitions.

### 4. Graph Route (Server)

**File**: `app/src/server/graph/graph-route.ts`
**Boundary**: HTTP handler for graph API endpoint
**Change**: Extend focused-view `entityTables` allowlist to include `"intent"` and `"policy"`

### 5. Graph Transform (Server)

**File**: `app/src/server/graph/transform.ts`
**Boundary**: Converts raw graph data to reagraph format (hex colors for WebGL)
**Change**: Add `"policy"` case to `entityColor()` function

### 6. Graph Theme (Client)

**File**: `app/src/client/components/graph/graph-theme.ts`
**Boundary**: CSS variable mapping for entity kinds + edge styling
**Changes**:
- Add `"policy"` case to `entityColor()` (CSS variables)
- Add `"policy"` case to `entityMutedColor()` (CSS variables)
- Add governance edge styles to `edgeStyle()` for relation types: `governing`, `protects`, `triggered_by`, `gates`, `vetoed_by`

### 7. Entity Badge (Client)

**File**: `app/src/client/components/graph/EntityBadge.tsx`
**Boundary**: Renders colored kind labels
**Change**: Add `"intent"` and `"policy"` to `KIND_LABELS` record

### 8. Feed Queries (Server)

**File**: `app/src/server/feed/feed-queries.ts`
**Boundary**: Workspace-scoped feed item queries
**Changes**:
- New function `listRecentlyVetoedIntents()` -- queries intents with status `'vetoed'` within 24h window, joins `vetoed_by` edge for reason
- Extend `readEntityNameByTable()` to handle `"intent"` (goal) and `"policy"` (title)

### 9. Feed Route (Server)

**File**: `app/src/server/feed/feed-route.ts`
**Boundary**: HTTP handler for governance feed endpoint
**Changes**:
- Wire `listRecentlyVetoedIntents()` into `Promise.all` batch
- Map vetoed intents to `GovernanceFeedItem` in awareness tier

## Component Dependency Graph

```
contracts.ts (EntityKind)
  |
  +-- graph-theme.ts (entityColor, entityMutedColor, edgeStyle)
  +-- EntityBadge.tsx (KIND_LABELS)
  +-- transform.ts (entityColor hex)
  +-- graph-route.ts (entityTables allowlist)
  +-- queries.ts (GraphEntityTable, readEntityName)
  |     |
  |     +-- surreal-schema.surql (fn::workspace_entity_ids, fn::edges_between, fn::graph_neighbors)
  |
  +-- feed-queries.ts (readEntityNameByTable, listRecentlyVetoedIntents)
  |     |
  |     +-- surreal-schema.surql (intent table)
  |
  +-- feed-route.ts (awareness tier wiring)
```

## What is NOT Changing

- **Policy engine** (`server/policy/`) -- already complete, no modifications
- **Intent creation/evaluation flow** -- already complete
- **Schema tables** -- policy and intent tables already defined
- **Relation tables** -- governing, protects, triggered_by, gates, vetoed_by already defined
- **API endpoints** -- no new routes, extending existing `/graph` and `/feed` responses
- **CSS custom properties** -- new `--entity-policy` variables added to stylesheet (crafter decides exact values)
