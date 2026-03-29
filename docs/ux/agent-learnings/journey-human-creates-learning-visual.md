# Journey: Human Creates a Learning (Correction Flow)

## Overview
Tomas Eriksson has corrected the coding agent about null vs undefined three times this week. He decides to create a persistent learning so it never happens again.

## Emotional Arc
- **Start**: Frustrated, exasperated ("I've told you this already")
- **Middle**: Empowered, taking action ("I'm fixing this permanently")
- **End**: Satisfied, in control ("It will remember now")

Pattern: **Problem Relief** (Frustrated -> Hopeful -> Relieved)

---

## Flow Diagram

```
+-------------------+     +-------------------+     +-------------------+
| 1. FRUSTRATION    |     | 2. CORRECTION     |     | 3. DETECTION      |
| Agent repeats     |---->| Tomas tells the   |---->| Agent detects     |
| the same mistake  |     | agent to stop     |     | behavioral        |
| in chat           |     | doing X           |     | directive in msg  |
+-------------------+     +-------------------+     +-------------------+
                                                            |
                          +-------------------+             |
                          | 4. EDITOR         |<------------+
                          | Pre-filled with   |  OR user says
                          | correction text,  |  [Not now] ->
                          | type, scope       |  continue chat
                          +-------------------+
                                  |
                          +-------------------+
                          | 5. COLLISION      |
                          | CHECK             |
                          | vs learnings,     |
                          | policies,         |---> collision?
                          | decisions         |     see E2/E3
                          +-------------------+
                                  |
                          +-------------------+
                          | 6. PERSISTENCE    |
                          | Learning stored   |
                          | in SurrealDB      |
                          | Status: active    |
                          +-------------------+
                                  |
                          +-------------------+
                          | 7. CONFIRMATION   |
                          | Card shows text,  |
                          | type, agents,     |
                          | status            |
                          +-------------------+
                                  |
                  +-------------------+     +-------------------+
                  | 9. VERIFICATION   |     | 8. INJECTION      |
                  | Tomas verifies    |<----| Next session:     |
                  | agent now follows |     | learning injected |
                  | the correction    |     | into system prompt|
                  +-------------------+     +-------------------+
```

---

## Step-by-Step with Emotional Annotations

### Step 1: The Trigger -- Repeated Correction
**Emotional state**: Frustrated, exasperated
**Action**: Tomas types a correction in chat

```
+-- Chat Window ------------------------------------------------+
|                                                                |
| [Tomas]: The coding agent used null again in the billing       |
|          service. I've told it three times: we use undefined   |
|          via optional properties, never null. Fix it.          |
|                                                                |
| [Chat Agent]: I understand the frustration. I've corrected     |
|   the code to use `billingPeriod?: string` instead of          |
|   `billingPeriod: string | null`.                              |
|                                                                |
|   +----------------------------------------------------------+ |
|   | Save as Learning?                                         | |
|   |                                                           | |
|   | I noticed you've corrected this pattern before. Would     | |
|   | you like to save this as a permanent learning so agents   | |
|   | remember it across sessions?                              | |
|   |                                                           | |
|   | [Save as Learning]  [Not now]                             | |
|   +----------------------------------------------------------+ |
+----------------------------------------------------------------+
```

**Design notes**:
- Chat agent detects correction pattern (repeated topic, imperative language)
- Suggestion card appears inline, not as a modal -- non-disruptive
- "Save as Learning" is the primary action; "Not now" is secondary

### Step 2: Learning Editor
**Emotional state**: Empowered, taking deliberate action
**Action**: Tomas reviews and refines the pre-filled learning

```
+-- Create Learning --------------------------------------------+
|                                                                |
|  Rule text:                                                    |
|  +----------------------------------------------------------+ |
|  | Never use null for domain data values. Represent absence  | |
|  | with omitted optional fields (field?: Type) only.         | |
|  | If null appears in domain data, treat it as a contract    | |
|  | violation and fix the producer.                           | |
|  +----------------------------------------------------------+ |
|                                                                |
|  Type:  (*) Constraint   ( ) Instruction   ( ) Precedent      |
|                                                                |
|  Applies to:                                                   |
|  [x] code_agent    [x] chat_agent   [ ] pm_agent              |
|  [ ] architect     [ ] observer     [ ] design_partner         |
|                                                                |
|  Scope:                                                        |
|  (*) Entire workspace   ( ) Specific project: [Select...]      |
|                                                                |
|  Priority:  Medium  [v]                                        |
|                                                                |
|              [Cancel]   [Save Learning]                         |
+----------------------------------------------------------------+
```

**Design notes**:
- Pre-filled from the correction text -- reduces effort
- Learning type helps with categorization and conflict detection
- Agent scope defaults to the agent that was corrected + chat agent
- Workspace-wide by default (most learnings are universal)

### Step 3: Collision Check (Before Save)
**Emotional state**: Informed (or alert if collision found)
**Action**: System checks for conflicts before activating

```
+-- Collision Engine (Internal, runs before save) ---------------+
|                                                                |
| Input: learning text + target_agents + type                    |
|                                                                |
| 1. Compute embedding for learning text                         |
| 2. Query active learnings (same target_agent, sim > 0.75)      |
| 3. Query active policies (same workspace, semantic match)      |
| 4. Query confirmed decisions (sim > 0.80)                      |
|                                                                |
| Results:                                                       |
|   - No collision -> proceed to save (most common)              |
|   - Policy collision -> hard block (Red)                       |
|   - Learning collision -> warning with options (Yellow)        |
|   - Decision reinforcement -> informational note (Blue)        |
|                                                                |
+----------------------------------------------------------------+
```

