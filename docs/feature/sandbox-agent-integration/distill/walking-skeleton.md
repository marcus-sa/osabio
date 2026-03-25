# Walking Skeleton: Sandbox Agent Integration

## Purpose

The walking skeleton is the first acceptance test to implement. It proves the architecture works end-to-end: a developer spawns a sandbox agent session, sends a prompt, and receives events through the SSE stream, with the session record persisted in SurrealDB.

## Walking Skeleton Definition

### WS-1: Developer spawns a session, sends a prompt, and receives events

**User goal**: A developer can start a coding agent session, give it instructions, and see what the agent is doing.

**Given-When-Then**:

```
Given a developer has a workspace with a task ready for work
When the developer requests a coding session for the task
Then a sandbox agent session is created
And the developer receives a stream URL for monitoring
And the session record exists in SurrealDB with session_type "sandbox_agent"

When the developer sends their first prompt to the session
Then events from the agent appear in the SSE stream
And the session status is "active" or "running"
```

**Vertical slice through all layers**:

1. **HTTP Route** -- `POST /api/orchestrator/:ws/sessions/assign` receives the request
2. **Session Lifecycle** -- Creates `agent_session` record in SurrealDB, delegates to adapter
3. **Sandbox Adapter** -- Calls real SandboxAgent SDK `createSession()` against real SandboxAgent Server
4. **Event Bridge** -- Translates SandboxAgent events to Brain StreamEvent format
5. **SSE Registry** -- Delivers events to connected client
6. **SurrealDB** -- Persists session record with sandbox fields

**Stakeholder demo**: "Here is a developer starting a coding session. The agent is working -- you can see its tool calls and file edits appearing live. The session is stored in the database."

### WS-2: Developer sends follow-up prompts

**User goal**: A developer can course-correct the agent without starting over.

```
Given a developer has an active coding session
When the developer sends a follow-up instruction
Then the agent receives the instruction in the same session context
And continues working with full knowledge of previous prompts
When the developer sends a third instruction
Then the agent still has context from all three prompts
```

### WS-3: Session persists in SurrealDB

**User goal**: Session records survive server queries and are inspectable.

```
Given a developer has spawned a coding session
When the session is queried from SurrealDB
Then the record has session_type "sandbox_agent"
And the record has the correct provider and workspace
And external_session_id links to the SandboxAgent runtime session
```

## Litmus Test

1. Title describes user goal? YES -- "Developer spawns a session, sends a prompt, and receives events"
2. Given/When describe user actions? YES -- "developer requests a coding session", "developer sends a prompt"
3. Then describe user observations? YES -- "receives a stream URL", "events appear in the SSE stream"
4. Non-technical stakeholder can confirm? YES -- "Can a developer start an agent and watch it work?"

## Implementation Notes

- WS-1 is the FIRST test to enable. All other tests start with `it.skip` or `it.todo`.
- Requires a running SandboxAgent Server process (real SDK, real server for acceptance tests).
- Uses the existing `setupAcceptanceSuite` from `acceptance-test-kit.ts` with config overrides.
- A new `sandbox-test-kit.ts` may be needed for sandbox-specific helpers (start SandboxAgent Server process, create sandbox adapter, etc.).
- Session creation via HTTP exercises the full stack; direct SurrealDB queries verify persistence.

## Infrastructure Requirements

- SandboxAgent Server binary available on test runner
- SandboxAgent SDK npm package installed
- SurrealDB running (already required by existing acceptance tests)
- Brain server booted in-process (existing pattern)
