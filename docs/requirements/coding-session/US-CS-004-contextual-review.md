# US-CS-004: Contextual Review with Agent Conversation Log

## Problem
Marcus Oliveira is a solo technical founder who reviews AI agent code changes before accepting them. The current review page shows only a raw diff with no context about how or why the agent made each change. For complex tasks, Marcus must mentally reconstruct the agent's reasoning from the diff alone, which is nearly as much work as doing the task himself. When he sent follow-up prompts to course-correct the agent, none of that context is visible in the review.

## Who
- Solo technical founder | Reviews 3-5 agent diffs daily | Needs to understand the reasoning behind each change to make confident accept/reject decisions without re-reading all the code

## Solution
Add an "Agent Log" tab to the review page that shows the full conversation trail (agent output + user prompts) alongside the existing diff view.

## Job Trace
- **J3**: When the agent has finished and I need to decide whether to accept its changes, I want to review the diff alongside the agent's reasoning, so I can make a confident accept/reject decision.
- **Outcomes served**: #7 (minimize time to understand why each change was made), #8 (minimize undetected issues), #9 (minimize review-reject cycles)

## Domain Examples

### 1: Happy Path -- Marcus reviews a course-corrected session
Marcus reviews the diff for "Add pagination to entity search." The Diff tab shows 3 files changed. He switches to the Agent Log tab and sees: (1) the agent's plan to create a new helper, (2) his course correction "Use the existing paginate() function," (3) the agent's acknowledgment and revised approach, (4) file change notifications. With this context, Marcus immediately understands why `query-helpers.ts` is imported instead of a new `utils/pagination.ts` being created. Review takes 2 minutes instead of 10.

### 2: Edge Case -- Session with no user prompts
Marcus reviews the diff for "Fix typo in error message." The agent ran without intervention. The Agent Log tab shows a short conversation: the agent read the file, identified the typo, fixed it. One file changed. The log confirms the fix is straightforward and Marcus accepts in 30 seconds.

### 3: Error/Boundary -- Reject with feedback references specific log context
Marcus reviews "Refactor config loading." The Agent Log shows the agent skipped updating tests. Marcus clicks "Reject with Feedback" and writes "You updated config-loader.ts but didn't update the corresponding test in config-loader.test.ts. Please update the test to match." The feedback references what Marcus learned from the log, not just the diff.

## UAT Scenarios (BDD)

### Scenario: Review page shows Agent Log tab alongside Diff tab
Given the agent has completed work on task "Add pagination to entity search"
And the session included Marcus's course correction about using existing paginate()
When Marcus navigates to the review page
Then a "Diff" tab shows the unified diff (default active)
And an "Agent Log" tab shows the full conversation trail
And the Agent Log includes the agent's output, Marcus's messages, and file change notifications

### Scenario: Agent Log shows user prompts as distinct entries
Given Marcus sent a follow-up prompt "Use the existing paginate() function" during the session
When Marcus views the Agent Log tab on the review page
Then Marcus's message appears as a visually distinct entry (different from agent text)
And the chronological order is preserved (agent output, user prompt, agent response)

### Scenario: Review page for session with no user intervention
Given the agent completed task "Fix typo in error message" without any user prompts
When Marcus navigates to the review page
Then the Agent Log tab shows only agent output and file change notifications
And no user message entries appear

### Scenario: Reject feedback informed by agent log context
Given Marcus is reviewing task "Refactor config loading"
And the Agent Log shows the agent modified config-loader.ts but not config-loader.test.ts
When Marcus clicks "Reject with Feedback"
Then a textarea appears for entering feedback
And Marcus can type specific feedback referencing what the log revealed
And clicking "Send Feedback & Resume Agent" delivers the feedback and returns to live view

### Scenario: File change notifications in log link to diff sections
Given the Agent Log shows "entity-search-route.ts modified"
When Marcus clicks on the file change notification in the log
Then the view switches to the Diff tab
And scrolls to the diff section for "entity-search-route.ts"

## Acceptance Criteria
- [ ] Review page has two tabs: "Diff" (default) and "Agent Log"
- [ ] Agent Log displays the full chronological conversation trail from the session
- [ ] User prompts are visually distinct from agent output in the log
- [ ] File change notifications appear inline in the log with file names
- [ ] Session metadata (duration, files changed count) is shown in the review header
- [ ] Reject flow includes a feedback textarea and "Send Feedback & Resume Agent" button
- [ ] Rejecting navigates back to the live session view with the agent working on the feedback

## Technical Notes
- Agent conversation log source: TBD -- either server-side persistence of token events + user prompts, or client-side accumulation passed to review page
- If server-side: needs new field or table to store accumulated agent output per session
- If client-side: log data must be passed via URL state or session storage to the review page route
- Server-side persistence is recommended because it survives page navigation and enables review of sessions where the user navigated away during agent work
- Existing review page (`review-page.tsx`) fetches session review data via `getSessionReview` -- needs to include conversation log
- Existing review response type (`SessionReviewResponse`) needs a conversationLog field

## Dependencies
- Depends on: US-CS-001 (live output stream must accumulate tokens for the log)
- Depends on: US-CS-002 (follow-up prompts must be recorded in the log)
- Depends on: US-CS-003 (event stream wiring provides the event flow)
- Depends on: Existing review page and accept/reject flow (exists)
