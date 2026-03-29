# US-AL-004: Learning Governance Feed Cards

## Problem
Tomas Eriksson's workspace has accumulated 3 pending learning suggestions from the Observer and PM agents this week. He has no way to see them -- they exist in the database but do not surface in his governance feed. Without visibility, agent-suggested learnings pile up unreviewed, and the agents never benefit from the wisdom they detected.

## Who
- Workspace owner | Reviewing governance feed daily | Wants to efficiently approve, edit, or dismiss pending learnings

## Job Story Trace
- **Job 4**: Learning Governance and Curation
- **When** agents have suggested behavioral learnings, **I want to** review them in my governance feed with evidence, **so I can** approve valuable rules and dismiss low-quality ones efficiently.

## Solution
Surface pending learning suggestions as yellow-tier governance feed cards with evidence display, confidence indicator, and Approve/Edit & Approve/Dismiss controls. Include a "Learnings" filter in the feed and provide a learning library view for curation of all learnings.

## Domain Examples

### 1: Happy Path -- Tomas approves a high-confidence suggestion
Tomas opens the governance feed and sees a yellow card: "Never use null for domain data values," suggested by Observer with 89% confidence, targeting code_agent, with evidence from 3 sessions. He clicks "Approve." The learning transitions to "active" immediately, a confirmation appears, and the card disappears from the pending feed.

### 2: Edge Case -- Tomas edits and approves a suggestion
A pending suggestion reads "Avoid null in code." Tomas clicks "Edit & Approve," expands the text to "Never use null for domain data values. Represent absence with omitted optional fields (field?: Type) only. If null appears, treat as contract violation and fix the producer." He also adds chat_agent to the target agents. The refined learning is saved as active.

### 3: Error/Boundary -- Tomas dismisses a low-confidence suggestion
A suggestion "Prefer shorter task titles under 60 characters" has 62% confidence, suggested by PM agent. Tomas clicks "Dismiss," enters optional reason "too subjective, not a universal rule," and confirms. The learning is marked "dismissed" and removed from the feed. The dismissal reason is stored for future reference.

## UAT Scenarios (BDD)

### Scenario: Pending learning appears as yellow-tier feed card
Given the Observer created a learning suggestion with status "pending_approval"
And confidence is 0.89 and target_agents is ["code_agent"]
When Tomas opens the governance feed
Then a yellow-tier card appears showing the suggestion text
And the card displays "Suggested by: Observer | Confidence: 89%"
And the card displays "For: code_agent"
And the card shows evidence from 3 linked sessions
And buttons "Approve", "Edit & Approve", "Dismiss" are visible

### Scenario: Approve transitions learning to active
Given a pending learning suggestion is displayed in the feed
When Tomas clicks "Approve"
Then the learning status changes to "active"
And approved_by references Tomas Eriksson
And approved_at is set to current time
And a confirmation "Learning approved and activated" appears
And the card is removed from the pending feed

### Scenario: Edit and approve with text refinement
Given a pending learning suggestion is displayed
When Tomas clicks "Edit & Approve"
Then the learning editor opens with pre-filled text and settings
When Tomas modifies the text and adds chat_agent to targets
And clicks "Save & Activate"
Then the learning is saved with edited text and status "active"

### Scenario: Dismiss with reason
Given a pending suggestion with confidence 0.62 is displayed
When Tomas clicks "Dismiss"
Then an optional reason input appears
When Tomas enters "too subjective" and confirms
Then the learning status changes to "dismissed"
And dismissed_reason, dismissed_by, dismissed_at are recorded
And the card is removed from the feed

### Scenario: Feed filter for learnings
Given 3 pending learning suggestions and 5 pending entity suggestions exist
When Tomas selects the "Learnings" filter on the governance feed
Then only the 3 learning suggestion cards are displayed

### Scenario: Evidence drill-down
Given a pending learning with 3 evidence_refs is displayed
When Tomas expands the evidence section
Then each evidence shows session date, correction quote, and session link

### Scenario: Discuss action opens scoped chat
Given a pending learning "Prefer connection pooling over single connections" is displayed
When Tomas clicks "Discuss"
Then a chat window opens scoped to the learning context
And the chat agent has the learning text, evidence, and suggesting agent's rationale in context
And Tomas can ask questions like "Why did the observer suggest this?" or "Show me the sessions where this pattern appeared"

