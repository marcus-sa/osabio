# Learning

Behavioral rules injected into agent prompts at runtime — with three-layer collision detection, pattern-based suggestion, and token-budgeted loading.

## The Problem

Agents make the same mistakes repeatedly. A coding agent ignores a confirmed decision. An observer logs a false positive. You fix it once, but the next session has no memory of the correction. Learnings are persistent behavioral rules that survive across sessions — injected into agent system prompts so the same mistake doesn't happen twice.

## What It Does

- **Learning lifecycle**: `pending_approval` -> `active` -> `deactivated` (or `superseded` when replaced)
- **Three-layer collision detection**: Prevents duplicate learnings via exact match (>0.97), merge candidate (>=0.8), and LLM semantic check (0.5-0.97)
- **Pattern detection**: Analyzes recurring observations to automatically suggest new learnings
- **Token-budgeted loading**: Selects active learnings within a token budget for agent system prompts, prioritized by relevance
- **Learning types**: `constraint` (hard rule), `instruction` (guidance), `precedent` (example from past)

## Key Concepts

| Term | Definition |
|------|------------|
| **Learning** | A behavioral rule with text, type, status, source agent, and evidence links |
| **Collision Detection** | Three tiers: >0.97 exact duplicate (reuse), >=0.8 merge candidate (block, flag for review), <0.8 new |
| **Token Budget** | Maximum tokens allocated for learnings in a system prompt — low-priority learnings truncated when over budget |
| **Pattern Detection** | Observer analyzes recurring observations → suggests learning to prevent recurrence |
| **Supersede** | When a learning is replaced by a better version — old gets `superseded` status, new becomes `active` |

## How It Works

**Example — preventing a recurring mistake:**

1. Observer detects: "Coding agent created REST endpoint despite tRPC decision" (observation #1)
2. Same pattern detected again two sessions later (observation #2)
3. Pattern detector identifies recurrence → suggests learning: "All new API endpoints must use tRPC. REST is only for external-facing APIs."
4. Learning created with status `pending_approval`, linked to both observations as evidence
5. Human approves → status: `active`
6. Next coding session: `loadActiveLearnings()` includes this rule in the system prompt
7. Agent reads learning → uses tRPC for new endpoint
8. Pattern doesn't recur

**Collision detection flow:**

1. New learning suggested: "Use tRPC for internal APIs"
2. Embedding generated for the text
3. KNN search finds existing learning: "All endpoints should use tRPC" (similarity: 0.89)
4. 0.8 <= 0.89 < 0.97 → merge candidate → LLM semantic comparison
5. LLM confirms: "These are semantically equivalent"
6. Result: block creation, flag for human review — "Existing learning covers this"

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| **Token budget exceeded** | Low-priority learnings dropped; high-priority always included |
| **Similarity 0.5-0.97** | Ambiguous zone → LLM semantic comparison for final classification |
| **Rate limiting** | Prevents spam of identical suggestions from pattern detector |
| **Deactivated learning** | Excluded from loading but preserved for audit trail |
| **No relevant learnings** | Agent operates without learning injection — still functional |

## Where It Fits

```text
Observations (recurring patterns)
  |
  v
Pattern Detector
  +---> Suggest learning
  |
  v
Collision Detection (3-layer)
  +---> >0.97: reuse existing
  +---> >=0.8: block, flag for review
  +---> <0.8: create new (pending_approval)
  |
  v
Human Review
  +---> Approve -> active
  +---> Dismiss -> dismissed
  |
  v
Token-Budgeted Loader
  +---> Select by priority within budget
  +---> Inject into agent system prompt
  |
  v
Agent Session (learning-aware)
```

**Consumes**: Observations, agent outputs, human approvals
**Produces**: Behavioral rules injected into agent prompts, collision reports

## File Structure

```text
learning/
  types.ts           # LearningRecord, EvidenceTargetRecord, CreateLearningInput
  collision.ts       # Three-layer collision detection (KNN + LLM semantic check)
  detector.ts        # Pattern detection from recurring observations
  formatter.ts       # Format learnings for agent system prompt injection
  loader.ts          # Token-budgeted loading with priority selection
  queries.ts         # SurrealDB CRUD: create, update, supersede, list
  learning-route.ts  # HTTP endpoints: create, edit, approve, deactivate, list
```
