# JTBD Analysis: Learning Library

## Overview

The Learning Library is a governance UI for managing behavioral rules (learnings) that are injected into AI agent prompts at runtime. Users need to see, understand, correct, scope, and triage what their agents are learning -- because unchecked learning leads to unchecked behavior.

---

## Job 1: Visibility & Audit

### Job Story

**When** I am managing multiple AI agents across a workspace and I am unsure what rules are shaping their behavior,
**I want to** see all learnings organized by status, type, and which agents they apply to,
**so I can** understand and trust that my agents are operating under the right constraints.

### Three Dimensions

| Dimension | Description |
|-----------|-------------|
| **Functional** | View all learnings with filtering by status (active, pending, dismissed, deactivated), type (constraint, instruction, precedent), and target agent |
| **Emotional** | Feel confident and in control of agent behavior -- "I know what rules are running" |
| **Social** | Be seen as a responsible operator who governs AI agents deliberately, not blindly |

### Forces Analysis

| Force | Description |
|-------|-------------|
| **Push** | Currently zero visibility into what learnings exist -- the only way is raw API calls. Users cannot answer "what rules are my agents following?" without developer tools |
| **Pull** | A browsable, filterable library where the full picture is one click away. Immediate clarity on what is active, what is pending, what was dismissed |
| **Anxiety** | "What if I am seeing a stale view and agents are following rules I do not see?" / "What if the list is overwhelming and I cannot find what matters?" |
| **Habit** | Users currently do not inspect learnings at all -- they trust the system blindly or ask in chat. Some power users may curl the API |

### Assessment

- Switch likelihood: **High** -- push is very strong (zero current visibility)
- Key blocker: Information overload anxiety -- need good filtering and grouping
- Key enabler: The backend already supports all needed queries
- Design implication: Progressive disclosure with smart defaults (show active learnings first, pending count as badge)

### Outcome Statements

| # | Outcome Statement | Imp. | Sat. | Score | Priority |
|---|-------------------|------|------|-------|----------|
| 1 | Minimize the time to determine what rules are currently active for a specific agent | 95% | 5% | 18.0 | Extremely Underserved |
| 2 | Minimize the likelihood of not knowing a learning exists that affects agent behavior | 90% | 10% | 17.0 | Extremely Underserved |
| 3 | Minimize the time to find a specific learning by its content or type | 85% | 5% | 16.0 | Extremely Underserved |
| 4 | Minimize the number of steps to understand the full governance picture | 80% | 10% | 14.0 | Underserved |

### Data Quality Notes

- Source: team estimates based on product context (no users have a learning UI today)
- Confidence: Medium (team proxy, not user interviews)

---

## Job 2: Correction

### Job Story

**When** I notice an agent behaving incorrectly or producing undesired outputs and I suspect a bad learning is the cause,
**I want to** find the problematic learning and edit its text or deactivate it,
**so I can** correct the agent's behavior immediately without disrupting other learnings.

### Three Dimensions

| Dimension | Description |
|-----------|-------------|
| **Functional** | Search/filter learnings, identify the problematic one, edit its text or deactivate it |
| **Emotional** | Feel relief that the problem is fixable and urgency during diagnosis -- "I need to stop this now" |
| **Social** | Demonstrate competence by diagnosing and fixing agent misbehavior quickly |

### Forces Analysis

| Force | Description |
|-------|-------------|
| **Push** | Agent misbehavior erodes trust. Currently no way to trace back from bad behavior to the learning causing it without developer intervention |
| **Pull** | Direct path from "agent did something wrong" to "here is the learning causing it" to "fixed." Immediate feedback loop |
| **Anxiety** | "What if I deactivate the wrong learning and make things worse?" / "What if editing a learning has unintended side effects on other agents?" |
| **Habit** | Currently, users either live with bad behavior or ask a developer to query the database. Some recreate learnings from scratch |

### Assessment