### Scenario: Deactivate an active learning from library
Given Tomas views the learning library with 8 active learnings
When he clicks "Deactivate" on the learning "Billing uses integer cents"
Then a confirmation prompt appears "Deactivate this learning? It will no longer be injected into agent prompts."
When Tomas confirms
Then the learning status changes to "deactivated"
And deactivated_at and deactivated_by are recorded
And the learning is no longer returned by prompt injection queries
And the learning remains visible in the library with "deactivated" badge

### Scenario: Learning library view with filters
Given workspace "Osabio Development" has 8 active, 2 superseded, and 1 dismissed learning
When Tomas navigates to the learning library
Then all 11 learnings are listed with status badges
And filter controls are available for: status, agent type, learning type
When Tomas filters by status "active"
Then only the 8 active learnings are shown
And each card displays text, type, source, target agents, and created date

### Scenario: Learning library grouped by target agent
Given Tomas has active learnings across three agents:
  | target_agent | text                                     | type        |
  | architect    | Never recommend Redis                    | constraint  |
  | architect    | Always consider horizontal scaling       | instruction |
  | code_agent   | Use native fetch, never import axios     | constraint  |
  | pm_agent     | Estimate 2x time for design review tasks | instruction |
When Tomas views the learning library
Then learnings are grouped by target agent with count per agent
And each learning shows text, type badge, creation date, and source (human or agent name)

### Scenario: Edit learning text from library
Given an active learning exists for the Architect agent:
  | text                                          | type        |
  | Always recommend Valkey for caching            | constraint  |
When Tomas edits the learning text to "Always recommend Valkey for caching in production. Redis is acceptable for local development."
Then the learning text is updated in the database
And the learning embedding is recomputed
And the updated text is injected in the next Architect session

### Scenario: Change learning type from library
Given an active learning exists with type "precedent":
  | text                                     | type      |
  | We generally prefer PostgreSQL           | precedent |
When Tomas changes the type to "constraint"
Then the learning type is updated to "constraint"
And the learning is now included in mandatory injection (constraints always included, even over token budget)

### Scenario: Empty library for agent with no learnings
Given no learnings exist for the Observer agent
When Tomas views the Observer agent's learning library section
Then an empty state is displayed: "No learnings for the Observer agent. Create one from a chat conversation."

## Acceptance Criteria
- [ ] Pending learnings (status = "pending_approval") appear as yellow-tier governance feed cards
- [ ] Feed cards display: suggestion text, suggested_by, confidence, target_agents, evidence quotes
- [ ] "Approve" transitions status to "active" with approved_by and approved_at
- [ ] "Edit & Approve" opens learning editor pre-filled with suggestion data, saves as active on confirm
- [ ] "Dismiss" captures optional reason and transitions to "dismissed" with dismissed_by and dismissed_at
- [ ] Governance feed has a "Learnings" filter tab
- [ ] Evidence drill-down shows session dates, correction quotes, and links to session records
- [ ] Learning library view accessible from governance feed and navigation
- [ ] Library shows all learnings with filters: status (active/pending/superseded/deactivated/dismissed), agent type, learning type
- [ ] Each learning card shows text, type, source, status, target agents, created date
- [ ] Deactivation changes status to "deactivated" with confirmation prompt, records deactivated_by and deactivated_at
- [ ] Deactivated learnings remain visible in library but are not injected into prompts
- [ ] Learning library grouped by target_agent with count per agent
- [ ] Edit action allows modifying text and type fields
- [ ] Edit triggers embedding recomputation
- [ ] Empty state shown for agents with no active learnings
- [ ] "Discuss" action on feed cards opens scoped chat with learning context pre-loaded

## Technical Notes
- Feed card rendering follows existing suggestion card pattern in `feed-queries.ts` and `feed-route.ts`
- Learning status transitions follow the same actor-timestamped pattern as suggestion accept/dismiss
- Feed query joins learning table WHERE status = "pending_approval" AND workspace = $workspace
- Evidence rendering requires joining evidence_refs to agent_session records for date and correction text
- Learning editor component is reused from US-AL-001 (human creation) with minor adaptation for pre-fill

## Dependencies
- Depends on: US-AL-005 (Learning Schema) -- table must exist
- Depends on: US-AL-002 (Agent Suggests) -- suggestions must exist to display
- Depends on: Existing feed infrastructure (feed-queries.ts, feed-route.ts)
- Enables: US-AL-003 (Runtime Injection) -- approved learnings become injectable
