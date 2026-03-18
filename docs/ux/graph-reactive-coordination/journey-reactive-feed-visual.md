# Journey: Real-Time Governance Feed

## Emotional Arc
**Start**: Uncertain (is the feed current?) -> **Middle**: Engaged (items appearing live) -> **End**: Confident (nothing missed, governance is real-time)

Pattern: **Confidence Building** -- progressive trust in feed freshness through visible real-time updates.

---

## Flow Diagram

```
                         LIVE SELECT fires
                              |
  +---------------------------v---------------------------+
  |              SurrealDB Graph Layer                     |
  |  agent_session | decision | task | observation | ...   |
  +---------------------------+---------------------------+
                              |
                    Graph Change Event
                              |
                    +---------v---------+
                    |  Event Classifier  |
                    |  (notification     |
                    |   level router)    |
                    +---------+---------+
                              |
              +---------------+---------------+
              |               |               |
         interrupt       enqueue           log
              |               |               |
              v               v               v
     +--------+--+   +-------+---+   +-------+---+
     | Agent      |   | Agent     |   | Feed      |
     | Coordinator|   | Context   |   | SSE Push  |
     | (Phase 5)  |   | Queue     |   | (Phase 3) |
     +--------+--+   | (Phase 4) |   +-------+---+
              |       +-------+---+           |
              |               |               |
              v               v               v
     Agent gets        Agent gets       UI feed updates
     mid-turn          context on       in real-time
     injection         next turn
```

---

## Step 1: Marcus Opens Governance Feed

```
+-- Governance Feed -----------------------------------------------+
|                                                                   |
|  Workspace: montreal         Connected [*] live   3:42 PM         |
|                                                                   |
|  BLOCKING (2)                                                     |
|  +-------------------------------------------------------------+ |
|  | [!] Decision: "Standardize on tRPC for all APIs"             | |
|  |     Provisional decision awaiting confirmation                | |
|  |     Project: Brain v1          2 min ago                      | |
|  |     [ Confirm ]  [ Override ]  [ Discuss ]                    | |
|  +-------------------------------------------------------------+ |
|  | [!] Conflict: Rate limiting <-> Billing API transport         | |
|  |     REST in billing contradicts tRPC standardization          | |
|  |     Detected by Observer           5 min ago                  | |
|  |     [ Acknowledge ]  [ Resolve ]  [ Discuss ]                 | |
|  +-------------------------------------------------------------+ |
|                                                                   |
|  REVIEW (3)                                                       |
|  +-------------------------------------------------------------+ |
|  | [~] Observation: "Task T-47 depends on superseded decision"  | |
|  |     Warning from observer_agent        1 min ago              | |
|  |     [ Acknowledge ]  [ Resolve ]                              | |
|  +-------------------------------------------------------------+ |
|  | ...                                                           | |
+-------------------------------------------------------------------+
```

**Emotional state**: Entry: Uncertain ("Is this current?") -> Exit: Oriented ("I see the [*] live indicator, feed is connected")

**Key UX elements**:
- `Connected [*] live` indicator shows SSE connection is active
- Items sorted by tier (blocking > review > awareness) then by recency
- Timestamps show relative time ("2 min ago") for freshness signal

---

## Step 2: Agent Confirms a Decision (Real-Time Update)

While Marcus is reading the feed, the Chat Agent confirms the tRPC decision.

```
+-- Governance Feed -----------------------------------------------+
|                                                                   |
|  Workspace: montreal         Connected [*] live   3:43 PM         |
|                                                                   |
|  BLOCKING (1)  [-1 just now]                                      |
|  +-------------------------------------------------------------+ |
|  | [!] Conflict: Rate limiting <-> Billing API transport         | |
|  |     REST in billing contradicts tRPC standardization          | |
|  |     Detected by Observer           6 min ago                  | |
|  |     [ Acknowledge ]  [ Resolve ]  [ Discuss ]                 | |
|  +-------------------------------------------------------------+ |
|                                                                   |
|  +=============================================================+ |
|  | [NEW] Decision confirmed: "Standardize on tRPC for all APIs" | |
|  |       Confirmed by chat_agent via conversation C-12           | |
|  |       Moved to: AWARENESS tier          just now              | |
|  +=============================================================+ |
|                                                                   |
|  REVIEW (4)  [+1 just now]                                        |
|  +-------------------------------------------------------------+ |
|  | [NEW!] Task at risk: "Migrate billing API to tRPC"           | |
|  |     Agent B has active session on task T-47 which depends     | |
|  |     on the just-confirmed tRPC decision                       | |
|  |     Coordinator detected dependency conflict    just now      | |
|  |     [ Acknowledge ]  [ Resolve ]  [ Discuss ]                 | |
|  +-------------------------------------------------------------+ |
|  | [~] Observation: "Task T-47 depends on superseded decision"  | |
|  |     ...                                                       | |
|  +-------------------------------------------------------------+ |
+-------------------------------------------------------------------+
```

