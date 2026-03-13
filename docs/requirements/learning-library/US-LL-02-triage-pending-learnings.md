# US-LL-02: Inline Pending Actions in Library

## Problem

The governance feed already serves as the primary triage surface for pending learnings — agent-suggested learnings appear as "Needs Review" cards with Approve/Dismiss/Discuss actions. However, when a user is browsing the learning library (US-LL-01), pending learnings appear in the filtered list without any way to act on them. The user must context-switch to the feed to approve or dismiss. The library should offer the same inline actions so users can triage pending items in context alongside active/dismissed/deactivated learnings.

## Who

- Workspace owner | Browsing the learning library | Encounters pending learnings in the list

## Solution

Pending learning cards in the library list include inline Approve and Dismiss action buttons — the same actions available in the governance feed. Clicking Approve opens a lightweight dialog with optional text editing and collision warnings. Clicking Dismiss opens a dialog requiring a reason. No dedicated "Pending" tab or separate triage flow — pending learnings are just another status in the existing filter.

**Key design decision:** The feed is the notification layer (push — "something needs attention"). The library is the management layer (pull — "let me review everything"). Both surfaces share the same action endpoints and dialog patterns.

## Job Story Trace

- **Job 4: Approval & Triage** — "When agents suggest learnings from patterns they detect, I want to review and approve or dismiss them efficiently, so I maintain governance without bottlenecking."
- **Job 1: Visibility & Audit** — "When browsing all learnings, I want to see pending items in context alongside active ones, so I understand the full picture."

## Domain Examples

### 1: Happy Path — Approve while browsing

Marcus is browsing the library filtered to "All Statuses" for agent type "mcp". He sees 12 active learnings and 1 pending learning intermixed (sorted by creation date). The pending card shows a "pending" badge, the suggesting agent (observer_agent), and confidence (87%). He clicks Approve directly on the card. A compact dialog appears with editable text and no collisions. He clicks "Approve as Active." Toast confirms. The card's badge updates to "active" in place.

### 2: Edge Case — Dismiss while filtered to pending only

Marcus filters the library to status "pending_approval". Three items appear. He reads each one in context — seeing their type, priority, and target agents alongside the filter. He dismisses one with reason "Already covered by CLAUDE.md guidelines." The card is removed from the filtered view. Count updates.

### 3: Boundary — Collision warning on approve

Marcus clicks Approve on a pending learning "Use RecordId objects instead of string IDs." The approve dialog shows a collision warning: similar active learning exists (94% similarity). Marcus reads both, decides this is a duplicate, and clicks Cancel. He then dismisses it with reason "Duplicate of existing active learning."

## UAT Scenarios (BDD)

### Scenario: Pending learning cards show inline actions

```gherkin
Given Marcus navigates to the learning library
And the workspace has 1 pending learning and 5 active learnings
When Marcus views the unfiltered list
Then the pending learning card shows "Approve" and "Dismiss" buttons
And active learning cards do not show "Approve" or "Dismiss" buttons
And the pending card displays a "pending" status badge
```

### Scenario: Approve from library inline

```gherkin
Given Marcus is viewing the learning library
And a pending learning "Avoid module-level mutable singletons" is visible
When Marcus clicks "Approve" on that card
Then an approve dialog opens with editable text
And Marcus clicks "Approve as Active"
Then the learning status changes to "active"
And a success toast shows "Learning approved and activated"
And the card's status badge updates to "active" in place
```

### Scenario: Approve with text edit from library

```gherkin
Given Marcus opens the approve dialog for a pending learning
When Marcus edits the text to add clarification
And clicks "Approve as Active"
Then the learning is saved with the edited text
And the card updates to show the new text and "active" status
```

### Scenario: Dismiss from library with reason

```gherkin
Given Marcus clicks "Dismiss" on a pending learning in the library
Then a dismiss dialog opens with a required reason field
When Marcus enters reason "Already covered by CLAUDE.md"
And clicks "Dismiss"
Then the learning status changes to "dismissed"
And a success toast shows "Learning dismissed"
```

### Scenario: Collision warning in approve dialog

```gherkin
Given a pending learning is similar to an existing active learning
When Marcus clicks "Approve" on the pending learning
Then the approve dialog shows a collision warning
And the warning displays the similar active learning text and similarity percentage
And Marcus can choose to approve anyway or cancel
```

## Acceptance Criteria

- [ ] Pending learning cards in the library list show "Approve" and "Dismiss" inline action buttons
- [ ] Only pending cards show triage actions — active/dismissed/deactivated cards do not
- [ ] Approve action opens dialog with editable text field (pre-filled with current text)
- [ ] Collision warnings display inline in approve dialog when similar active learnings exist
- [ ] Approve-with-edit sends updated text via `new_text` field in API action
- [ ] Dismiss action requires a non-empty reason before submission
- [ ] Card updates optimistically after successful action (status badge, button visibility)
- [ ] Success toast shown after approve and dismiss actions

## Technical Notes

- Reuses the same API endpoints as the governance feed:
  - Approve: `POST /api/workspaces/:workspaceId/learnings/:id/actions` with `{ action: "approve", new_text?: string }`
  - Dismiss: same path with `{ action: "dismiss", reason: string }`
- The approve/dismiss dialog components should be shared between feed and library (extract if not already shared)
- Collision detection for approve flow: may need a separate client-side fetch or server-side inclusion in the action response
- No dedicated Pending tab — pending is a status filter value in US-LL-01's filter controls

## Dependencies

- US-LL-01 (Browse & Filter Library) — pending learnings appear in the library list
- Existing action API endpoint (complete)
- Governance feed approve/dismiss UI (complete — dialog components may be extractable)
