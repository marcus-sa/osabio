# US-AL-001: Human Creates Persistent Learning

## Problem
Tomas Eriksson is a workspace owner who manages a team of 3 engineers using Osabio daily. He finds it exhausting to repeat the same corrections to coding agents every session -- "don't use null, use optional properties" -- because agents forget between sessions and he wastes 2-3 minutes per correction, multiple times per week.

## Who
- Workspace owner | Correcting agent behavior in chat | Wants corrections to persist permanently

## Job Story Trace
- **Job 1**: Persistent Agent Correction
- **When** I have corrected the same agent mistake for the third time in a week, **I want to** record a permanent behavioral rule, **so I can** stop wasting time repeating corrections.

## Solution
Enable workspace owners to save behavioral corrections as persistent learnings directly from the chat interface. Human-created learnings are immediately active (no approval required) and injected into agent system prompts in subsequent sessions.

## Domain Examples

### 1: Happy Path -- Tomas saves a null-usage constraint
Tomas corrects the coding agent about null usage for the third time this week. The chat agent detects the repeated correction pattern and offers an inline "Save as Learning" card. Tomas clicks it, reviews the pre-filled text "Never use null for domain data values. Represent absence with omitted optional fields (field?: Type) only," selects type "constraint" and targets "code_agent, chat_agent," and saves. The learning is immediately active. In his next coding session, the agent correctly uses `billingPeriod?: string` instead of `billingPeriod: string | null`.

### 2: Edge Case -- Tomas creates a project-scoped precedent
Tomas is working on the billing module and wants to record a precedent that only applies to billing-related work: "Billing calculations use integer cents, not floating point dollars, to avoid rounding errors." He sets the scope to "Project: Billing Module" and type to "precedent." The learning only applies when agents work in a billing project context.

### 3: Error/Boundary -- Duplicate detection
Tomas tries to save "Do not use null in domain data" but the system detects an existing active learning "Never use null for domain data values" with semantic similarity of 0.91. The system shows both side-by-side and offers to update the existing learning, save as separate, or cancel. Tomas chooses "Update existing" and refines the text.

## UAT Scenarios (BDD)

### Scenario: Save learning from chat correction
Given Tomas Eriksson is chatting with the coding agent in workspace "Osabio Development"
And Tomas has corrected "null vs undefined" usage 3 times in the past 7 days
When Tomas types "Don't use null. Use optional properties."
Then the chat agent applies the correction
And an inline "Save as Learning" card appears with pre-filled text

### Scenario: Learning editor pre-fills and allows customization
Given Tomas clicked "Save as Learning" on a null-usage correction
When the learning editor opens
Then the rule text is pre-filled from the correction context
And type selector shows Constraint, Instruction, Precedent
And agent scope checkboxes default to code_agent and chat_agent
And workspace-wide scope is selected by default

### Scenario: Human-created learning is immediately active
Given Tomas filled in the learning editor with constraint "Never use null for domain data values"
And selected code_agent and chat_agent as target agents
When Tomas clicks "Save Learning"
Then a learning record is created with status "active"
And source is "human" and created_by is Tomas Eriksson
And no approval step is required
And a confirmation card appears in chat

### Scenario: Duplicate learning detection
Given an active learning "Never persist null for domain data values" exists in workspace "Osabio Development"
When Tomas saves a new learning "Do not use null in domain data"
Then the system detects semantic similarity above 0.85
And shows the existing learning alongside the new one
And offers "Update existing", "Save as separate", and "Cancel" options

### Scenario: Conflicting learning detection
Given an active learning "Never use null for domain data values" exists
When Tomas saves "Always use null for optional API response fields"
Then the system detects a potential conflict
And offers "Supersede existing", "Save both (clarify scopes)", and "Cancel"

## Acceptance Criteria
- [ ] Chat agent detects repeated correction patterns (3+ on same topic in 14 days) and offers "Save as Learning" inline card
- [ ] Learning editor pre-fills from correction context with editable text, type selector, agent scope, and workspace/project scope
- [ ] Human-created learnings are saved with status "active" immediately (no approval flow)
- [ ] Learning records include text, type, status, source, target_agents, workspace, embedding, created_by, created_at
- [ ] Duplicate detection fires when new learning has semantic similarity > 0.85 with an existing active learning
- [ ] Conflict detection surfaces potential contradictions before save
- [ ] Supersession changes old learning status to "superseded" and links to new learning

## Technical Notes
- Learning schema follows existing entity patterns (observation, suggestion) -- SCHEMAFULL table with workspace, embedding, status, timestamps
- Embedding generated via existing embedding pipeline (same as observation/suggestion)
- Duplicate/conflict detection uses KNN vector search on learning embeddings (same two-step pattern as other KNN queries for SurrealDB v3.0)
- Learning editor is a web UI component (same UI stack as suggestion approval cards)
- Correction pattern detection in chat agent uses conversation history analysis (existing message context)

## Dependencies
- Depends on: US-AL-005 (Learning Schema) -- schema must exist before records can be created
- Depends on: US-AL-003 (Runtime Injection) -- learnings need injection to have effect
- Enables: US-AL-004 (Governance Feed) -- created learnings appear in library view
