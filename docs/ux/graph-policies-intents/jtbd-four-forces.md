# Four Forces Analysis: Graph Policies & Intents

Epic: `graph-policies-intents`
Date: 2026-03-11

---

## J1: Governance Visibility

### Demand-Generating
- **Push**: Policies and identities exist in the database but are invisible in the graph view. Rena Okafor (workspace admin) has to run raw SurrealDB queries to understand which policies govern which identities. She cannot answer "is every identity covered by a policy?" without manual work.
- **Pull**: Seeing policy nodes connected to identity and workspace nodes in the force-directed graph instantly reveals coverage gaps, orphaned identities, and supersession chains. One glance replaces 10 minutes of query writing.

### Demand-Reducing
- **Anxiety**: Adding new node types might clutter the graph. Rena worries that policy/intent nodes will overwhelm the existing project-task-decision topology if there are many of them. Will the graph become unreadable?
- **Habit**: Rena currently checks governance by reading the policy table directly in Surrealist or by asking the chat agent. The mental model of "policies are configuration, not graph entities" may resist treating them as first-class nodes.

### Assessment
- Switch likelihood: **High** -- the push is strong (no current visibility) and the pull is immediate (graph view already exists, just needs new node types)
- Key blocker: Graph clutter anxiety
- Key enabler: Instant topology comprehension from visual graph
- Design implication: Policy and intent nodes need distinct visual styling (color, shape cues) so they are identifiable but do not overwhelm. Consider filtering/toggling by entity kind.

---

## J2: Intent Monitoring

### Demand-Generating
- **Push**: Intents flow through a multi-status pipeline (draft -> pending_auth -> pending_veto -> authorized -> executing -> completed/vetoed/failed) but the only visibility is the `pending_veto` blocking feed item. Carlos Medina (team lead) cannot see intents in other states. An intent stuck in `executing` for hours is invisible.
- **Pull**: Intent nodes in the graph show status via color/label, connected to the triggering task and gated agent session. Carlos can trace the full authorization flow visually: task -> triggered_by -> intent -> gates -> agent_session.

### Demand-Reducing
- **Anxiety**: Intent volume could be high. If every agent action creates an intent, the graph could be flooded with transient nodes. Carlos worries about noise vs. signal.
- **Habit**: Carlos currently monitors agent activity through the feed's blocking tier (pending_veto items) and the agent session status. Adding another monitoring surface might fragment attention.

### Assessment
- Switch likelihood: **High** -- intent monitoring fills a clear gap (only pending_veto is visible today)
- Key blocker: Volume/noise concern
- Key enabler: Graph already shows agent_session nodes; intents are a natural extension of that flow
- Design implication: Filter intents to active/recent states in graph queries. Do not show completed/vetoed intents in graph by default -- they belong in the feed's awareness tier.

---

## J3: Intent Feed Surfacing

### Demand-Generating
- **Push**: When an intent is vetoed, the only record is in the intent table. Amara Diallo (compliance reviewer) has no way to discover vetoed intents without querying the database. She cannot answer "what did the governance system block this week?" from the UI.
- **Pull**: Vetoed intents appearing in the awareness tier (last 24h) give Amara a passive notification channel. She sees what was blocked without actively searching. The feed becomes a complete governance audit trail.

### Demand-Reducing
- **Anxiety**: Will the awareness tier become noisy if many intents are vetoed? Amara worries about important vetoes getting lost among stale tasks and recent extractions.
- **Habit**: Amara currently reviews governance by checking the blocking tier for pending_veto items. She has no habit of checking the awareness tier for historical events.

### Assessment
- Switch likelihood: **Medium-High** -- the push is strong for compliance use cases but the habit barrier (awareness tier not checked regularly) could reduce impact
- Key blocker: Awareness tier attention habit
- Key enabler: 24-hour time window keeps the list fresh and manageable
- Design implication: Vetoed intents should have clear visual differentiation in the feed (distinct reason text, appropriate actions). The 24h window prevents accumulation.
