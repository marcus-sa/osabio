# JTBD Analysis: Graph-Reactive Agent Coordination

## Job Classification

**Job Type**: Brownfield Improvement (Job 2)
**Workflow**: `[research] -> baseline -> roadmap -> split -> execute -> review`
**Rationale**: System exists (SSE registry, DEFINE EVENT webhooks, feed route, agent sessions). Problem is identified: all reactivity is poll-based or explicitly triggered. We are adding a reactive layer on top.

---

## Job Stories

### JS-GRC-01: Real-Time Governance Awareness

**When** I am monitoring my workspace feed and an agent confirms a critical decision while I am on the page,
**I want to** see the feed update immediately without refreshing,
**so I can** act on governance items (confirm decisions, review observations, resolve conflicts) as they happen instead of discovering them minutes later.

#### Functional Job
See graph state changes reflected in the governance feed within seconds of occurrence.

#### Emotional Job
Feel continuously connected to what my agents are doing -- not anxious about missing something important, not frustrated by stale data.

#### Social Job
Demonstrate to the team that governance oversight is real-time, not ceremonial -- decisions are caught and reviewed promptly.

#### Forces Analysis
- **Push**: Feed shows stale data. Marcus refreshes the page 8 times during a 30-minute session. An agent confirms a decision that conflicts with another agent's active task, but Marcus does not see it for 3 minutes because the feed is polling-based (or not polling at all -- currently it is a single GET request on page load).
- **Pull**: Feed items appear within 2 seconds of the graph change. Marcus sees a new "blocking" item slide into the feed while reading. No manual refresh needed.
- **Anxiety**: Will real-time updates be distracting? Will the feed become noisy with low-value awareness items constantly streaming in? Will the SSE connection be reliable?
- **Habit**: Currently, Marcus opens the feed page, scans it, acts on items, then closes it. Mental model is "snapshot." Switching to "live stream" changes the interaction pattern.

**Switch likelihood**: High
**Key blocker**: Noise/distraction anxiety
**Key enabler**: Stale-data frustration (push)
**Design implication**: Must support notification levels (blocking items push hard, awareness items appear quietly). Feed must feel like a calm dashboard that alerts when needed, not a firehose.

---

### JS-GRC-02: Reactive Agent Wake-Up

**When** an agent writes a graph change that affects another agent's active work (e.g., Observer creates a conflict observation about a decision that the PM agent just used for task planning),
**I want to** have the affected agent automatically receive that context on its next turn,
**so I can** avoid the agents working with stale assumptions while I manually relay information between them.

#### Functional Job
Route graph change notifications to agents whose active tasks or decisions are affected by the change.

#### Emotional Job
Feel confident that agents are coordinating through the graph -- not operating in isolation with stale context.

#### Social Job
Show stakeholders that the system self-corrects -- agents react to each other's outputs without human copy-pasting context.

#### Forces Analysis
- **Push**: Agent A confirms a decision. Agent B is working on a task that depends on the old version of that decision. B continues for 15 minutes with invalid assumptions. Marcus discovers the inconsistency manually, wastes time re-running Agent B's work.
- **Pull**: When Agent A confirms the decision, Agent B receives an "enqueue" notification. On B's next tool-use turn, the new decision context is injected. B adjusts its work automatically.
- **Anxiety**: Will reactive wake-ups cause agent loops (A wakes B, B writes something that wakes A, infinite cycle)? Will injected context confuse the agent mid-task?
- **Habit**: Currently, agents get context at session start only. The "fresh session" model is simple and predictable. Adding mid-session injection is a new pattern.

**Switch likelihood**: High
**Key blocker**: Agent loop / confusion anxiety
**Key enabler**: Human-relay frustration (push)
**Design implication**: Must have loop-detection/dampening. Must classify notification urgency (interrupt vs enqueue vs log). Injected context must be clearly framed so the agent understands "this is a mid-session update, not part of the original task."

---

### JS-GRC-03: Real-Time Conflict Detection

