# US-LL-04: Create Learning with Agent Targeting

## Problem

Marcus is a workspace owner who just resolved a recurring issue: his coding agents kept using module-level mutable singletons, causing test flakiness. He added the rule to CLAUDE.md manually, but that only helps Claude Code -- the chat agent and PM agent do not read CLAUDE.md. He wants to create a learning that applies to specific agents so the rule is enforced consistently at runtime, without manually editing multiple configuration files. Currently, creating a learning requires a POST request with a JSON body to the API.

## Who

- Workspace owner | Wants to codify a new behavioral rule | Needs precise control over which agents receive it

## Solution

A "Create Learning" dialog accessible from the "+ New" button in the library header. The dialog collects the learning text, type (constraint/instruction/precedent), priority, and agent targeting (all agents or specific selection). On submission, collision detection runs and warns about overlaps before finalizing. Human-created learnings become active immediately.

## Job Story Trace

- **Job 3: Scoping & Targeting** -- "When I add a learning, I want to control which agents it applies to, so I do not accidentally constrain agents that do not need that rule."
- **Job 1: Visibility & Audit** -- created learning appears in library immediately.

## Domain Examples

### 1: Happy Path -- Marcus creates a targeted constraint

Marcus clicks "+ New" in the library header. The create dialog opens. He types: "Never use `any` type in TypeScript. Use `unknown` for truly unknown types and narrow with type guards." He selects type "constraint", priority "high", and under Applies to, switches from "All agents" to "Specific agents" and checks only "mcp." He clicks "Create Learning." No collisions detected. Toast: "Learning created and activated." The new learning appears in the Active tab with type badge "constraint", priority "high", and agent chip "mcp."

### 2: Edge Case -- Collision detected during creation

Elena, workspace owner for "fintech-platform", clicks "+ New" and types "Use TypeScript strict mode always." She selects type "constraint." On submission, the API returns a collision: "Similar to active learning: 'Always use TypeScript strict mode' (similarity: 89%)." A collision warning appears with the existing learning details. Elena clicks "Go Back and Edit" and refines her text to be about a different aspect: "Enable noUncheckedIndexedAccess in TypeScript compiler options." She resubmits with no collision.

### 3: Error/Boundary -- Form validation prevents empty submission

Marcus opens the create dialog and clicks "Create Learning" without filling in any fields. The button is disabled because text is empty and no type is selected. He types the learning text but does not select a type. The button remains disabled. He selects "instruction" and the button enables. He submits successfully.

## UAT Scenarios (BDD)

### Scenario: Open create dialog

```gherkin
Given Marcus is on the learning library page
When Marcus clicks the "+ New" button
Then a create learning dialog opens
And the text field is empty with helpful placeholder text
And no type is pre-selected
And priority defaults to "medium"
And "All agents" is selected by default
```

### Scenario: Create with all-agents targeting

```gherkin
Given Marcus has opened the create dialog
When Marcus enters text "Explain reasoning before presenting conclusions"
And Marcus selects type "instruction"
And Marcus leaves targeting as "All agents"
And Marcus clicks "Create Learning"
Then the learning is created with an empty target_agents array
And a success toast shows "Learning created and activated"
And the learning appears in the Active tab with "All agents" badge
```

### Scenario: Create with specific agent targeting

```gherkin
Given Marcus has opened the create dialog
When Marcus enters text "Always include task ID in commit messages"
And Marcus selects type "constraint" and priority "high"
And Marcus selects "Specific agents" and checks "mcp"
And Marcus clicks "Create Learning"
Then the learning is created with target_agents ["mcp"]
And the card shows agent chip "mcp"
```

### Scenario: Collision warning on submission

```gherkin
Given there is an active learning "Always use TypeScript strict mode"
And Elena opens the create dialog
When Elena enters text "Use TypeScript strict mode always"
And selects type "constraint"
And clicks "Create Learning"
Then a collision warning shows: similar learning at 89% similarity
And Elena can choose "Go Back and Edit" or "Create Anyway"
```

### Scenario: Form validation

```gherkin
Given Marcus has opened the create dialog
Then the "Create Learning" button is disabled
When Marcus enters learning text but does not select a type
Then the button remains disabled
When Marcus selects type "instruction"
Then the button becomes enabled
```

## Acceptance Criteria

- [ ] "+ New" button visible in library header on all tabs
- [ ] Create dialog collects: text (required), type (required), priority (default medium), target agents (default all)
- [ ] Type options show inline descriptions (constraint, instruction, precedent)
- [ ] "All agents" vs "Specific agents" toggle with agent type checkboxes
- [ ] Form validation: text and type required before submission
- [ ] Collision detection results shown inline if collisions exist
- [ ] Collision warning provides "Go Back and Edit" and "Create Anyway" options
- [ ] Human-created learnings are activated immediately (status: active)
- [ ] New learning appears in Active tab after creation
- [ ] Active tab count increments after creation

## Technical Notes

- Create endpoint: `POST /api/workspaces/:workspaceId/learnings` with body `{ text, learning_type, priority?, target_agents? }`
- Collision detection runs server-side during creation and returns results in response
- Human-created learnings get status "active" unless a blocking collision is detected (then "pending_approval")
- Embedding is generated server-side for the learning text (non-blocking on failure)
- The `source` field is set to "human" automatically for UI-created learnings

## Dependencies

- US-LL-01 (Browse & Filter Library) -- the create button and resulting card live on the library page
- Existing create API endpoint (complete)
- Shared `AGENT_TYPES` constant (needed, same dependency as US-LL-01)