- Switch likelihood: **High** -- correction is urgent and currently impossible via UI
- Key blocker: Anxiety about unintended consequences -- need clear scope indicators
- Key enabler: Edit-in-place and deactivate (not delete) reduce fear
- Design implication: Show target_agents clearly before any action. Confirmation for deactivation. Edit preserves audit trail.

### Outcome Statements

| # | Outcome Statement | Imp. | Sat. | Score | Priority |
|---|-------------------|------|------|-------|----------|
| 5 | Minimize the time to identify which learning is causing undesired agent behavior | 92% | 5% | 17.9 | Extremely Underserved |
| 6 | Minimize the likelihood of accidentally affecting agents not related to the problem | 88% | 10% | 16.6 | Extremely Underserved |
| 7 | Minimize the time to correct a learning once identified | 85% | 5% | 16.0 | Extremely Underserved |
| 8 | Minimize the likelihood of losing audit history when editing a learning | 70% | 30% | 11.0 | Appropriately Served |

### Data Quality Notes

- Source: team estimates
- Confidence: Medium

---

## Job 3: Scoping & Targeting

### Job Story

**When** I create or edit a learning that should only apply to certain agent types,
**I want to** control exactly which agents receive this learning,
**so I can** avoid accidentally constraining agents that do not need this rule and keep agent-specific behaviors isolated.

### Three Dimensions

| Dimension | Description |
|-----------|-------------|
| **Functional** | Set target_agents during creation and editing -- choose from known agent types or apply to all |
| **Emotional** | Feel precise and deliberate -- "I know exactly who this rule affects" |
| **Social** | Be recognized as someone who governs agents with appropriate granularity, not blunt instruments |

### Forces Analysis

| Force | Description |
|-------|-------------|
| **Push** | A learning applied to all agents when it should only apply to one wastes context tokens and may cause unintended behavior in unrelated agents |
| **Pull** | Clear multi-select of agent types with immediate visual confirmation of scope |
| **Anxiety** | "What if I forget to scope a learning and it affects agents I did not intend?" / "What if I scope too narrowly and miss an agent that needs the rule?" |
| **Habit** | Users tend to leave target_agents empty (applying to all) because the API default is broad. Path of least resistance is "apply everywhere" |

### Assessment

- Switch likelihood: **Medium** -- push is moderate (most users start with few agents)
- Key blocker: Habit of defaulting to "all agents" -- need to make targeting visible and easy
- Key enabler: Show agent type chips clearly during creation
- Design implication: Default to "all agents" but make it visually distinct so users make a conscious choice

### Outcome Statements

| # | Outcome Statement | Imp. | Sat. | Score | Priority |
|---|-------------------|------|------|-------|----------|
| 9 | Minimize the likelihood of a learning affecting unintended agent types | 82% | 15% | 14.9 | Underserved |
| 10 | Minimize the time to understand which agents a learning currently applies to | 78% | 10% | 14.6 | Underserved |
| 11 | Minimize the number of steps to change a learning's agent targeting | 65% | 10% | 12.0 | Appropriately Served |

### Data Quality Notes

- Source: team estimates
- Confidence: Medium

---

## Job 4: Approval & Triage

### Job Story

**When** agents suggest learnings from patterns they detect during work sessions,
**I want to** review each suggestion with its evidence and quickly approve, edit-and-approve, or dismiss it with a reason,
**so I can** maintain governance over what agents learn without becoming a bottleneck.

### Three Dimensions

| Dimension | Description |
|-----------|-------------|
| **Functional** | See pending learnings with source agent and confidence score, approve/edit/dismiss each one efficiently |
| **Emotional** | Feel efficient and empowered as a governor -- "I am curating, not drowning" |
| **Social** | Be seen as someone who actively governs agent learning, not someone who rubber-stamps or ignores suggestions |

### Forces Analysis

| Force | Description |
|-------|-------------|
| **Push** | Agent suggestions accumulate without review. Rate limiting (5 per week) helps but pending items still pile up. Users have no way to triage without API calls |
| **Pull** | Triage queue with one-click approve/dismiss, optional edit before approve, batch-friendly workflow. Pending count visible from sidebar |
| **Anxiety** | "What if I approve a learning that contradicts an existing one?" (collision detection exists but user needs to see it). "What if I dismiss something valuable?" |
| **Habit** | Users currently ignore agent suggestions entirely or handle them in chat. The feedback loop is broken |

