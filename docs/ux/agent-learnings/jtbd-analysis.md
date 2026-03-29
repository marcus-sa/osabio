# JTBD Analysis: Agent Learnings

## Feature Overview

Agent Learnings is the "Synaptic Plasticity" of Osabio -- persistent behavioral modifications that convert short-term agent failures into long-term wisdom. Two sources: human-created (immediately active) and agent-suggested (pending human approval). Injected into agent system prompts at runtime (JIT prompting).

---

## Job 1: Persistent Agent Correction

### Job Story

**When** I have corrected the same agent mistake for the third time in a week,
**I want to** record a permanent behavioral rule that the agent must follow,
**so I can** stop wasting time repeating corrections that the agent forgets between sessions.

### Job Dimensions

| Dimension | Description |
|-----------|-------------|
| **Functional** | Persist a behavioral correction so the agent applies it in all future sessions without being re-told |
| **Emotional** | Feel heard and in control -- "the system actually learns from me" instead of "talking to a wall" |
| **Social** | Be seen as someone whose corrections matter -- the team benefits from one person's correction |

### Four Forces Analysis

| Force | Description |
|-------|-------------|
| **Push** | Repeating "don't use null, use undefined" every session. Agent apologizes, then does it again next session. Frustration compounds -- "I've told you this five times." |
| **Pull** | One correction, applied forever. Say it once, never repeat it. Agent becomes smarter over time. |
| **Anxiety** | "What if my correction was wrong and now it's baked in permanently?" -- fear of irreversible bad rules. "What if I create so many rules they conflict?" |
| **Habit** | Copy-pasting correction text into CLAUDE.md files. Manually maintaining agent instructions. "At least I know what's in the prompt." |

### Assessment
- Switch likelihood: **High** -- push is extremely strong (daily frustration)
- Key blocker: Anxiety about permanence and conflict
- Key enabler: Push of repeated corrections
- Design implication: Make learnings editable, deactivatable, and conflict-visible. Show what is active so users feel in control.

---

## Job 2: Agent Self-Improvement

### Job Story

**When** an agent notices it has been corrected on the same pattern three times or detects a recurring failure mode,
**I want to** suggest a behavioral learning for itself or another agent,
**so I can** prevent future failures without requiring human intervention for every correction.

### Job Dimensions

| Dimension | Description |
|-----------|-------------|
| **Functional** | Detect patterns in agent behavior and propose persistent corrections that prevent recurrence |
| **Emotional** | (Agent perspective) Operate with increasing competence; (Human perspective) Feel that agents are getting smarter autonomously |
| **Social** | Demonstrate that the system self-improves -- stakeholders see an organization that learns, not just executes |

### Four Forces Analysis

| Force | Description |
|-------|-------------|
| **Push** | Agents repeat the same mistakes. Observer detects the pattern but has no mechanism to fix it permanently. Coding agent violates conventions that are documented but not in its prompt. |
| **Pull** | Cross-agent coaching: Observer notices PM agent's weakness and suggests a learning. System develops institutional memory. |
| **Anxiety** | "What if the agent suggests bad rules that make things worse?" -- fear of autonomous degradation. "What if agents flood me with low-quality suggestions?" |
| **Habit** | Manually updating agent prompts after noticing patterns. Relying on static CLAUDE.md files that grow without curation. |

### Assessment
- Switch likelihood: **Medium-High** -- strong pull, but anxiety about autonomous rule creation is real
- Key blocker: Anxiety about quality and volume of agent-suggested learnings
- Key enabler: Pull of a self-improving system
- Design implication: Agent suggestions always require human approval. Surface with evidence (what triggered the suggestion). Rate-limit suggestions per agent.

---

## Job 3: Runtime Learning Consumption

### Job Story

**When** an agent starts a new session in a workspace that has accumulated behavioral learnings,
**I want to** have the right learnings injected into my system prompt without bloating it,
**so I can** operate with the accumulated wisdom of the workspace while keeping my context window efficient.

### Job Dimensions

| Dimension | Description |
|-----------|-------------|
| **Functional** | Select and inject relevant learnings into agent prompts at session start without exceeding token budgets |
| **Emotional** | (Agent perspective) Competence from first interaction; (Human perspective) Confidence that agents remember past corrections |
| **Social** | Team members see consistent agent behavior across sessions -- "the agent remembers what we taught it" |

### Four Forces Analysis

| Force | Description |
|-------|-------------|
| **Push** | Agent prompts are static -- same base prompt regardless of workspace history. Corrections from last week are forgotten. New sessions start from zero. |
| **Pull** | JIT prompting: only relevant learnings injected, keeping prompts lean. Agent immediately applies accumulated wisdom. Context-aware selection. |
| **Anxiety** | "What if too many learnings bloat the prompt and degrade performance?" -- token budget concerns. "What if conflicting learnings confuse the agent?" |
| **Habit** | Hardcoded rules in base system prompts. Static CLAUDE.md files. Manual prompt engineering. |

### Assessment
- Switch likelihood: **High** -- technical improvement with clear benefits
- Key blocker: Anxiety about prompt bloat and conflict
- Key enabler: JIT selection keeping prompts lean
- Design implication: Token budget for learnings section. Priority ordering (human > agent). Conflict detection before injection. Show which learnings are active in session context.

---

## Job 4: Learning Governance and Curation

### Job Story