**Emotional state**: Entry: Engaged (reading feed) -> Exit: Informed and Confident ("The system caught the dependency impact immediately -- I did not have to figure it out")

**Key UX elements**:
- `[NEW]` badge on items that appeared via SSE since page load
- Decision moved from BLOCKING to AWARENESS with transition animation
- Coordinator-generated "Task at risk" item appears in REVIEW automatically
- Tier counts update with delta indicator `[-1 just now]` / `[+1 just now]`

---

## Step 3: Marcus Acts on a Feed Item

Marcus clicks "Acknowledge" on the task-at-risk item.

```
+-- Governance Feed -----------------------------------------------+
|                                                                   |
|  REVIEW (3)                                                       |
|  +-------------------------------------------------------------+ |
|  | [~] Task at risk: "Migrate billing API to tRPC"              | |
|  |     Status: Acknowledged by Marcus            just now        | |
|  |     Agent B notified: context will update on next turn        | |
|  |     [ Resolve ]  [ Discuss ]                                  | |
|  +-------------------------------------------------------------+ |
+-------------------------------------------------------------------+
```

**Emotional state**: Entry: Decisive ("I need to act on this") -> Exit: Satisfied ("Action taken, agent will be notified")

**Key UX elements**:
- Acknowledging feeds back into the coordinator: Agent B gets an enqueue notification
- Status updates in-place without full page refresh
- Clear feedback that the downstream effect (agent notification) will happen

---

## Step 4: SSE Connection Loss and Recovery

Marcus's laptop goes to sleep. SSE disconnects.

```
+-- Governance Feed -----------------------------------------------+
|                                                                   |
|  Workspace: montreal         Reconnecting...      3:58 PM         |
|                                                                   |
|  [i] Connection lost. Reconnecting...                             |
|      Changes since 3:55 PM will appear when reconnected.          |
|                                                                   |
+-------------------------------------------------------------------+
```

After reconnection:

```
+-- Governance Feed -----------------------------------------------+
|                                                                   |
|  Workspace: montreal         Connected [*] live   3:59 PM         |
|                                                                   |
|  [i] Reconnected. 3 updates received since 3:55 PM.              |
|                                                                   |
|  BLOCKING (2)  [+1 while away]                                    |
|  ...                                                              |
+-------------------------------------------------------------------+
```

**Emotional state**: Entry: Anxious ("Did I miss something?") -> Exit: Reassured ("System caught up, I see what changed")

**Key UX elements**:
- Clear connection status indicator (Connected / Reconnecting / Disconnected)
- On reconnect: delta sync shows count of changes missed
- `[+N while away]` badges on tiers that changed during disconnection
- No data loss -- missed events are replayed from last-seen event ID

---

## Step 5: Observer Agent Triggered by Real-Time Event

In the background (not directly visible to Marcus but reflected in feed):

```
Graph change: decision:d-99 status -> "confirmed"
  |
  v
LIVE SELECT fires on decision table
  |
  v
Event Classifier:
  - Table: decision
  - Transition: status changed to "confirmed"
  - Level: LOG (for feed) + triggers Observer verification
  |
  +---> SSE push to feed: new awareness item "Decision confirmed"
  |
  +---> Observer route: POST /api/observe/decision/d-99
        Observer agent verifies: does this conflict with active tasks?
        Result: conflict found with task T-47
        |
        +---> Creates observation record in graph
        +---> LIVE SELECT fires on observation table
        +---> Event Classifier: severity=warning, active dependency
        +---> Level: ENQUEUE for Agent B + LOG for feed
        +---> SSE push to feed: new review item "Task at risk"
```

**Emotional state for Marcus** (seeing feed updates): Confident ("System is actively monitoring and catching issues")

---

## Integration Checkpoints

| Checkpoint | Validates | Phase |
|------------|-----------|-------|
| SSE connection established on feed page load | LIVE SELECT -> SSE bridge works | Phase 3 |
| Feed item appears within 2s of graph write | End-to-end latency acceptable | Phase 3 |
| Tier counts update without page refresh | SSE event correctly classified and routed | Phase 3 |
| Agent receives enqueue notification on next turn | Coordinator routes to affected agents | Phase 4 |
| Agent receives interrupt for hard conflict | Mid-turn context injection works | Phase 5 |
| SSE reconnects after network loss | Missed events replayed, no data loss | Phase 3 |
| No agent coordination loops after 10 cascading changes | Dampening/loop detection works | Phase 4 |
