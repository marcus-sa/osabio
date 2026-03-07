# US-CS-001: Live Agent Output Stream

## Problem
Marcus Oliveira is a solo technical founder who delegates coding tasks to AI agents. After assigning a task, he currently sees only a status badge ("Working") with no visibility into what the agent is actually doing. He finds it frustrating to wait blindly for the agent to finish, unable to tell if it is making progress or heading in the wrong direction. His only option is to wait for idle status, then review a context-free diff.

## Who
- Solo technical founder | Assigns 3-5 coding tasks to AI agents daily | Needs real-time visibility into agent work to maintain trust and catch issues early

## Solution
Wire the existing event bridge to stream agent token output and file change notifications to the browser in real-time, rendering them in an output panel within the task entity detail view.

## Job Trace
- **J1**: When I have a well-defined task that I know an AI agent can handle, I want to assign it and trust that the agent understands what to build, so I can shift my attention to other work without worrying.
- **Outcomes served**: #1 (minimize time to see agent begin), #2 (minimize likelihood of undetected wrong approach), #3 (minimize time to understand agent progress)

## Domain Examples

### 1: Happy Path -- Marcus watches the agent implement pagination
Marcus assigns task "Add pagination to entity search" to an agent. Within 3 seconds, streaming text appears: "I'll add pagination to the entity search endpoint. Let me first look at the current implementation..." As the agent reads `entity-search-route.ts`, the output shows "Reading entity-search-route.ts..." When the agent saves a modified file, an inline notification appears: "entity-search-route.ts modified" and the files changed count increments to 1. Marcus can see the agent is taking the right approach.

### 2: Edge Case -- Agent goes idle and output stops
Marcus is watching the agent work on "Fix login redirect bug." After 2 minutes of active streaming, the output stops and the status badge changes from "Working" to "Idle." The "Review" link appears in the status section. The last output remains visible in the panel so Marcus can scroll back to understand what was done before reviewing the diff.

### 3: Error/Stall -- No events for 30 seconds triggers stall warning
Marcus assigned task "Refactor config loading" 4 minutes ago. The agent streamed output for 3 minutes, then stopped. After 30 seconds of silence, a warning appears: "Agent may be stalled (no activity for 30s)." The Abort button remains available. If no events arrive for 5 minutes total, the stall detector aborts the session automatically.

## UAT Scenarios (BDD)

### Scenario: Agent token events render as streaming text
Given Marcus has an active agent session on task "Add pagination to entity search"
And the event bridge is connected to the SSE registry
When the agent emits a text response "I'll add pagination to the entity search endpoint"
Then the text appears in the agent output panel within 200ms
And the output panel auto-scrolls to the latest content

### Scenario: File change events appear as inline notifications
Given Marcus is watching the agent output stream for task "Add pagination to entity search"
When the agent saves a modified file "entity-search-route.ts"
Then an inline notification appears in the output: "entity-search-route.ts modified"
And the "files changed" count in the status bar increments

### Scenario: Status transitions update the badge in real-time
Given Marcus has an agent session with status "spawning"
When the agent begins responding
Then the status badge changes from "Spawning" to "Working"
And when the agent becomes idle
Then the status badge changes from "Working" to "Idle"
And a "Review" link appears

### Scenario: Stall warning appears after 30 seconds of inactivity
Given Marcus has an active agent session that has been streaming for 3 minutes
When no events are received for 30 seconds
Then a warning message appears "Agent may be stalled (no activity for 30s)"
And the "Abort" button remains available

### Scenario: Output persists when scrolling back during active stream
Given Marcus is watching agent output that exceeds the visible panel height
When Marcus scrolls up to review earlier output
Then the earlier output is visible and readable
And new output continues accumulating below the visible area

## Acceptance Criteria
- [ ] Agent token events stream into an output panel in the entity detail view
- [ ] Output auto-scrolls to latest content during active streaming
- [ ] File change events appear as distinct inline notifications within the output
- [ ] Files changed count updates in the status bar from file change events
- [ ] Status badge updates in real-time from status events (spawning -> active -> idle -> completed)
- [ ] Stall warning appears after 30 seconds of no events
- [ ] Output remains scrollable and readable when agent is idle or completed

## Technical Notes
- Event bridge (`event-bridge.ts`) and stall detector (`stall-detector.ts`) exist but are not wired to `createOrchestratorSession`
- `useAgentSession` hook already handles `agent_status`, `agent_file_change`, and `agent_stall_warning` events but does not handle `agent_token` events
- New component `AgentSessionOutput` needed to accumulate and render token text
- SSE event types: `agent_token` (streaming text), `agent_file_change` (file notifications), `agent_status` (status transitions)
- Auto-scroll must not fight user scroll-up (pause auto-scroll when user scrolls away from bottom)

## Dependencies
- Depends on: spawn-opencode.ts returning eventStream (exists, see `spawn-opencode.ts` lines 181-204)
- Depends on: event-bridge.ts transformOpencodeEvent (exists, see `event-bridge.ts` lines 64-98)
- Depends on: SSE registry infrastructure (exists)
- Blocked by: Nothing -- all infrastructure exists, needs wiring