**When** my workspace has accumulated 30+ learnings over several months and some may be outdated or conflicting,
**I want to** review, curate, and resolve conflicts in the learning library,
**so I can** maintain a healthy set of behavioral rules that improve agent performance rather than degrading it through accumulation.

### Job Dimensions

| Dimension | Description |
|-----------|-------------|
| **Functional** | View all learnings, detect conflicts, supersede outdated ones, and verify that the active set is coherent |
| **Emotional** | Feel in control of the system's accumulated knowledge -- "I understand what the agents know" rather than "who knows what rules are in there" |
| **Social** | Be a responsible steward of organizational knowledge -- demonstrate governance to stakeholders |

### Four Forces Analysis

| Force | Description |
|-------|-------------|
| **Push** | Learning library grows without curation. Contradictory rules accumulate. Agent behavior becomes unpredictable. Nobody knows what rules are active. |
| **Pull** | Clean, curated library with conflict detection. Visual overview of what agents know. Supersession chain showing evolution. |
| **Anxiety** | "If I deactivate a learning, will something break?" -- fear of removing useful rules. "I don't remember why this learning was created." |
| **Habit** | Ignoring accumulated rules. Adding new rules without reviewing old ones. "It works, don't touch it." |

### Assessment
- Switch likelihood: **Medium** -- need emerges over time, not immediately
- Key blocker: Anxiety about deactivating learnings + habit of ignoring accumulation
- Key enabler: Conflict detection making curation necessary
- Design implication: Show learning provenance (who created it, when, why). Conflict detection surfaces problems proactively. Deactivation is soft (can reactivate). Supersession preserves history.

---

## Opportunity Scoring

| # | Outcome Statement | Imp. (%) | Sat. (%) | Score | Priority |
|---|-------------------|----------|----------|-------|----------|
| 1 | Minimize the number of times a human must repeat the same correction to an agent | 95 | 10 | 18.0 | Extremely Underserved |
| 2 | Minimize the likelihood of an agent repeating a previously corrected mistake | 92 | 12 | 17.2 | Extremely Underserved |
| 3 | Minimize the time for an agent to apply workspace-specific behavioral rules at session start | 85 | 20 | 14.5 | Extremely Underserved |
| 4 | Minimize the likelihood of conflicting learnings degrading agent performance | 80 | 15 | 14.5 | Extremely Underserved |
| 5 | Minimize the time to review and approve agent-suggested learnings | 75 | 10 | 14.0 | Underserved |
| 6 | Minimize the likelihood of prompt bloat from accumulated learnings | 78 | 25 | 13.1 | Underserved |
| 7 | Minimize the time to identify and resolve conflicting learnings | 70 | 15 | 12.5 | Underserved |
| 8 | Maximize the likelihood that agent-suggested learnings are high quality | 72 | 18 | 12.6 | Underserved |
| 9 | Minimize the time to understand why a learning was created (provenance) | 65 | 20 | 11.0 | Appropriately Served |
| 10 | Minimize the effort to curate the learning library over time | 60 | 25 | 9.5 | Overserved |

### Scoring Method
- Importance: estimated % rating 4+ on 5-point scale (team estimate based on feature description and user pain analysis)
- Satisfaction: estimated % rating 4+ with current workarounds
- Score: Importance + max(0, Importance - Satisfaction)
- Data quality: team estimate, not user survey. Confidence: Medium.

### Top Opportunities (Score >= 12)
1. Persistent correction (18.0) -- core feature, highest priority
2. Mistake non-recurrence (17.2) -- directly tied to #1
3. Runtime injection (14.5) -- enables correction persistence
4. Conflict prevention (14.5) -- safety net for accumulated learnings
5. Approval efficiency (14.0) -- governance flow
6. Prompt bloat prevention (13.1) -- technical enabler
7. Quality of agent suggestions (12.6) -- trust building
8. Conflict resolution (12.5) -- curation support

---

## JTBD-to-Story Bridge

| Job Story | Maps to Stories | Priority |
|-----------|----------------|----------|
| Job 1: Persistent Agent Correction | US-AL-001 (Human Creates Learning), US-AL-005 (Learning Schema) | Must Have |
| Job 2: Agent Self-Improvement | US-AL-002 (Agent Suggests Learning), US-AL-006 (Cross-Agent Coaching) | Should Have |
| Job 3: Runtime Learning Consumption | US-AL-003 (JIT Prompt Injection), US-AL-007 (Token Budget) | Must Have |
| Job 4: Learning Governance | US-AL-004 (Governance Feed Cards), US-AL-008 (Conflict Detection) | Should Have |

### Personas

| Persona | Primary Jobs | Context |
|---------|-------------|---------|
| **Tomas Eriksson** (Workspace Owner) | Job 1, Job 4 | Technical lead managing a 3-person team. Uses Osabio daily. Has corrected coding agent conventions 12 times this month. Wants agents to remember. |
| **Chat Agent** (System Actor) | Job 3 | Loads workspace context at session start. Needs learnings in system prompt. Token budget matters. |
| **Observer Agent** (System Actor) | Job 2 | Scans graph for patterns. Detects repeated corrections. Suggests learnings for other agents. |
| **PM Agent** (System Actor) | Job 2, Job 3 | Manages project work. May notice workflow anti-patterns. Consumes learnings about project management conventions. |
| **Coding Agent (MCP)** (System Actor) | Job 3 | Connected via MCP protocol. Receives learnings in context packets. Most correction-heavy agent. |
