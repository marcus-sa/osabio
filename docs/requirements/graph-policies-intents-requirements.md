# Functional Requirements: Graph Policies & Intents

Epic: `graph-policies-intents`
Date: 2026-03-11
Feature type: Cross-cutting (graph + feed + contracts)

---

## FR-1: Add "policy" to EntityKind contract

The `EntityKind` type union in `contracts.ts` must include `"policy"` as a valid entity kind. This is a prerequisite for all downstream work -- graph nodes, feed items, entity badges, and theme colors all derive from this type.

### Business Rule
Every entity type rendered in the UI must be declared in the `EntityKind` contract. Undeclared kinds cause TypeScript compilation failures in exhaustive switches.

### Domain Examples
1. Rena Okafor sees a policy node "Agent Budget Guard" in the graph -- the node's `data.kind` is `"policy"`
2. The governance feed returns a feed item with `entityKind: "policy"` for a deprecated policy alert
3. The EntityBadge component renders "Policy" label for policy entities using `KIND_LABELS["policy"]`

---

## FR-2: Add policy and intent nodes to graph queries

Graph query functions must include `policy` and `intent` tables in traversal. The workspace overview, project view, and focused view must all return policy and intent nodes with their edges.

### Business Rules
- Only policies with status `active` or `testing` appear in the graph (not `draft`, `deprecated`, or `superseded`)
- Only intents with non-terminal status appear in the graph: `draft`, `pending_auth`, `pending_veto`, `authorized`, `executing` (not `completed`, `vetoed`, `failed`)
- Policy edges: `governing` (identity -> policy), `protects` (policy -> workspace), `supersedes` (policy -> policy)
- Intent edges: `triggered_by` (intent -> task), `gates` (intent -> agent_session), `vetoed_by` (identity -> intent)

### Domain Examples
1. Rena opens the workspace graph. Policy "Agent Budget Guard" (active) appears connected to identities "ci-agent" and "dev-agent" via `governing` edges
2. Carlos opens the graph. Intent "Deploy v2.1 to staging" (executing) appears connected to task "Deploy to staging" via `triggered_by` and to agent session "deploy-agent-0312" via `gates`
3. Deprecated policy "Old Budget Rule" does not appear in the graph. Intent "Run test suite" (completed) does not appear

---

## FR-3: Add policy color theme and KIND_LABELS

The graph theme must handle `"policy"` entity kind in `entityColor()` and `entityMutedColor()` functions. The `KIND_LABELS` record must include entries for `"policy"` and `"intent"`.

### Business Rules
- Policy nodes must be visually distinguishable from existing entity types
- Intent nodes already have a color mapping (feature color) -- evaluate whether a distinct color improves clarity
- KIND_LABELS fallback (`kind` raw string) works but is not user-friendly for new entity types

### Domain Examples
1. Rena sees policy nodes in a distinct color (not the same as project, task, or decision nodes) making governance topology immediately visible
2. Carlos hovers over an intent node and the EntityBadge shows "Intent" (not "intent")
3. Amara sees "Policy" badge on a feed item for a policy entity

---

## FR-4: Add governance edge styles

The `edgeStyle()` function must return distinct styles for governance-related edges: `governing`, `protects`, `triggered_by`, `gates`.

### Business Rules
- Governance edges (`governing`, `protects`) should be visually distinct from structural edges (`belongs_to`, `has_feature`) to communicate a different relationship type
- Authorization flow edges (`triggered_by`, `gates`) should be visually distinct from dependency edges (`depends_on`)

### Domain Examples
1. Rena sees `governing` edges as dashed lines in a governance color, distinct from solid `belongs_to` edges
2. Carlos sees `triggered_by` edge from intent to task as visually distinct from `has_task` edges
3. The `protects` edge from policy to workspace is clearly governance-related, not structural

---

## FR-5: Show vetoed intents in governance feed awareness tier

The governance feed must include recently-vetoed intents (last 24 hours) in the awareness tier.

### Business Rules
- Only intents with `status = 'vetoed'` are included
- Only intents vetoed within the last 24 hours appear (time-bounded to prevent accumulation)
- Feed item includes the veto reason from the intent's evaluation field
- Feed item offers a "Discuss" action (no confirm/override since the veto is final)
- Vetoed intents are sorted by recency (most recent first)
- A vetoed intent already shown as `pending_veto` in the blocking tier should not also appear in awareness (dedup by entity ID)

### Domain Examples
1. Amara Diallo opens the feed. Intent "Delete staging environment" (vetoed 6 hours ago, reason: "risk exceeded budget threshold") appears in awareness tier with status "vetoed" and a "Discuss" action
2. Intent "Drop production table" was vetoed 30 hours ago -- it does not appear in the awareness tier
3. Intent "Purge cache" (vetoed 2 hours ago) and "Delete staging env" (vetoed 8 hours ago) both appear, sorted with "Purge cache" first

---

## FR-6: Update readEntityNameByTable for intent and policy

The `readEntityNameByTable` helper in `feed-queries.ts` must resolve display names for `intent` and `policy` entity types.

### Business Rules
- Intent display name: `goal` field
- Policy display name: `title` field
- Used by conflict detection and recent extraction queries when these entity types appear

### Domain Examples
1. A recent extraction links to intent "Deploy v2.1 to staging" -- the extraction feed item shows "Deploy v2.1 to staging" as the entity name (from `goal` field)
2. A conflict involves policy "Agent Budget Guard" -- the conflict feed item shows "Agent Budget Guard" as the entity name (from `title` field)

---

## FR-7: Update GraphEntityTable type and focused view allowlist

The `GraphEntityTable` type in `queries.ts` and the `entityTables` array in `graph-route.ts` must include `"intent"` and `"policy"`.

### Business Rules
- Users can center the focused graph view on an intent or policy node
- Focused view traversal includes intent and policy edges
- The `parseRecordIdString` function accepts `"intent"` and `"policy"` as valid table prefixes

### Domain Examples
1. Carlos clicks on intent "Deploy v2.1 to staging" in the graph -- the focused view centers on the intent and shows connected task and agent session nodes
2. Rena navigates to `?center=policy:abc123` -- the focused view centers on the policy node and shows governing identities
