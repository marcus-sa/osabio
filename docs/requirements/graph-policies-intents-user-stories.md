# User Stories: Graph Policies & Intents

Epic: `graph-policies-intents`
Date: 2026-03-11

---

## US-GPI-1: Policy Nodes in Graph View

**Traces to**: J1 (Governance Visibility)

### Problem
Rena Okafor is a workspace admin who manages agent governance policies. She finds it time-consuming to verify policy coverage because policies and their connections to identities are invisible in the graph view. She currently has to run raw database queries to answer "which identities are governed by which policies?"

### Who
- Workspace admin | Managing agent governance | Wants visual confirmation that governance topology is correct

### Solution
Add policy entities as nodes in the Reagraph force-directed graph with `governing`, `protects`, and `supersedes` edges. Only show active/testing policies. Use a distinct color theme for policy nodes.

### Domain Examples

#### 1: Happy Path -- Policy with multiple governed identities
Rena Okafor opens the workspace graph for "Brain". Policy "Agent Budget Guard" (active, version 3) appears as a distinctly-colored node. Two `governing` edges connect identities "ci-agent" and "dev-agent" to the policy. A `protects` edge connects the policy to the workspace node.

#### 2: Edge Case -- Superseded policy chain
Rena views the graph and sees "Agent Budget Guard v3" (active). She clicks it and the entity detail shows a `supersedes` relationship to "Agent Budget Guard v2" (superseded). The superseded policy does not appear as a node in the overview graph but is visible in the detail panel.

#### 3: Boundary -- Deprecated/draft policies excluded
Rena's workspace has 5 policies: 2 active, 1 testing, 1 deprecated, 1 draft. The graph shows 3 policy nodes (active + testing). Deprecated and draft policies do not clutter the graph.

### UAT Scenarios (BDD)

#### Scenario: Active policy appears as graph node
Given Rena Okafor's workspace "Brain" has an active policy "Agent Budget Guard"
And identity "ci-agent" is governed by "Agent Budget Guard"
When Rena opens the workspace graph view
Then a node with label "Agent Budget Guard" and kind "policy" appears
And a "governing" edge connects "ci-agent" to "Agent Budget Guard"

#### Scenario: Policy protects workspace edge
Given policy "Agent Budget Guard" protects workspace "Brain"
When Rena opens the workspace graph view
Then a "protects" edge connects "Agent Budget Guard" to the workspace node

#### Scenario: Deprecated policy excluded from graph
Given workspace "Brain" has a deprecated policy "Old Budget Rule"
When Rena opens the workspace graph view
Then no node appears for "Old Budget Rule"

#### Scenario: Policy entity detail shows metadata
Given Rena clicks on policy "Agent Budget Guard" in the graph
Then the entity detail shows title "Agent Budget Guard"
And the detail shows status "active" and version "3"
And the relationships list includes governed identities

### Acceptance Criteria
- [ ] Active and testing policies appear as nodes in workspace graph
- [ ] `governing` edges connect identity nodes to policy nodes
- [ ] `protects` edges connect policy nodes to workspace nodes
- [ ] Deprecated, draft, and superseded policies are excluded from graph nodes
- [ ] Policy nodes use a distinct color in graph-theme
- [ ] KIND_LABELS includes "Policy" for policy kind
- [ ] `EntityKind` type includes "policy"

### Technical Notes
- Requires adding `"policy"` to `EntityKind` union in `contracts.ts`
- Requires adding `"policy"` to `GraphEntityTable` type in `queries.ts`
- Requires new graph query clauses for policy table with status filter
- Requires `entityColor`/`entityMutedColor` cases for `"policy"` in `graph-theme.ts`
- Depends on: policy and governing/protects tables existing in schema (already present)

---

## US-GPI-2: Intent Nodes in Graph View

**Traces to**: J2 (Intent Monitoring)

### Problem
Carlos Medina is a team lead who oversees agent operations. He finds it difficult to monitor the intent authorization pipeline because only `pending_veto` intents appear in the feed. Intents in other active states (executing, authorized, pending_auth) are invisible in the UI. He cannot trace the flow from task to intent to agent session.

