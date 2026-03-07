# JTBD Analysis: Coding Session Feature

## Job Classification

**Job Type**: Brownfield (Job 2) -- significant orchestrator infrastructure exists, interactive session experience is the missing capability.

**Workflow**: `[research] -> discuss -> design -> distill` (Discovery needed because the interactive UX is greenfield even though the backend is brownfield)

---

## Persona: Marcus Oliveira

**Who**: Solo technical founder building an AI-native business management platform. Delegates coding tasks to AI agents so he can focus on architecture and product decisions.

**Demographics**:
- Technical proficiency: Expert (writes the platform himself)
- Interaction frequency: Multiple times daily -- assigns 3-5 tasks per session
- Environment: Web-based Brain UI alongside terminal/IDE
- Primary motivation: Multiply his output by delegating routine coding to AI agents while retaining quality control

---

## Job 1: Delegate Coding Work with Confidence

### Job Story

**When** I have a well-defined task that I know an AI agent can handle,
**I want to** assign it and trust that the agent understands what to build,
**so I can** shift my attention to other work without worrying that the agent is going in the wrong direction.

### Three Dimensions

| Dimension | Description |
|-----------|-------------|
| **Functional** | Assign a task to an AI coding agent with enough context that it produces correct, mergeable code |
| **Emotional** | Feel confident that delegation is safe -- the agent has what it needs and I can let go |
| **Social** | Be seen (by future team) as someone who builds effective human-AI workflows, not a bottleneck |

### Forces Analysis

| Force | Description |
|-------|-------------|
| **Push** | Marcus currently assigns tasks but cannot see what the agent is doing. He must poll status and wait for idle, then review a diff with no context of how the agent got there. The "black box" feeling undermines trust. |
| **Pull** | A live session view showing the agent's thinking and progress in real-time. Like pair programming where you can watch your partner code. |
| **Anxiety** | "What if the agent burns 20 minutes going down the wrong path and I only find out at review time?" Wasted compute and wasted time. |
| **Habit** | Currently reviews diffs after the fact. Familiar with PR review workflow. Checking status by refreshing the page. |

### Assessment
- Switch likelihood: **High** -- Marcus already uses the orchestrator; this fills a painful gap
- Key blocker: Anxiety about invisible agent work
- Key enabler: Push from blind delegation frustration
- Design implication: Live output streaming must feel immediate and trustworthy. The user must see the agent working within seconds of assignment.

### Outcome Statements

| # | Outcome Statement | Imp. | Sat. | Score | Priority |
|---|-------------------|------|------|-------|----------|
| 1 | Minimize the time between assigning a task and seeing the agent begin work | 95% | 20% | 16.5 | Extremely Underserved |
| 2 | Minimize the likelihood of the agent working on the wrong approach undetected | 90% | 15% | 16.5 | Extremely Underserved |
| 3 | Minimize the time to understand what the agent has done so far | 85% | 25% | 14.5 | Extremely Underserved |

---

## Job 2: Course-Correct a Working Agent

### Job Story

**When** I notice the agent is heading in the wrong direction or missing important context,
**I want to** send it guidance without disrupting its flow,
**so I can** steer it toward the right solution without starting over.

### Three Dimensions

| Dimension | Description |
|-----------|-------------|
| **Functional** | Send a follow-up prompt to a running agent session that adjusts its approach mid-task |
| **Emotional** | Feel in control -- like a senior developer guiding a junior, not helplessly watching a mistake unfold |
| **Social** | Demonstrate effective AI supervision -- knowing when and how to intervene |

### Forces Analysis

| Force | Description |
|-------|-------------|
| **Push** | Today, the only intervention is abort. If the agent takes a wrong turn, Marcus must abort, lose all progress, and re-assign. There's no middle ground between "let it run" and "kill it." |
| **Pull** | A prompt input that lets Marcus say "use the existing utility function in helpers.ts instead of writing a new one" and have the agent adjust course. |
| **Anxiety** | "Will my follow-up prompt confuse the agent? Will it lose context of what it was doing?" |
| **Habit** | Accustomed to PR review comments -- feedback after the work is done, not during. Shifting to real-time guidance is a new pattern. |

### Assessment
- Switch likelihood: **High** -- the abort-only alternative is clearly wasteful
- Key blocker: Anxiety about prompt disruption
- Key enabler: Push from abort-as-only-option frustration
- Design implication: Follow-up prompt must feel lightweight and non-destructive. Clear feedback that the agent received and is incorporating the guidance.

### Outcome Statements

| # | Outcome Statement | Imp. | Sat. | Score | Priority |
|---|-------------------|------|------|-------|----------|
| 4 | Minimize the time to course-correct an agent that is heading in the wrong direction | 92% | 5% | 17.9 | Extremely Underserved |
| 5 | Minimize the likelihood of losing all progress when intervention is needed | 88% | 10% | 16.6 | Extremely Underserved |
| 6 | Minimize the anxiety about whether a follow-up prompt will disrupt agent flow | 80% | 5% | 15.5 | Extremely Underserved |

---

