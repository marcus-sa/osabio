# Shared Artifacts Registry: Graph-Reactive Agent Coordination

## Purpose

Tracks all data values that flow across journey steps or between journeys. Every variable in UI mockups and agent context has a single source of truth documented here.

---

## Artifacts

### graph_change_event

| Property | Value |
|----------|-------|
| **Source of truth** | SurrealDB LIVE SELECT notification payload |
| **Owner** | Graph Layer (SurrealDB) |
| **Integration risk** | HIGH -- all downstream processing depends on this event format |
| **Validation** | Event contains: table, id, operation (CREATE/UPDATE/DELETE), before state, after state, workspace |

**Consumers**:
- Event Classifier (step 1 of both journeys)
- SSE Bridge (feed journey step 2)
- Audit log

---

### notification_level

| Property | Value |
|----------|-------|
| **Source of truth** | Event Classifier rules engine output |
| **Owner** | Event Classifier component |
| **Integration risk** | HIGH -- misclassification causes wrong notification behavior |
| **Validation** | Must be one of: `interrupt`, `enqueue`, `log`. Classification is deterministic (no LLM). Same input always produces same output. |

**Consumers**:
- Agent Coordinator routing (coordination journey step 2)
- Feed SSE tier classification (feed journey step 2)
- Loop dampening tracker (coordination journey step 5)
- Agent context queue priority ordering

**Classification rules** (source of truth for all consumers):

| Entity.Transition | Feed | Agent | Observer |
|-------------------|------|-------|----------|
| decision.status -> confirmed | log | enqueue (if dependency) | log |
| decision.status -> superseded | log | interrupt (if dependency) | log |
| task.status -> blocked | log | interrupt (if assigned) | log |
| task.status -> done/completed | log | enqueue (if dependents) | log |
| observation.created (conflict) | log | interrupt (if affected) | -- |
| observation.created (warning) | log | enqueue | -- |
| observation.created (info) | log | -- | -- |
| question.created (high priority) | log | enqueue | -- |
| agent_session.ended | log | enqueue (if shared task) | log |

---

### affected_agents

| Property | Value |
|----------|-------|
| **Source of truth** | Agent Coordinator graph traversal result |
| **Owner** | Agent Coordinator component |
| **Integration risk** | HIGH -- missing an affected agent means stale context persists |
| **Validation** | Traversal covers: depends_on, relates_to, belongs_to edges. Only active sessions (orchestrator_status = "active") are targeted. |

**Consumers**:
- Notification delivery (coordination journey step 3-4)
- Feed item enrichment ("Agent B affected" reason text)

---

### sse_connection_status

| Property | Value |
|----------|-------|
| **Source of truth** | Browser EventSource.readyState |
| **Owner** | Client-side SSE connection manager |
| **Integration risk** | MEDIUM -- incorrect status misleads user about feed freshness |
| **Validation** | Maps readyState 0=Connecting, 1=Connected, 2=Disconnected. Must update within 3 seconds of actual state change. |

**Consumers**:
- Feed page header status indicator (feed journey steps 1, 5)

**Display values**:
- `Connected [*] live` (readyState 1, green indicator)
- `Reconnecting...` (readyState 0, amber indicator)
- `Disconnected` (readyState 2, red indicator)

---

### feed_items

| Property | Value |
|----------|-------|
| **Source of truth** | Initial: GET /api/workspaces/:id/feed response. Updates: SSE events merged client-side. |
| **Owner** | Feed route handler (server) + client-side feed state manager |
| **Integration risk** | HIGH -- SSE items must merge correctly with initial GET items, no duplicates, correct tier |
| **Validation** | Each item has unique `id`. Tier is derived from notification_level. Items from SSE use same GovernanceFeedItem schema as GET response. |

**Consumers**:
- Blocking tier list
- Review tier list
- Awareness tier list
- Tier count badges
- Delta indicators ("[+1 just now]")

---

### last_event_id

| Property | Value |
|----------|-------|
| **Source of truth** | Client-side tracking of last SSE event ID received |
| **Owner** | Client-side SSE connection manager |
| **Integration risk** | HIGH -- incorrect last_event_id causes missed or duplicate events on reconnection |
| **Validation** | Monotonically increasing. Sent as `Last-Event-ID` header on EventSource reconnection. Server uses it to replay missed events. |

**Consumers**:
- SSE reconnection (feed journey step 5)
- Server-side delta calculation on reconnect

---

### context_update_message

| Property | Value |
|----------|-------|
| **Source of truth** | Agent Coordinator notification payload |
| **Owner** | Agent Coordinator component |
| **Integration risk** | HIGH -- unclear or missing context causes agent confusion |
| **Validation** | Must include: entity reference, change description, impact on current task, urgency level. Must be clearly framed as mid-session update. |

**Consumers**:
- Agent system context injection (coordination journey step 3-4)
- Agent session audit log

---

### loop_dampening_state

| Property | Value |
|----------|-------|
| **Source of truth** | In-memory per-entity, per-source-agent event counter with sliding window |
| **Owner** | Agent Coordinator loop dampener |
| **Integration risk** | MEDIUM -- too aggressive dampening suppresses real issues; too lenient allows loops |
| **Validation** | Threshold: >3 events on same entity from same source in 60 seconds. Window slides. State is per-workspace. Dampening logged and surfaced as meta-observation. |

**Consumers**:
- Coordinator routing decision (coordination journey step 5)
- Meta-observation creation (visible in feed)

---

### workspace_name

| Property | Value |
|----------|-------|
| **Source of truth** | workspace record in SurrealDB |
| **Owner** | Workspace module |
| **Integration risk** | LOW -- display-only |
| **Validation** | Read from workspace record on feed page load. Consistent across all feed views. |

**Consumers**:
- Feed page header
- SSE channel subscription key

---

## Cross-Journey Artifact Flow

```
Graph Layer                     Event Classifier              Agent Coordinator
    |                                |                              |
    +-- graph_change_event --------->|                              |
    |                                +-- notification_level ------->|
    |                                |                              +-- affected_agents
    |                                |                              +-- context_update_message
    |                                |                              +-- loop_dampening_state
    |                                |
    |                                +-- notification_level ------> SSE Bridge
    |                                                                  |
    |                                                                  +-- feed_items (delta)
    |                                                                  +-- sse_connection_status
    |                                                                  +-- last_event_id
```

## Integration Risks Summary

| Risk | Severity | Mitigation |
|------|----------|------------|
| LIVE SELECT event format changes between SurrealDB versions | HIGH | Pin SurrealDB version. Schema-validate event payload at classifier entry. |
| SSE events and GET feed items use different schemas | HIGH | Share GovernanceFeedItem type between GET handler and SSE bridge. |
| Agent context injection interferes with ongoing reasoning | HIGH | Never cancel current generation. Inject on next turn only. Clear framing. |
| Loop dampening too aggressive, suppresses real conflicts | MEDIUM | Conservative threshold (3 events/60s). Meta-observation for human review. Tunable per-workspace. |
| SSE reconnection replays events that client already has | MEDIUM | Client deduplicates by event ID. Server tracks last-sent ID per connection. |
| LIVE SELECT on high-write tables (trace) causes event storm | HIGH | Exclude high-volume tables (trace, message) from LIVE SELECT. Use DEFINE EVENT for those. |