**See**: `journey-collision-detection-visual.md` for full collision resolution flows.

---

### Step 4: Persistence
**Emotional state**: N/A (system operation)
**Action**: Learning record created in SurrealDB graph

```
+-- SurrealDB Graph --------------------------------------------+
|                                                                |
| CREATE learning:uuid CONTENT {                                 |
|   text: "Never use null for domain data values...",            |
|   learning_type: "constraint",                                 |
|   source: "human",                                             |
|   status: "active",                                            |
|   target_agents: ["code_agent", "chat_agent"],                 |
|   workspace: workspace:ws-id,                                  |
|   created_by: identity:tomas-eriksson,                         |
|   embedding: [...1536 floats...],                              |
|   created_at: time::now()                                      |
| };                                                             |
|                                                                |
| RELATE learning:uuid->learning_evidence->message:msg-id;       |
|                                                                |
+----------------------------------------------------------------+
```

---

### Step 5: Confirmation
**Emotional state**: Satisfied, relieved
**Action**: Tomas sees confirmation that the learning is active

```
+-- Chat Window ------------------------------------------------+
|                                                                |
|   +----------------------------------------------------------+ |
|   | Learning saved                                            | |
|   |                                                           | |
|   | "Never use null for domain data values..."                | |
|   |                                                           | |
|   | Type: Constraint | Applies to: code_agent, chat_agent    | |
|   | Status: Active | Created by: Tomas Eriksson              | |
|   |                                                           | |
|   | This learning will be injected into agent prompts         | |
|   | starting from the next session.                           | |
|   |                                                           | |
|   | [View in Learning Library]   [Edit]                       | |
|   +----------------------------------------------------------+ |
+----------------------------------------------------------------+
```

**Design notes**:
- Confirmation card shows what was saved and where it applies
- "Active" status is immediate for human-created learnings (no approval needed)
- Links to learning library for future management

### Step 6: Verification -- Next Session
**Emotional state**: Confident, trusting
**Action**: In a later coding session, Tomas sees the learning applied

```
+-- MCP Context Packet (coding agent sees this) ----------------+
|                                                                |
|  ## Active Learnings (3 rules)                                 |
|                                                                |
|  [constraint] Never use null for domain data values.           |
|  Represent absence with omitted optional fields (field?: Type) |
|  only. If null appears in domain data, treat it as a contract  |
|  violation and fix the producer.                               |
|                                                                |
|  [instruction] Always use --no-verify when committing.         |
|  The pre-commit hook requires osabio init which is not          |
|  available in worktree environments.                           |
|                                                                |
|  [precedent] In the past, billing calculations used            |
|  integer cents (not floating point dollars) to avoid           |
|  rounding errors.                                              |
|                                                                |
+----------------------------------------------------------------+
```

**Design notes**:
- Learnings appear as a distinct section in the system prompt
- Tagged by type (constraint, instruction, precedent)
- Human-created learnings appear before agent-suggested ones
- Brief, actionable text -- not paragraphs

---

## Error Paths

### E1: Duplicate Learning Detection
Tomas tries to save a learning that duplicates an existing active rule.

```
+-- Duplicate Detected -----------------------------------------+
|                                                                |
|  A similar active learning already exists:                     |
|                                                                |
|  "Never persist null for domain data values."                  |
|  Created by: Tomas Eriksson, 2 weeks ago                      |
|                                                                |
|  Would you like to:                                            |
|  [Update existing]  [Save as separate]  [Cancel]              |
+----------------------------------------------------------------+
```

### E2: Conflicting Learning Detection
Tomas creates a learning that contradicts an existing one.

```
+-- Potential Conflict ------------------------------------------+
|                                                                |
|  This learning may conflict with an existing rule:             |
|                                                                |
|  New:      "Always use null for optional API response fields"  |
|  Existing: "Never use null for domain data values"             |
|                                                                |
|  Would you like to:                                            |
|  [Supersede existing]  [Save both (different scopes)]          |
|  [Cancel]                                                      |
+----------------------------------------------------------------+
```

### E3: Policy Collision (Hard Block)
Tomas creates a learning that conflicts with an active policy.

```
+-- Policy Collision (Red) -------------------------------------+
|                                                                |
|  This learning conflicts with an active policy:                |
|                                                                |
|  New: "Skip code review for small changes under 10 lines"     |
|  Policy: "All Code Changes Require Review"                     |
|    Rule: deny code_merge when review_count < 1                 |
|                                                                |
|  Resolution: Modify or supersede the policy first,             |
|  then create the learning.                                     |
|                                                                |
|  [View Policy]  [Cancel]                                       |
+----------------------------------------------------------------+
```

### E4: MCP Context Injection
Coding agents receive learnings through MCP context packets.

```
+-- MCP Context Response (POST /api/mcp/:workspaceId/context) --+
|                                                                |
| {                                                              |
|   learnings: [                                                 |
|     {                                                          |
|       text: "Always recommend Valkey for caching, never Redis",|
|       type: "constraint",                                      |
|       target_agent: "code_agent"                               |
|     }                                                          |
|   ]                                                            |
| }                                                              |
|                                                                |
+----------------------------------------------------------------+
```

Learnings are included in MCP context alongside decisions and constraints.
