# Onboarding

Guided workspace initialization — walks new users through project setup via a multi-turn conversational flow with contextual suggestions.

## The Problem

A new user creates a workspace and sees an empty graph. They don't know what to tell Osabio about their project, what decisions to surface, or how to structure their work. The onboarding flow guides them through a conversational setup that populates the initial graph state — asking the right questions, suggesting entity types, and transitioning to full chat mode when enough context is established.

## What It Does

- **State machine**: `active` -> `summary_pending` -> `complete` — transitions based on conversation progress
- **LLM-generated replies**: Contextual responses with suggestion anchors derived from user text and extracted entities
- **Low-signal detection**: Identifies when user input doesn't provide enough structure to extract meaningful entities
- **Suggestion constraints**: Maximum 3 suggestions per reply, each anchored to specific user input or extracted entity

## Key Concepts

| Term | Definition |
|------|------------|
| **Onboarding State** | `active` (in progress), `summary_pending` (gathering final context), `complete` (transition to full chat) |
| **Suggestion Anchor** | A reference to user text or extracted entity that grounds each suggestion in context |
| **Low Signal** | User input that doesn't contain enough structure for entity extraction (e.g. "hi", "thanks") |
| **Onboarding Reply** | LLM-generated response with follow-up questions and suggestions to guide project setup |

## How It Works

1. User creates workspace → onboarding state: `active`
2. User sends first message: "I'm building a SaaS platform for project management"
3. Extraction pipeline extracts: project entity, feature mentions
4. Onboarding reply generator:
   - Loads extracted entities as context
   - Generates follow-up: "What technology decisions have you already made?"
   - Suggests: "Create a project node for 'SaaS Platform'?"
5. User answers → more entities extracted → more targeted suggestions
6. After sufficient context → state: `summary_pending` → final summary → `complete`
7. Full chat agent takes over with the populated graph

## Where It Fits

```text
New Workspace Created
  |
  v
Onboarding State: active
  |
  +---> User message
  |       +-> Extraction pipeline (entities)
  |       +-> Onboarding reply (LLM)
  |       +-> Suggestions (max 3, anchored)
  |
  +---> Sufficient context?
  |       +-> No: continue asking
  |       +-> Yes: summary_pending -> complete
  |
  v
Full Chat Agent (with populated graph)
```

**Consumes**: User messages, extracted entities, onboarding state
**Produces**: Guided replies, entity suggestions, state transitions

## File Structure

```text
onboarding/
  onboarding-reply.ts   # LLM reply generation with suggestion anchors and constraints
  onboarding-state.ts   # State machine (active -> summary_pending -> complete) + summary loading
```