### Assessment

- Switch likelihood: **High** -- pending learnings are invisible without UI, creating governance debt
- Key blocker: Anxiety about approving contradictions -- surface collision detection results
- Key enabler: Approve-with-edit flow and visible collision warnings
- Design implication: Triage queue as primary entry point. Show collisions inline. Dismiss requires reason (existing API supports this).

### Outcome Statements

| # | Outcome Statement | Imp. | Sat. | Score | Priority |
|---|-------------------|------|------|-------|----------|
| 12 | Minimize the time to process a pending learning suggestion | 90% | 5% | 17.5 | Extremely Underserved |
| 13 | Minimize the likelihood of approving a learning that contradicts an existing one | 88% | 40% | 13.6 | Underserved |
| 14 | Minimize the likelihood of valuable suggestions going unreviewed | 85% | 5% | 16.0 | Extremely Underserved |
| 15 | Minimize the number of interactions needed to dismiss a low-value suggestion | 72% | 10% | 13.4 | Underserved |

### Data Quality Notes

- Source: team estimates. Collision detection partially addresses #13 (satisfaction higher).
- Confidence: Medium

---

## Opportunity Scoring Summary

| Rank | # | Outcome Statement | Score | Job |
|------|---|-------------------|-------|-----|
| 1 | 1 | Minimize time to determine active rules for a specific agent | 18.0 | Visibility |
| 2 | 5 | Minimize time to identify which learning causes bad behavior | 17.9 | Correction |
| 3 | 12 | Minimize time to process a pending learning suggestion | 17.5 | Triage |
| 4 | 2 | Minimize likelihood of not knowing a learning exists | 17.0 | Visibility |
| 5 | 6 | Minimize likelihood of accidentally affecting unrelated agents | 16.6 | Correction |
| 6 | 3 | Minimize time to find a specific learning | 16.0 | Visibility |
| 7 | 7 | Minimize time to correct a learning once identified | 16.0 | Correction |
| 8 | 14 | Minimize likelihood of suggestions going unreviewed | 16.0 | Triage |
| 9 | 9 | Minimize likelihood of affecting unintended agents | 14.9 | Scoping |
| 10 | 10 | Minimize time to understand agent targeting | 14.6 | Scoping |
| 11 | 4 | Minimize steps to understand full governance picture | 14.0 | Visibility |
| 12 | 13 | Minimize likelihood of approving contradictory learning | 13.6 | Triage |
| 13 | 15 | Minimize interactions to dismiss low-value suggestion | 13.4 | Triage |
| 14 | 11 | Minimize steps to change agent targeting | 12.0 | Scoping |
| 15 | 8 | Minimize likelihood of losing audit history | 11.0 | Correction |

### Top Opportunities (Score >= 15)

All four jobs have extremely underserved outcomes. Priority order for story crafting:

1. **Visibility** -- highest-scoring outcome and most foundational (Job 1)
2. **Correction** -- second-highest score, urgent when needed (Job 2)
3. **Triage** -- third-highest, recurring governance workflow (Job 4)
4. **Scoping** -- scores high but less urgent, can layer onto creation/editing flows (Job 3)

### Overserved Areas (Score < 10)

None identified. The entire learning governance surface is greenfield in the UI.

---

## Job-to-Story Mapping (Preview)

| Job | Stories (crafted in Phase 3) |
|-----|----------------------------|
| Job 1: Visibility | US-LL-01: Browse & Filter Learning Library |
| Job 2: Correction | US-LL-03: Edit or Deactivate Active Learning |
| Job 3: Scoping | US-LL-04: Create Learning with Agent Targeting |
| Job 4: Triage | US-LL-02: Review & Approve/Dismiss Pending Learning |
| Jobs 1+4 | US-LL-05: Pending Learnings Badge & Entry Point |
