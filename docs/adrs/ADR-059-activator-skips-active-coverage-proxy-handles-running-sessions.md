# ADR-059: Agent Activator Skips Observations With Active Coverage

## Status
Confirmed

## Context
When an observation is created in the graph (e.g., "Task T-47 contradicts decision D-99"), two components could potentially act on it:

1. **Agent Activator** — starts NEW agent sessions for observations that need attention
2. **LLM Proxy** — enriches ALREADY-RUNNING agent sessions with relevant context on each request

If both act on the same observation, redundant work is created: the activator starts a new agent while the proxy is already surfacing the observation to the agent that's actively working on the affected task.

## Decision
The Agent Activator checks whether the observation's target entity (resolved via the `observes` edge) already has an active agent session (`orchestrator_status = "active"` on the same task). If active coverage exists, the activator skips the observation entirely — the proxy will surface it to the running agent on its next request via vector search.

The activator only starts new agents for observations that have **no active coverage**.

### Separation of Concerns

| Component | Responsibility | When it acts |
|-----------|---------------|--------------|
| Agent Activator | Start NEW agent sessions | Observation has no active agent on target entity |
| LLM Proxy | Enrich RUNNING sessions with relevant context | Every proxy request (vector search for recent changes) |

The activator answers: "Does someone need to look at this?" The proxy answers: "What does the currently running agent need to know?"

## Rationale
- **No redundant work**: An agent already working on task T-47 will see the conflict observation via the proxy's vector search. Starting a second agent on the same task wastes compute.
- **Agents don't message agents**: Osabio's coordination model is graph-native. Agents read/write the graph independently. The proxy reads from the graph; the activator writes new sessions to the graph. Neither sends messages to the other.
- **Simpler activator logic**: The activator doesn't need to classify urgency levels or manage delivery queues. It just checks: "Is anyone on this?" If yes, skip. If no, find who should be.

## Consequences
- The activator runs an active session check before KNN routing: `SELECT count() FROM agent_session WHERE task_id = $task AND workspace = $ws AND orchestrator_status = "active"`
- Observations without a target entity (no `observes` edge) always go through KNN routing — there's no task to check coverage for
- The proxy's vector search handles all context enrichment for running sessions, regardless of whether the activator processed the observation

## Alternatives Rejected
- **Route to both**: Activator starts new agent AND proxy enriches existing one. Rejected: creates duplicate agent sessions on the same task.
- **Activator routes to existing sessions via context_queue**: Rejected in ADR-055. The graph is the delivery mechanism, not a per-session message queue.
- **Let the activator decide between "start new" and "enrich existing"**: Rejected: violates separation of concerns. The activator shouldn't know about the proxy's injection pipeline.

## Related
- ADR-055: Graph-native context over context_queue
- ADR-058: DEFINE EVENT webhooks for activator