### Who
- Team lead | Monitoring agent operations | Wants visibility into intent lifecycle and authorization flow

### Solution
Add intent entities as nodes in the graph with `triggered_by`, `gates`, and `vetoed_by` edges. Only show intents in active/non-terminal states. Display intent status on the node.

### Domain Examples

#### 1: Happy Path -- Executing intent with full authorization flow
Carlos Medina opens the workspace graph. Intent "Deploy v2.1 to staging" (executing, priority 45) appears as a node. A `triggered_by` edge connects it to task "Deploy to staging". A `gates` edge connects it to agent session "deploy-agent-0312". Carlos can trace the full authorization flow visually.

#### 2: Edge Case -- Pending veto intent with risk indicator
Carlos sees intent "Scale database replicas" (pending_veto) in the graph. The node indicates it needs human review. This same intent also appears in the blocking tier of the governance feed with Approve/Veto/Discuss actions.

#### 3: Boundary -- Completed and vetoed intents excluded
Carlos' workspace has 8 intents: 2 executing, 1 pending_veto, 1 authorized, 2 completed, 1 vetoed, 1 failed. The graph shows 4 intent nodes (the active ones). Terminal-state intents do not appear.

### UAT Scenarios (BDD)

#### Scenario: Active intent appears in graph
Given Carlos Medina's workspace has intent "Deploy v2.1 to staging" with status "executing"
And the intent was triggered by task "Deploy to staging"
When Carlos opens the workspace graph view
Then a node with label "Deploy v2.1 to staging" and kind "intent" appears
And a "triggered_by" edge connects the intent to "Deploy to staging"

#### Scenario: Intent gates edge to agent session
Given intent "Deploy v2.1 to staging" gates agent session "deploy-agent-0312"
When Carlos opens the workspace graph view
Then a "gates" edge connects "Deploy v2.1 to staging" to the agent session node

#### Scenario: Completed intent excluded from graph
Given workspace has intent "Run test suite" with status "completed"
When Carlos opens the workspace graph view
Then no node appears for "Run test suite"

#### Scenario: Intent entity detail shows authorization metadata
Given Carlos clicks on intent "Deploy v2.1 to staging" in the graph
Then the entity detail shows goal "Deploy v2.1 to staging"
And the detail shows status "executing" and priority 45

### Acceptance Criteria
- [ ] Non-terminal intents appear as nodes in workspace graph
- [ ] `triggered_by` edges connect intent nodes to task nodes
- [ ] `gates` edges connect intent nodes to agent session nodes
- [ ] Completed, vetoed, and failed intents are excluded from graph nodes
- [ ] Intent node displays current status
- [ ] KIND_LABELS includes "Intent" for intent kind
- [ ] `GraphEntityTable` includes "intent"

### Technical Notes
- `"intent"` already exists in `EntityKind` -- no contract change needed
- Intent already has color mapping in `graph-theme.ts` (feature color) -- evaluate if distinct color needed
- Requires adding `"intent"` to `GraphEntityTable` type
- Requires new graph query clauses for intent table with status filter
- Requires `entityTables` array in `graph-route.ts` to include `"intent"`
- Depends on: intent table and triggered_by/gates relations existing in schema (already present)

---

## US-GPI-3: Vetoed Intents in Feed Awareness Tier

**Traces to**: J3 (Intent Feed Surfacing)

### Problem
Amara Diallo is a compliance reviewer who needs to track what agent actions the governance system blocked. She finds it impossible to discover vetoed intents without querying the database directly, because vetoed intents disappear from the feed once they leave `pending_veto` status. She cannot answer "what did governance block this week?" from the UI.

### Who
- Compliance reviewer | Auditing agent governance | Wants passive notification of vetoed agent actions

### Solution
Add recently-vetoed intents (last 24 hours) to the governance feed's awareness tier. Show the veto reason and offer a "Discuss" action.

