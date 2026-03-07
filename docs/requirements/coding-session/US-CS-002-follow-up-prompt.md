# US-CS-002: Follow-Up Prompt to Running Agent

## Problem
Marcus Oliveira is a solo technical founder who delegates coding tasks to AI agents. When he notices the agent heading in the wrong direction (e.g., writing a new utility function when one already exists), his only option is to abort the entire session and lose all progress. He finds it wasteful and frustrating to have no middle ground between "let it run" and "kill it." He needs a way to send guidance to the agent without destroying its work.

## Who
- Solo technical founder | Watches agent output in real-time | Needs to course-correct without losing progress when the agent takes a wrong approach

## Solution
Add a text input below the agent output panel for sending follow-up prompts to active sessions, backed by a new POST endpoint that delivers messages via the registered sendPrompt handle.

## Job Trace
- **J2**: When I notice the agent is heading in the wrong direction, I want to send it guidance without disrupting its flow, so I can steer it toward the right solution without starting over.
- **Outcomes served**: #4 (minimize time to course-correct), #5 (minimize likelihood of losing progress), #6 (minimize anxiety about prompt disruption)

## Domain Examples

### 1: Happy Path -- Marcus redirects the agent to use an existing function
Marcus is watching the agent work on "Add pagination to entity search." The output shows "I'll create a new pagination helper function in utils/pagination.ts..." Marcus types "Use the existing paginate() function from app/src/shared/query-helpers.ts instead of writing a new one" and clicks Send. His message appears in the output as a visually distinct block. The agent responds "Good catch! I'll use the existing paginate() function" and continues working with the corrected approach.

### 2: Edge Case -- Marcus sends additional instructions to an idle agent
The agent finished its initial work on "Add pagination to entity search" and went idle. Marcus reviews the output and realizes cursor-based pagination would also be useful. He types "Also add cursor-based pagination as an alternative to offset pagination" and sends. The session transitions from "idle" to "active" and the agent begins implementing the additional feature.

### 3: Error/Boundary -- Prompt rejected for a terminal session
The agent session on "Fix login redirect" has been aborted. Marcus navigates back to the task detail. The message input is disabled with a note "Session was aborted." Marcus must assign a new agent session if he wants to continue the work.

## UAT Scenarios (BDD)

### Scenario: Marcus sends a follow-up prompt to a working agent
Given Marcus has an active agent session on task "Add pagination to entity search"
And the agent output shows "I'll create a new pagination helper function"
When Marcus types "Use the existing paginate() function from query-helpers.ts instead" in the message input
And clicks "Send"
Then the endpoint responds with 202 Accepted
And Marcus's message appears in the output as a distinct user message block
And the input field clears and re-enables for the next message
And the agent responds acknowledging the guidance within 5 seconds

### Scenario: Marcus sends a prompt to an idle agent
Given the agent session on task "Add pagination to entity search" has status "idle"
When Marcus types "Also add cursor-based pagination as an alternative" and clicks "Send"
Then the session status transitions from "idle" to "active"
And the agent begins working on the additional request
And the output continues in the same panel

### Scenario: Prompt input is disabled for completed session
Given the agent session on task "Add pagination to entity search" has status "completed"
When Marcus views the session panel
Then the message input is disabled
And a note below the input explains "Session has ended."

### Scenario: Prompt input is disabled for aborted session
Given the agent session on task "Fix login redirect" has status "aborted"
When Marcus views the session panel
Then the message input is disabled
And a note below the input explains "Session was aborted."

### Scenario: Prompt delivery fails gracefully when handle is missing
Given the agent session "sess-12345" was active but the server restarted
And the sendPrompt handle is no longer in the in-memory registry
When Marcus sends a follow-up prompt
Then the endpoint responds with 404
And an error message shows "Session not found. The agent may have been restarted."

## Acceptance Criteria
- [ ] A text input with Send button appears below the agent output when session is active or idle
- [ ] Submitting a prompt delivers the text to the agent via POST endpoint (202 response)
- [ ] User messages appear in the output as visually distinct blocks (different from agent text)
- [ ] Input clears and re-enables after successful send
- [ ] Input is disabled when session status is completed, aborted, or error
- [ ] Disabled input shows an explanatory note for the terminal state
- [ ] Sending a prompt to an idle session transitions it back to active

## Technical Notes
- POST endpoint: `/api/orchestrator/:workspaceId/sessions/:sessionId/prompt`
- Request body: `{ text: string }`
- Response: 202 Accepted (fire-and-forget delivery)
- Error responses: 404 if session/handle not found, 409 if session in terminal status
- sendPrompt handle stored in handleRegistry (in-memory Map in session-lifecycle.ts)
- Handle loss on server restart is a known limitation -- sessions are not resumable after restart
- Client API wrapper needed in `orchestrator-api.ts`

## Dependencies
- Depends on: US-CS-001 (live output stream -- user needs to see agent output to know when to intervene)
- Depends on: sendPrompt function on OpenCodeHandle (exists, see `spawn-opencode.ts` lines 194-199)
- Depends on: handleRegistry in session-lifecycle.ts (exists, see line 100)
