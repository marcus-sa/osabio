# Shared Artifacts Registry: Graph Policies & Intents

Epic: `graph-policies-intents`
Date: 2026-03-11

---

## EntityKind Type Union

| Field | Value |
|-------|-------|
| **Source of truth** | `app/src/shared/contracts.ts` -- `EntityKind` type |
| **Current value** | `"workspace" \| "project" \| "person" \| "identity" \| "feature" \| "task" \| "decision" \| "question" \| "observation" \| "suggestion" \| "message" \| "agent_session" \| "intent"` |
| **Required change** | Add `"policy"` to the union |
| **Owner** | shared contracts |
| **Integration risk** | **HIGH** -- every consumer of EntityKind must handle the new variant. TypeScript exhaustive switch will catch most gaps. |

**Consumers:**
- `graph-theme.ts` -- `entityColor()` and `entityMutedColor()` switch statements
- `EntityBadge.tsx` -- `KIND_LABELS` record
- `feed-route.ts` -- feed item `entityKind` field
- `feed-queries.ts` -- `readEntityNameByTable()` helper
- `graph-route.ts` -- `entityTables` array in focused view
- `queries.ts` -- `GraphEntityTable` type and query functions

---

## GraphEntityTable Type

| Field | Value |
|-------|-------|
| **Source of truth** | `app/src/server/graph/queries.ts` -- `GraphEntityTable` type |
| **Current value** | `"workspace" \| "project" \| "person" \| "identity" \| "feature" \| "task" \| "decision" \| "question" \| "observation" \| "suggestion"` |
| **Required change** | Add `"intent"` and `"policy"` |
| **Owner** | graph queries module |
| **Integration risk** | **HIGH** -- controls which tables appear in graph traversal queries |

**Consumers:**
- `graph-route.ts` -- `entityTables` array passed to `parseRecordIdString()`
- `queries.ts` -- all graph query functions (overview, project, focused)

---

## graph-theme.ts Color Mappings

| Field | Value |
|-------|-------|
| **Source of truth** | `app/src/client/components/graph/graph-theme.ts` |
| **Current state** | `intent` maps to `var(--entity-feature)` (feature color). `policy` is **missing** (will cause TypeScript error when added to EntityKind). |
| **Required change** | Add `policy` case. Consider dedicated CSS custom properties (`--entity-policy`, `--entity-intent`) or reuse existing colors with semantic mapping. |
| **Owner** | graph UI components |
| **Integration risk** | **MEDIUM** -- visual only, but exhaustive switch means TypeScript will error if not handled |

**Consumers:**
- `KnowledgeGraph.tsx` -- node fill colors
- `EntityBadge.tsx` -- badge background/text colors
- `InlineRelationshipGraph.tsx` -- inline graph styling
- `ChatSuggestionPills.tsx` -- suggestion pill colors
- `SuggestionToolCard.tsx` -- card accent colors

---

## KIND_LABELS Record

| Field | Value |
|-------|-------|
| **Source of truth** | `app/src/client/components/graph/EntityBadge.tsx` |
| **Current value** | Missing entries for `"intent"`, `"policy"`, `"message"`, `"identity"`, `"agent_session"` |
| **Required change** | Add `intent: "Intent"` and `policy: "Policy"` |
| **Owner** | graph UI components |
| **Integration risk** | **LOW** -- fallback to raw kind string exists (`KIND_LABELS[kind] ?? kind`) |

**Consumers:**
- `EntityBadge.tsx` -- badge label text

---

## Feed Query: Vetoed Intents

| Field | Value |
|-------|-------|
| **Source of truth** | `app/src/server/feed/feed-queries.ts` (to be created) |
| **Current state** | Does not exist. Only `listPendingVetoIntents` exists (blocking tier). |
| **Required change** | Add `listRecentlyVetoedIntents()` function querying intents with `status = 'vetoed'` and `updated_at > 24h_cutoff` |
| **Owner** | feed queries module |
| **Integration risk** | **MEDIUM** -- new query function, follows existing patterns |

**Consumers:**
- `feed-route.ts` -- called in `Promise.all`, mapped to awareness tier items

---

## Feed Route: Vetoed Intent Mapping

| Field | Value |
|-------|-------|
| **Source of truth** | `app/src/server/feed/feed-route.ts` |
| **Current state** | Maps `pendingVetoIntents` to blocking tier. No vetoed intent mapping. |
| **Required change** | Add vetoed intent loop in awareness tier section. Map to `GovernanceFeedItem` with tier "awareness", reason including veto context. |
| **Owner** | feed route |
| **Integration risk** | **LOW** -- follows existing pattern of other awareness tier items |

**Consumers:**
- Feed API response (`GovernanceFeedResponse.awareness`)
- GovernanceFeed UI component

---

## Graph Queries: Policy & Intent Traversal

| Field | Value |
|-------|-------|
| **Source of truth** | `app/src/server/graph/queries.ts` |
| **Current state** | Graph queries traverse workspace/project/person/identity/feature/task/decision/question/observation/suggestion. No policy or intent tables. |
| **Required change** | Add policy and intent tables to graph traversal. Include `governing`, `protects`, `triggered_by`, `gates` edge types. Filter: only active/testing policies, only non-terminal intents (exclude completed/vetoed/failed). |
| **Owner** | graph queries module |
| **Integration risk** | **HIGH** -- core graph data, affects all graph views |

**Consumers:**
- `graph-route.ts` -- workspace overview, project view, focused view
- `transform.ts` -- ReagraphNode/ReagraphEdge transformation

---

## readEntityNameByTable Helper

| Field | Value |
|-------|-------|
| **Source of truth** | `app/src/server/feed/feed-queries.ts` |
| **Current state** | Handles workspace, project, person, feature, task, decision, question. Does not handle intent, policy, observation, suggestion. |
| **Required change** | Add `intent` case (return `row.goal`) and `policy` case (return `row.title`) |
| **Owner** | feed queries module |
| **Integration risk** | **MEDIUM** -- used by conflict detection and recent extractions; new entity types need name resolution |

**Consumers:**
- `listWorkspaceConflicts()` -- conflict entity name resolution
- `listRecentExtractions()` -- extraction entity name resolution

---

## Edge Styles

| Field | Value |
|-------|-------|
| **Source of truth** | `app/src/client/components/graph/graph-theme.ts` -- `edgeStyle()` |
| **Current state** | Handles `depends_on`, `conflicts_with`, `belongs_to`, `has_feature`, `has_task`, `has_project`. |
| **Required change** | Add `governing`, `protects`, `triggered_by`, `gates` edge styles. Consider dashed lines for governance edges to distinguish from structural edges. |
| **Owner** | graph UI components |
| **Integration risk** | **LOW** -- falls back to default style, purely visual |

**Consumers:**
- `KnowledgeGraph.tsx` -- edge rendering