## Job 3: Review and Accept Agent Work with Full Context

### Job Story

**When** the agent has finished working and I need to decide whether to accept its changes,
**I want to** review the diff alongside the agent's reasoning and the conversation that led to the final result,
**so I can** make a confident accept/reject decision without re-reading all the code from scratch.

### Three Dimensions

| Dimension | Description |
|-----------|-------------|
| **Functional** | Review a diff with full context of why each change was made, what the agent tried, and what guidance was given |
| **Emotional** | Feel confident in the accept decision -- not rubber-stamping, genuinely understanding |
| **Social** | Maintain code quality standards even when AI wrote the code |

### Forces Analysis

| Force | Description |
|-------|-------------|
| **Push** | Current review shows only a raw diff with no context. Marcus must mentally reconstruct why changes were made. For complex tasks, this is nearly as much work as doing the task himself. |
| **Pull** | A review view that shows the agent's output stream alongside the diff -- the reasoning trail that explains each change. |
| **Anxiety** | "What if I accept changes I don't fully understand because the diff looks reasonable but has subtle bugs?" |
| **Habit** | Familiar with GitHub PR review -- diff view with inline comments. The existing review page already follows this pattern. |

### Assessment
- Switch likelihood: **Medium-High** -- existing review works but is incomplete
- Key blocker: Anxiety about subtle bugs in AI-generated code
- Key enabler: Push from context-free diff review
- Design implication: Review must surface the conversation/reasoning trail alongside the diff. Reject flow should allow specific feedback that the agent can act on.

### Outcome Statements

| # | Outcome Statement | Imp. | Sat. | Score | Priority |
|---|-------------------|------|------|-------|----------|
| 7 | Minimize the time to understand why the agent made each change | 88% | 30% | 14.6 | Extremely Underserved |
| 8 | Minimize the likelihood of accepting changes with undetected issues | 85% | 40% | 12.5 | Underserved |
| 9 | Minimize the number of review-reject cycles needed to reach an acceptable result | 82% | 35% | 12.9 | Underserved |

---

## Opportunity Scoring Summary (Ranked)

| Rank | # | Outcome Statement | Score | Job |
|------|---|-------------------|-------|-----|
| 1 | 4 | Minimize time to course-correct an agent heading wrong | 17.9 | J2 |
| 2 | 1 | Minimize time between assigning and seeing agent begin | 16.5 | J1 |
| 3 | 2 | Minimize likelihood of agent working on wrong approach undetected | 16.5 | J1 |
| 4 | 5 | Minimize likelihood of losing all progress when intervention needed | 16.6 | J2 |
| 5 | 6 | Minimize anxiety about follow-up prompt disrupting agent flow | 15.5 | J2 |
| 6 | 3 | Minimize time to understand what agent has done so far | 14.5 | J1 |
| 7 | 7 | Minimize time to understand why agent made each change | 14.6 | J3 |
| 8 | 9 | Minimize review-reject cycles to reach acceptable result | 12.9 | J3 |
| 9 | 8 | Minimize likelihood of accepting changes with undetected issues | 12.5 | J3 |

**Top 3 investments**: Live output streaming (J1), Follow-up prompts (J2), Contextual review (J3)

All three jobs are extremely underserved. The infrastructure exists but the interactive experience does not.

---

## 8-Step Job Map: Delegate and Supervise AI Coding Work

| Step | Activity | Pain Points | Outcome |
|------|----------|-------------|---------|
| 1. **Define** | Identify which task to assign; verify it has enough context | Task description may be too vague for an agent | Minimize likelihood of assigning under-specified tasks |
| 2. **Locate** | Find the task in the entity detail view; confirm repo path is set | Must navigate to task detail, check workspace config | Minimize steps to reach the assign action |
| 3. **Prepare** | Click "Assign Agent"; system creates worktree and spawns OpenCode | Spawning takes seconds; no progress feedback during spawn | Minimize uncertainty during spawn wait |
| 4. **Confirm** | See that the agent has started and is working on the right thing | Today: status badge changes to "Working" but no output visible | Minimize time to confirm agent understood the task |
| 5. **Execute** | Agent works; user monitors or shifts to other work | Today: black box -- no live output, must poll status | Minimize time unaware of agent's current approach |
| 6. **Monitor** | Watch agent progress; check for stalls or wrong direction | Today: only stall detection exists, no live monitoring | Minimize likelihood of undetected wrong direction |
| 7. **Modify** | Send follow-up prompt to course-correct | Today: impossible -- abort is the only intervention | Minimize progress lost during course correction |
| 8. **Conclude** | Review diff, accept or reject, provide feedback | Today: diff-only review without reasoning context | Minimize review effort to reach confident decision |

Steps 4-7 (Confirm through Modify) are where the critical gaps live. Steps 1-3 and 8 have partial implementations.

---

## Data Sources

- Source: Direct codebase analysis and `temp_discuss.md` conversation transcript
- Confidence: Medium (team estimates based on codebase evidence, not user interviews)
- Sample: Single-persona (solo founder); scores are relative rankings, not absolute