**When** Agent A confirms a decision that invalidates Agent B's active task,
**I want to** be notified immediately that a hard conflict exists between the decision and the task,
**so I can** intervene before Agent B wastes further effort on invalid work.

#### Functional Job
Detect conflicts between graph entities in real-time as changes occur, rather than waiting for the next Observer scan.

#### Emotional Job
Feel safe that the system catches contradictions as they happen -- not after damage is done.

#### Social Job
Demonstrate that autonomous agents have real-time guardrails, not just periodic audits.

#### Forces Analysis
- **Push**: Observer runs periodic graph scans. A decision is confirmed at 10:01. Next scan runs at 10:15. In between, Agent B has been coding against the now-invalid task for 14 minutes. The scan finds the conflict, but the damage is done.
- **Pull**: Decision confirmed at 10:01. Within 2 seconds, the coordinator detects that task T-47 (assigned to Agent B) depends on the old decision state. Agent B gets an interrupt. Marcus sees a "blocking" feed item. Wasted work: 0 minutes.
- **Anxiety**: Will false-positive conflicts interrupt agents unnecessarily? Will the graph traversal for "who cares about this change?" be expensive or slow?
- **Habit**: Current Observer scan is batch-oriented. Teams are used to "scan results" as a batch report. Real-time conflicts are a different mental model.

**Switch likelihood**: High
**Key blocker**: False-positive interrupts (anxiety)
**Key enabler**: Wasted-work frustration (push)
**Design implication**: Conflict detection must have a confidence threshold before triggering interrupts. "Interrupt" level reserved for hard conflicts (direct dependency invalidation). "Enqueue" for soft/possible conflicts.

---

### JS-GRC-04: MCP Context Freshness

**When** I start a new MCP/CLI coding session and request context,
**I want to** receive the most current graph state including changes that happened seconds ago,
**so I can** start working with accurate context instead of discovering mid-session that a decision was superseded or a task was completed.

#### Functional Job
Ensure MCP context packets reflect the latest graph state, including changes from other agents' sessions that just ended.

#### Emotional Job
Feel confident that the context packet is fresh and trustworthy -- not a stale snapshot from 5 minutes ago.

#### Social Job
Trust that the system gives the same current picture to all agents, eliminating "but I was told X" miscommunication.

#### Forces Analysis
- **Push**: Marcus starts a Claude Code session via MCP. The context packet says task T-12 is "in_progress." But another agent completed T-12 two minutes ago. Marcus's agent starts duplicating work on T-12.
- **Pull**: Context packet always reflects the latest committed graph state. If T-12 was completed 2 seconds ago, the context packet says "done."
- **Anxiety**: Will "eventual consistency" mean sometimes the context is still stale? Is there a race condition between graph writes and context reads?
- **Habit**: Current MCP context is already a point-in-time query. The habit is "trust the context packet." The change is making that trust justified by ensuring freshness.

**Switch likelihood**: Medium (less visible improvement than real-time feed)
**Key blocker**: Eventual consistency anxiety
**Key enabler**: Duplicate-work frustration (push)
**Design implication**: Context endpoint should read from committed writes. No caching layer that could serve stale data. Include a `context_as_of` timestamp so the agent knows how fresh its context is.

---

## 8-Step Universal Job Map

Applied to the primary job: "Coordinate autonomous agents through reactive graph state changes."

| Step | Activity | Current State (Pain) | Desired State |
|------|----------|---------------------|---------------|
| 1. Define | Determine which graph changes matter | No classification -- all changes treated equally | Three notification levels: interrupt, enqueue, log |
| 2. Locate | Find which agents/users care about a change | No lookup -- events go to webhook endpoints only | Graph traversal finds affected agents via dependency edges |
| 3. Prepare | Set up notification channels | SSE registry is per-message, not per-workspace | Workspace-scoped SSE channels for persistent feed streaming |
| 4. Confirm | Verify the change is real and conflict is genuine | Observer uses LLM verification (batch) | Real-time conflict confidence scoring before routing |
| 5. Execute | Deliver notification to the right recipient | Webhook fires, observer processes, feed polled later | LIVE SELECT fires, coordinator routes, SSE pushes to UI, agent gets context injection |
| 6. Monitor | Track notification delivery and agent response | No tracking of whether humans saw feed items | Delivery confirmation, read receipts on feed items, agent acknowledgment |
| 7. Modify | Handle notification failures or false positives | Webhook returns 200 always, errors swallowed | Retry with backoff, false-positive feedback loop, dampening for noisy entities |
| 8. Conclude | Assess coordination outcome | No measurement | Metrics: time-to-human-awareness, agent-context-freshness, conflict-detection-latency |

