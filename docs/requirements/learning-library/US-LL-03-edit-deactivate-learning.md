# US-LL-03: Edit or Deactivate Active Learning

## Problem

Marcus is a workspace owner who noticed his coding agents are being overly rigid about TypeScript strict mode -- they refuse to work with JavaScript files even when the task requires it. He suspects the learning "Always use TypeScript strict mode" is too broadly stated. Currently, he cannot edit the text or deactivate the learning without making raw API calls. He needs to either refine the wording or turn it off entirely, with confidence that the change is scoped correctly and reversible.

## Who

- Workspace owner | Identified a problematic active learning | Wants precise correction without side effects

## Solution

From the expanded learning detail card, Marcus can click "Edit" to open a dialog with pre-populated fields (text, type, priority, target agents) and modify any field. Alternatively, he can click "Deactivate" to stop the learning from being injected into agent prompts, with a confirmation dialog that shows the scope of impact. Deactivation is reversible -- the learning moves to the Deactivated tab and preserves its audit trail.

## Job Story Trace

- **Job 2: Correction** -- "When an agent is behaving incorrectly because of a bad learning, I want to find and fix or remove it, so I can correct the behavior without starting over."
- **Job 3: Scoping & Targeting** -- "When I add a learning, I want to control which agents it applies to."

## Domain Examples

### 1: Happy Path -- Marcus edits a learning to add nuance

Marcus navigates to the Learning Library, filters by type "constraint" and agent "mcp". He finds "Always use TypeScript strict mode" and expands the card. He clicks "Edit." The dialog shows the current text, type (constraint), priority (high), and target agents (chat_agent, mcp). He changes the text to "Always use TypeScript strict mode in new TypeScript files. When working with existing JavaScript files, do not convert to TypeScript unless explicitly requested." He clicks "Save Changes." Toast confirms "Learning updated successfully." The card refreshes with the new text.

### 2: Edge Case -- Marcus narrows agent targeting during edit

Marcus opens the edit dialog for "Prefer functional composition over class hierarchies" which currently applies to All agents. He realizes this rule is only relevant for coding agents, not for the PM or observer agents. He switches from "All agents" to "Specific agents" and checks only "mcp" and "chat_agent." He clicks "Save Changes." The card now shows chips for "mcp" and "chat_agent" instead of "All agents."

### 3: Error/Boundary -- Marcus deactivates a learning with confirmation

Priya is managing workspace "api-platform" and notices the observer_agent keeps flagging false positives based on the learning "Database migrations must use transactions." She investigates and realizes the learning conflicts with a new database that does not support transactions. She clicks "Deactivate" on the learning. The confirmation dialog shows: "This learning currently applies to: mcp. Deactivating will stop this rule from being injected into agent prompts. The learning will be preserved in the Deactivated tab and can be reactivated later." She clicks "Deactivate." Toast confirms. The learning disappears from the Active tab and appears in Deactivated.

## UAT Scenarios (BDD)

### Scenario: Open edit dialog with pre-populated fields

```gherkin
Given Marcus has expanded the active learning "Always use TypeScript strict mode"
When Marcus clicks "Edit"
Then an edit dialog opens
And the text field contains "Always use TypeScript strict mode"
And the type selector shows "constraint"
And the priority selector shows "high"
And target agents "chat_agent" and "mcp" are checked
```

### Scenario: Save edited text

```gherkin
Given Marcus has opened the edit dialog for "Always use TypeScript strict mode"
When Marcus changes the text to include nuance about JavaScript files
And Marcus clicks "Save Changes"
Then the learning text is updated
And a success toast shows "Learning updated successfully"
And the card displays the new text immediately
```

### Scenario: Change target agents

```gherkin
Given Marcus has opened the edit dialog for "Prefer functional composition over classes"
And it currently applies to "All agents"
When Marcus switches to "Specific agents" and checks only "mcp" and "chat_agent"
And Marcus clicks "Save Changes"
Then the learning target_agents updates to ["mcp", "chat_agent"]
And the card shows agent chips for "mcp" and "chat_agent"
```

### Scenario: Deactivate with confirmation showing scope

```gherkin
Given Priya has expanded an active learning that applies to "mcp"
When Priya clicks "Deactivate"
Then a confirmation dialog appears
And the dialog shows: "This learning currently applies to: mcp"
And the dialog explains deactivation is reversible
When Priya clicks "Deactivate" in the dialog
Then the learning status changes to "deactivated"
And a success toast shows "Learning deactivated. Agents will no longer follow this rule."
And the learning moves from Active to Deactivated tab
```

### Scenario: Cancel edit preserves original

```gherkin
Given Marcus has made changes in the edit dialog
When Marcus clicks "Cancel"
Then the dialog closes
And the learning text and fields remain unchanged
```

## Acceptance Criteria

- [ ] Edit button visible on expanded active learning cards
- [ ] Edit dialog pre-populates all fields from current learning state
- [ ] Text, type, priority, and target agents are all editable
- [ ] Save persists changes and updates the card immediately
- [ ] Deactivate button visible on expanded active learning cards
- [ ] Deactivation confirmation dialog shows which agents are affected
- [ ] Deactivation confirmation explains the action is reversible
- [ ] Deactivated learning appears in the Deactivated tab
- [ ] Tab counts update after deactivation (Active decrements, Deactivated increments)
- [ ] Cancel in both edit and deactivation dialogs has no side effects

## Technical Notes

- Edit text: `POST /api/workspaces/:workspaceId/learnings/:id/actions` with `{ action: "approve", new_text: "..." }` -- note: current API overloads approve action for text updates. This may need a separate `update` action or a dedicated PUT endpoint for clarity. The current `updateLearningText` query exists but is only called during approve flow.
- Deactivate: same action endpoint with `{ action: "deactivate" }`
- Priority and target_agents updates may need a new API endpoint -- current action endpoint only handles status transitions and text changes. Flagging this as a potential backend gap.
- Deactivation is one-way in current valid transitions (`active -> deactivated`). Reactivation would need a new transition (`deactivated -> active`) if desired.

## Dependencies

- US-LL-01 (Browse & Filter Library) -- edit/deactivate actions live on the expanded card detail
- Potential backend gap: PUT endpoint or expanded action for editing priority and target_agents on active learnings
- Potential backend gap: reactivation transition if "reactivate from Deactivated tab" is desired (not in current scope)
