# US-CS-003: Wire Event Stream into Session Lifecycle

## Problem
Marcus Oliveira is a solo technical founder who delegates coding tasks to AI agents. The orchestrator can spawn an agent and the event bridge can transform OpenCode events into Brain stream events, but these two pieces are not connected. After assignment, no events flow to the browser because `createOrchestratorSession` does not iterate the spawn handle's `eventStream` or pipe events through the event bridge. Marcus sees only a status badge with no live feedback.

## Who
- Solo technical founder | Assigns tasks to AI agents | Infrastructure gap prevents him from seeing any live agent activity despite all components existing

## Solution
After spawn succeeds in `createOrchestratorSession`, iterate `handle.eventStream`, pipe each event through `startEventBridge` to the SSE registry, and start the stall detector to monitor for stalled sessions.

## Job Trace
- **J1**: Delegate coding work with confidence -- this is the enabling infrastructure that makes live output (US-CS-001) and follow-up prompts (US-CS-002) possible.
- **Outcomes served**: #1 (minimize time between assigning and seeing agent begin), #2 (minimize undetected wrong approach)

## Domain Examples

### 1: Happy Path -- Events flow from OpenCode to browser
Marcus assigns task "Add pagination to entity search." The spawn succeeds and returns an eventStream. The session lifecycle starts iterating the stream. When the agent emits a `message.part.updated` event, the event bridge transforms it to an `agent_token` StreamEvent and emits it to the SSE registry. The browser's EventSource receives it within 200ms.

### 2: Edge Case -- Agent session ends and event iteration stops
The agent working on "Fix login redirect" finishes and emits a `session.updated` event with status "completed." The event bridge transforms it to an `agent_status` event. The session lifecycle detects the terminal status, stops iterating the event stream, and stops the stall detector. The SSE stream remains open for the client to receive the final status event.

### 3: Error/Boundary -- Event stream errors during iteration
The agent working on "Refactor config loading" crashes mid-task. The event stream throws an error during iteration. The session lifecycle catches the error, updates the session status to "error," emits an `agent_status` error event to the SSE stream, and stops the stall detector.

## UAT Scenarios (BDD)

### Scenario: OpenCode events flow through event bridge to SSE registry
Given Marcus has assigned an agent to task "Add pagination to entity search"
And the spawn returned a valid eventStream and sessionId
When the agent emits a text response event
Then the event bridge transforms it to an `agent_token` StreamEvent
And the SSE registry emits it on the session's stream
And the browser receives the token event

### Scenario: Stall detector starts monitoring after spawn
Given Marcus has assigned an agent to task "Add pagination to entity search"
And the spawn completed successfully
When the session lifecycle wires the event bridge
Then the stall detector starts monitoring with the configured timeout (5 minutes) and step limit (100)
And file change events increment the stall detector's step count
And any event resets the stall detector's activity timer

### Scenario: Event iteration stops on terminal session status
Given the agent is working on task "Fix login redirect"
When the agent emits a session.updated event with status "completed"
Then the event bridge emits the final agent_status event
And event stream iteration stops
And the stall detector is stopped

### Scenario: Event stream error updates session status
Given the agent is working on task "Refactor config loading"
When the event stream throws an error during iteration
Then the session status is updated to "error" in the database
And an agent_status error event is emitted to the SSE stream
And the stall detector is stopped

## Acceptance Criteria
- [ ] `createOrchestratorSession` iterates `handle.eventStream` after successful spawn
- [ ] Each event is piped through `startEventBridge` which transforms and emits to SSE registry
- [ ] Stall detector starts monitoring after event bridge is wired
- [ ] Event iteration stops on terminal status events (completed, aborted, error)
- [ ] Event stream errors are caught, session status updated to "error," and error event emitted
- [ ] Session status transitions to "active" after the first agent event is received

## Technical Notes
- This is a Technical Task that enables US-CS-001 and US-CS-002
- `startEventBridge` exists in `event-bridge.ts` -- takes deps, streamId, sessionId, optional stallDetector
- `startStallDetector` exists in `stall-detector.ts` -- takes deps, config, sessionId, streamId
- Event iteration should be fire-and-forget (not awaited in createOrchestratorSession) to avoid blocking the HTTP response
- The async iteration loop should run in the background after the session creation response is returned
- `updateLastEventAt` dependency: needs a function that merges `{ last_event_at: new Date() }` to the session record

## Dependencies
- Depends on: spawn-opencode.ts eventStream (exists)
- Depends on: event-bridge.ts startEventBridge (exists)
- Depends on: stall-detector.ts startStallDetector (exists)
- Depends on: SSE registry emitEvent (exists)
- Blocked by: Nothing -- all components exist, needs orchestration in session-lifecycle.ts