---

## Outcome Statements (ODI Format)

| # | Outcome Statement | Est. Importance | Est. Satisfaction | Score | Priority |
|---|-------------------|----------------|-------------------|-------|----------|
| 1 | Minimize the time between a graph change and the workspace admin seeing it in the feed | 90% | 15% | 16.5 | Extremely Underserved |
| 2 | Minimize the likelihood of an agent working with stale context after another agent changes a dependency | 92% | 10% | 17.4 | Extremely Underserved |
| 3 | Minimize the time between a conflict being created and the human being notified | 88% | 20% | 14.8 | Extremely Underserved |
| 4 | Minimize the likelihood of false-positive conflict interrupts disrupting agent work | 75% | 30% | 10.5 | Appropriately Served |
| 5 | Minimize the number of manual page refreshes needed to see current feed state | 85% | 5% | 16.0 | Extremely Underserved |
| 6 | Minimize the likelihood of reactive notifications causing agent coordination loops | 70% | 40% | 7.0 | Overserved (design-out) |
| 7 | Minimize the time for an MCP context packet to reflect the latest graph state | 72% | 50% | 7.2 | Overserved (already near-fresh) |
| 8 | Maximize the likelihood that notification urgency matches the actual impact of the change | 82% | 15% | 14.9 | Extremely Underserved |

### Scoring Notes
- Source: Team estimates based on architecture analysis (not user survey). Confidence: Medium.
- Scores 1, 2, 3, 5, 8 are extremely underserved -- these drive the phasing (Phase 3 foundation, Phase 4 coordinator, Phase 5 interrupts).
- Score 6 (loop prevention) is "overserved" because it is a design-out concern -- we must prevent it from day one, not optimize for it.
- Score 7 (MCP freshness) is lower priority because current point-in-time queries are already reasonably fresh.

### Top Opportunities (Score >= 12)
1. Agent stale-context prevention (17.4) -- Drives Phase 4: Agent Coordinator
2. Feed real-time updates (16.5) -- Drives Phase 3: LIVE SELECT to SSE bridge
3. Manual refresh elimination (16.0) -- Drives Phase 3: persistent workspace SSE
4. Notification urgency classification (14.9) -- Drives Phase 4: three-level routing
5. Conflict notification latency (14.8) -- Drives Phase 5: interrupt-level delivery

---

## Personas

### Persona: Marcus Oliveira (Workspace Admin)

**Who**: Technical founder who monitors agent activity via the web UI governance feed
**Demographics**:
- High technical proficiency (full-stack developer, reads code)
- Checks feed 10-15 times per day in 2-5 minute sessions
- Uses Chrome on MacBook, often with multiple Osabio workspaces
- Primary motivation: maintain oversight without micromanaging agents

**Job Steps**:

| Job Step | Goal | Desired Outcome |
|----------|------|-----------------|
| Open feed | See current governance state | Minimize time to see actionable items |
| Scan tiers | Identify what needs attention | Minimize likelihood of missing a blocking item |
| Act on item | Confirm/reject/discuss a governance item | Minimize time from awareness to action |
| Monitor agents | Know which agents are active and what they are doing | Minimize uncertainty about agent state |
| Detect conflicts | Catch contradictions between agents | Minimize time between conflict creation and human awareness |

**Pain Points**:
- Feed is stale on page load; must refresh to see recent changes -> Job Step: Open feed
- No notification when a blocking item appears while page is open -> Job Step: Scan tiers
- Agents work with invalid assumptions for minutes before conflicts are caught -> Job Step: Detect conflicts