### Domain Examples

#### 1: Happy Path -- Recently vetoed intent in awareness tier
Amara Diallo opens the governance feed. Intent "Delete staging environment" was vetoed 6 hours ago with reason "risk exceeded budget threshold". It appears in the awareness tier with status "vetoed", reason text including the evaluation context, and a "Discuss" action button.

#### 2: Edge Case -- Multiple vetoed intents sorted by recency
Two intents were vetoed today: "Purge cache" (2 hours ago) and "Delete staging env" (8 hours ago). Amara sees both in the awareness tier with "Purge cache" listed first.

#### 3: Boundary -- 24-hour window cutoff
Intent "Drop production table" was vetoed 30 hours ago. It does not appear in the awareness tier. Amara would need to query the database to find it.

#### 4: Error -- Dedup with blocking tier
Intent "Scale DB" was vetoed but due to a race condition its `pending_veto` item is still in the blocking tier. The awareness tier does not show a duplicate entry for the same intent.

### UAT Scenarios (BDD)

#### Scenario: Recently vetoed intent in awareness tier
Given intent "Delete staging environment" was vetoed 6 hours ago
And the evaluation reason was "risk exceeded budget threshold"
When Amara Diallo opens the governance feed
Then the awareness tier contains an item with entity kind "intent"
And the item entity name is "Delete staging environment"
And the item status is "vetoed"
And the item reason includes "Vetoed" and "risk exceeded budget threshold"
And the item offers a "Discuss" action

#### Scenario: Vetoed intent outside 24-hour window excluded
Given intent "Drop production table" was vetoed 30 hours ago
When Amara opens the governance feed
Then the awareness tier does not contain "Drop production table"

#### Scenario: Multiple vetoed intents ordered by recency
Given intent "Purge cache" was vetoed 2 hours ago
And intent "Delete staging env" was vetoed 8 hours ago
When Amara opens the governance feed
Then "Purge cache" appears before "Delete staging env" in the awareness tier

#### Scenario: No duplicate with blocking tier
Given intent "Scale DB" has entity ID "intent:xyz"
And the blocking tier already contains an item for "intent:xyz"
When the feed builder processes vetoed intents
Then the awareness tier does not contain an item for "intent:xyz"

### Acceptance Criteria
- [ ] Vetoed intents from last 24 hours appear in awareness tier
- [ ] Feed item shows intent goal as entity name
- [ ] Feed item reason includes "Vetoed" and evaluation reason text
- [ ] Feed item status is "vetoed"
- [ ] Feed item offers "Discuss" action only (no Approve/Override)
- [ ] Vetoed intents older than 24 hours are excluded
- [ ] No duplicate feed items for intents already in blocking tier

### Technical Notes
- Requires new `listRecentlyVetoedIntents()` query in `feed-queries.ts`
- Query filters: `status = 'vetoed'` AND `updated_at > 24h_cutoff` AND `workspace = $workspace`
- Requires new mapping function `mapVetoedIntentToFeedItem()` in `feed-queries.ts`
- Requires adding to `Promise.all` in `feed-route.ts` and mapping to awareness array
- Dedup: use existing `seenEntityIds` set to prevent duplicates with blocking tier
- Depends on: intent evaluation field containing reason text (already present in schema)

---

## US-GPI-4: Governance Edge Styles

**Traces to**: J1 (Governance Visibility), J2 (Intent Monitoring)

### Problem
Rena Okafor and Carlos Medina see governance edges (`governing`, `protects`, `triggered_by`, `gates`) in the graph but they look identical to structural edges (`belongs_to`, `has_feature`). They cannot quickly distinguish governance relationships from project hierarchy, making the graph harder to read.

### Who
- Workspace admin / team lead | Viewing graph with mixed entity types | Wants to quickly distinguish governance from structural relationships

### Solution
Add distinct edge styles for governance-related edge types in the `edgeStyle()` function. Use visual differentiation (dash pattern, color, opacity) to separate governance edges from structural and dependency edges.

