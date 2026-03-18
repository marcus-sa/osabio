# ADR-060: "Agent Activator" Over "Agent Coordinator"

## Status
Confirmed

## Context
The component that listens for entity events and starts new agent sessions was originally named "Agent Coordinator." During design review, the name was challenged on two grounds:

1. **"Coordinator" implies routing between existing agents** — but the component doesn't route to running agents. It starts NEW sessions. The LLM proxy handles enriching running sessions.
2. **"Coordinator" is vague** — it doesn't communicate what the component actually does: activate agents in response to entity events.

Several alternatives were considered: Observation Router (too specific to observations), Event Dispatcher (too generic), Reactive Router (too vague), Agent Spawner (too implementation-specific).

## Decision
Name the component **Agent Activator**. It activates (starts) new agent sessions when entity events (currently observations) require attention that no running agent is covering.

- File: `app/src/server/reactive/agent-activator.ts`
- Endpoint: `POST /api/internal/activator/observation`
- Factory: `createAgentActivatorHandler()`
- Log prefix: `activator.*`

## Rationale
- **"Activator" communicates the action**: it activates agents that aren't running yet
- **Distinguishes from proxy**: the proxy enriches; the activator initiates
- **Extensible**: if the activator later handles events beyond observations (e.g., decision superseded → activate architect agent), the name still fits — it activates agents from entity events

## Consequences
- All code, tests, docs, and ADRs use "Agent Activator" / "activator" naming
- The SurrealDB DEFINE EVENT trigger name remains `coordinator_observation_routed` in existing migrations (renaming DB triggers is a breaking migration for no functional benefit)