**Success Metrics**:
- Feed updates appear within 2 seconds of graph change (no manual refresh)
- Zero blocking items missed during an active feed session
- Conflict-to-notification latency < 5 seconds

---

### Persona: Chat Agent (Orchestrator Agent)

**Who**: AI agent orchestrating subagents, needs real-time awareness of graph changes affecting current conversation
**Demographics**:
- Always active during a chat session
- Dispatches to PM agent, Observer, and coding agents
- Context loaded at conversation start, not refreshed mid-conversation
- Primary motivation: coordinate subagents with accurate, current context

**Job Steps**:

| Job Step | Goal | Desired Outcome |
|----------|------|-----------------|
| Load context | Get current graph state for conversation | Minimize likelihood of starting with stale context |
| Dispatch subagent | Delegate work with correct context | Minimize likelihood of subagent working on invalid assumptions |
| Receive updates | Learn about graph changes mid-conversation | Minimize time between a relevant change and context update |
| Handle conflicts | React when a subagent's output conflicts with new graph state | Minimize wasted tokens on invalid reasoning |

**Pain Points**:
- Context is point-in-time; changes during long conversations are missed -> Job Step: Receive updates
- Subagent PM plans tasks based on stale project state -> Job Step: Dispatch subagent
- No mechanism to inject "hey, decision X was just superseded" mid-conversation -> Job Step: Handle conflicts

**Success Metrics**:
- Context includes all graph changes committed before the query timestamp
- Mid-conversation context injection delivered within one agent turn of the triggering change
- Zero subagent dispatches with known-stale context

---

### Persona: Observer Agent

**Who**: AI agent that scans for contradictions; should be triggered when new observations/decisions appear rather than only on periodic scans
**Demographics**:
- Currently batch-triggered via POST /api/workspaces/:id/observer/scan or DEFINE EVENT webhooks
- Processes task completions, decision confirmations, commit creation, observation peer review
- Primary motivation: catch contradictions and drift as early as possible

**Job Steps**:

| Job Step | Goal | Desired Outcome |
|----------|------|-----------------|
| Receive trigger | Know when something changed that needs verification | Minimize latency from change to verification start |
| Assess relevance | Determine if the change warrants analysis | Minimize wasted analysis on irrelevant changes |
| Verify | Run LLM-assisted verification on the change | Minimize likelihood of false positives |
| Report | Surface findings as observations | Minimize time from finding to human visibility |

**Pain Points**:
- Periodic scans miss time-critical conflicts -> Job Step: Receive trigger
- No prioritization of which triggers to process first -> Job Step: Assess relevance
- Findings appear in feed only on next poll -> Job Step: Report

**Success Metrics**:
- Trigger-to-verification latency < 10 seconds for interrupt-level changes
- False-positive rate < 15% for conflict observations
- Findings visible in feed within 2 seconds of creation

---

### Persona: Tomas Chen (MCP/CLI Coding Agent User)

**Who**: Developer using Claude Code via MCP, receives context packets at session start
**Demographics**:
- Starts 5-10 coding sessions per day via `osabio start task:...`
- Expects context to be accurate at session start
- Does not monitor the web UI during coding sessions
- Primary motivation: start coding with correct, complete context

**Job Steps**:

| Job Step | Goal | Desired Outcome |
|----------|------|-----------------|
| Start session | Get context for the assigned task | Minimize likelihood of starting with stale decisions/tasks |
| Code | Work with accurate assumptions | Minimize likelihood of building against superseded decisions |
| End session | Commit work and update graph | Minimize time for other agents to see session outcomes |

**Pain Points**:
- Context packet sometimes contains decisions that were superseded minutes ago -> Job Step: Start session
- No mid-session notification if the task's dependencies change -> Job Step: Code

**Success Metrics**:
- Context packet reflects all graph writes committed before the request timestamp
- Context includes a `context_as_of` timestamp for transparency
