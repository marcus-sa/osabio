# Feed

Governance feed aggregation — surfaces actionable signals from the knowledge graph as tiered feed items for workspace members.

## The Problem

The knowledge graph accumulates decisions, observations, blocked tasks, and conflicts across all agents and conversations. Without a curated feed, users would need to manually traverse the graph to find what needs their attention. The feed prioritizes signals by urgency: blocking issues first, then items needing attention, then awareness-level signals.

## What It Does

- **Three-tier signal aggregation**: Queries the graph for blocking, attention, and awareness-level items in parallel
- **Feed item types**: Provisional decisions, low-confidence decisions, blocked tasks, workspace conflicts, vetoed intents, pending veto windows
- **Recency thresholds**: Flags stale items (7+ days), recent items (3 days), and low-confidence decisions (<0.7)
- **Provenance links**: Each feed item links back to its source entity for drill-down navigation

## Key Concepts

| Term | Definition |
|------|------------|
| **GovernanceFeedItem** | Structured card with type, priority tier, entity reference, and available actions |
| **Blocking Tier** | Items that prevent progress — vetoed intents, blocked tasks, hard conflicts |
| **Attention Tier** | Items needing review — provisional decisions, pending veto windows, low-confidence extractions |
| **Awareness Tier** | Informational items — recent observations, new suggestions, status changes |
| **Stale Threshold** | 7+ days without update — surfaces drift for review |

## How It Works

1. `GET /api/workspaces/:workspaceId/feed` request arrives
2. Handler loads blocking, attention, and awareness tier queries in parallel
3. Each tier query filters by workspace + recency + priority:
   - `listProvisionalDecisions()` — decisions not yet confirmed
   - `listLowConfidenceDecisions()` — decisions with confidence < 0.7
   - `listBlockedTasks()` — tasks waiting on questions/observations
   - `listWorkspaceConflicts()` — conflicting decisions/features
   - `listRecentlyVetoedIntents()` — intents rejected during veto window
   - `listPendingVetoIntents()` — intents awaiting human veto decision
4. Results mapped to `GovernanceFeedItem[]` with provenance links
5. Response includes timing metrics per tier for observability

## Where It Fits

```text
Knowledge Graph
  |
  +---> Blocking Tier        +---> Attention Tier        +---> Awareness Tier
  |     - vetoed intents     |     - provisional decisions |    - recent observations
  |     - blocked tasks      |     - pending veto windows  |    - new suggestions
  |     - hard conflicts     |     - low-confidence items   |    - status changes
  |                          |                              |
  v                          v                              v
  +-------------------+------+------------------------------+
                      |
                      v
              GovernanceFeedItem[]
                      |
                      v
              Feed UI (cards with actions)
```

**Consumes**: Graph state across all entity types, workspace scope
**Produces**: Prioritized `GovernanceFeedItem[]` for the feed UI

## File Structure

```text
feed/
  feed-queries.ts   # Query builders for all feed signal types (~1,000 lines)
  feed-route.ts     # HTTP endpoint handler with parallel tier loading
```