### Domain Examples

#### 1: Happy Path -- Governance edges visually distinct
Rena views the graph. `governing` edges between identities and policies appear as dashed lines in a governance color, clearly different from solid `belongs_to` edges between tasks and projects.

#### 2: Edge Case -- Authorization flow edges
Carlos views the graph. The `triggered_by` edge from intent to task and the `gates` edge from intent to agent session use a distinct style from `has_task` edges, making the authorization flow traceable at a glance.

#### 3: Boundary -- Unknown edge types fall back to default
A new edge type `monitors` is added in a future release. The `edgeStyle()` default case renders it with the existing fallback style. No crash, no missing edges.

### UAT Scenarios (BDD)

#### Scenario: Governance edge has distinct style
Given the graph contains a "governing" edge between "ci-agent" and "Agent Budget Guard"
When the edge is rendered
Then the edge style differs from "belongs_to" edges in stroke pattern or color

#### Scenario: Authorization edge has distinct style
Given the graph contains a "triggered_by" edge between an intent and a task
When the edge is rendered
Then the edge style differs from "has_task" edges

#### Scenario: Unknown edge type uses default style
Given the graph contains an edge with type "monitors"
When the edge is rendered
Then the default edge style is applied without error

### Acceptance Criteria
- [ ] `governing` and `protects` edges have distinct visual style
- [ ] `triggered_by` and `gates` edges have distinct visual style
- [ ] Edge styles differ from structural edges (`belongs_to`, `has_feature`, `has_task`)
- [ ] Unknown edge types fall back to default style

### Technical Notes
- Changes to `edgeStyle()` in `graph-theme.ts` only
- Consider: dashed stroke for governance, directional styling for authorization
- Existing test file `tests/unit/graph-theme.test.ts` covers `edgeStyle` -- extend with new edge types

---

## US-GPI-5: Entity Name Resolution for Intent and Policy

**Traces to**: J1, J2, J3 (all jobs)

### Problem
The `readEntityNameByTable` helper in `feed-queries.ts` does not handle `intent` or `policy` entity types. When these entities appear in conflict detection or recent extraction queries, the helper returns `undefined` and the entity is silently dropped from results.

### Who
- Any user viewing feed | Seeing feed items involving intents or policies | Needs correct entity names displayed

### Solution
Add `intent` and `policy` cases to `readEntityNameByTable`, returning `goal` for intents and `title` for policies.

### Domain Examples

#### 1: Happy Path -- Intent name resolved in extraction
A recent extraction links to intent "Deploy v2.1 to staging". The extraction awareness feed item shows "Deploy v2.1 to staging" as the entity name.

#### 2: Happy Path -- Policy name resolved in conflict
A conflict edge references policy "Agent Budget Guard". The conflict feed item shows "Agent Budget Guard" as the entity name.

#### 3: Error Path -- Missing record returns undefined
An intent record was deleted but the extraction_relation still references it. `readEntityNameByTable` returns `undefined` and the feed item is skipped (existing behavior).

### UAT Scenarios (BDD)

#### Scenario: Intent name resolved from goal field
Given an extraction links to intent "Deploy v2.1 to staging"
When the feed builds recent extraction items
Then the entity name is "Deploy v2.1 to staging"

#### Scenario: Policy name resolved from title field
Given a conflict references policy "Agent Budget Guard"
When the feed builds conflict items
Then the entity name is "Agent Budget Guard"

#### Scenario: Missing entity returns undefined
Given an extraction references a deleted intent
When readEntityNameByTable is called
Then it returns undefined and the feed item is skipped

### Acceptance Criteria
- [ ] `readEntityNameByTable` handles `"intent"` table, returning `goal` field
- [ ] `readEntityNameByTable` handles `"policy"` table, returning `title` field
- [ ] Missing records return `undefined` (existing skip behavior preserved)

### Technical Notes
- Two new cases in the `readEntityNameByTable` switch in `feed-queries.ts`
- Minimal change, follows existing pattern exactly
- No new dependencies
