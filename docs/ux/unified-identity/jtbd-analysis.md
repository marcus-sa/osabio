# JTBD Analysis: Unified Identity Node

## Job Landscape

Four distinct jobs emerged from discovery, spanning three persona types (workspace owner, in-system agent, platform developer). Each job has functional, emotional, and social dimensions.

---

## Job 1: Unified Audit Trail

### Job Story

**When** I am reviewing a sequence of actions taken on my workspace (tasks created, decisions confirmed, observations logged),
**I want to** see exactly which actor performed each action and who is accountable for it,
**so I can** evaluate the quality of my human-agent collaboration and answer "why did this happen?" in seconds, not minutes.

### Three Dimensions

| Dimension | Description |
|-----------|-------------|
| **Functional** | Query "who touched this?" across humans and agents, get a complete chronological answer from a single table |
| **Emotional** | Feel confident that the system's history is trustworthy and complete -- no ghost actions, no unattributed changes |
| **Social** | Demonstrate to stakeholders that AI-assisted work has clear accountability chains -- humans are never absolved of responsibility |

### Forces Analysis

| Force | Description |
|-------|-------------|
| **Push** | Today, agent actions either show `decided_by: NONE` or get falsely attributed to the human who triggered them. Marcus cannot answer "show me all suggestions made by agents that were actually implemented" -- the first query he wants to run |
| **Pull** | Dual-label audit trail ("Task created by **PM Agent** (Managed by **Marcus**)") gives both immediate actor and accountability chain in one view |
| **Anxiety** | Will the migration break existing audit data? Will queries become slower with the extra hub table hop? |
| **Habit** | Current code uses `record<person>` everywhere for ownership. Every query, every type, every edge assumes person = identity |

### Assessment

- Switch likelihood: **High** (push is strong -- current state is genuinely broken for agent attribution)
- Key blocker: Habit -- massive surface area of `record<person>` references to migrate
- Key enabler: Push -- cannot answer the ROI question without this
- Design implication: Migration must be comprehensive but can be breaking (project convention: no backwards compat)

### Outcome Statements

| # | Outcome Statement | Imp. | Sat. | Score | Priority |
|---|-------------------|------|------|-------|----------|
| 1.1 | Minimize the time to determine which actor (human or agent) performed a specific action | 95% | 15% | 17.6 | Extremely Underserved |
| 1.2 | Minimize the likelihood of an action being unattributed or misattributed | 90% | 20% | 16.2 | Extremely Underserved |
| 1.3 | Minimize the time to trace from an agent action to the accountable human | 85% | 10% | 14.9 | Extremely Underserved |
| 1.4 | Maximize the likelihood that audit queries return complete results (no gaps) | 88% | 25% | 14.9 | Extremely Underserved |

**Scoring method**: Team estimate (N=1 workspace owner). Treat as directional ranking.

---

## Job 2: Scoped Agent Authorization

### Job Story

**When** I am configuring how much autonomy different agents have in my workspace,
**I want to** assign role-based default permissions with per-identity overrides,
**so I can** give a trusted "Lead Coder" agent elevated access without changing the baseline for all code agents.

### Three Dimensions

| Dimension | Description |
|-----------|-------------|
| **Functional** | Assign roles to agent identities, check authorization via role lookup with override edges, scope permissions per workspace |
| **Emotional** | Feel in control of agent autonomy -- confident that no agent can exceed its intended authority |
| **Social** | Be seen as running a disciplined operation where AI agents have appropriate guardrails |

### Forces Analysis

| Force | Description |
|-------|-------------|
| **Push** | Current `authority_scope` uses string enums (`agent_type: "code_agent"`). Cannot differentiate between two code agents -- they all get identical permissions. No way to promote a specific agent instance |
| **Pull** | Role-based defaults (`type: 'coder'` gets base permissions) with per-identity override edges (`identity:lead-coder-ws1` gets `confirm_decision` elevated to `auto`) |
| **Anxiety** | What if the override system creates a permission maze that's hard to audit? What if an override accidentally grants too much? |
| **Habit** | Current string-enum approach is simple and predictable. Everyone of the same type gets the same treatment. Easy to reason about |

### Assessment

- Switch likelihood: **Medium-High** (push exists but habit is comfortable)
- Key blocker: Anxiety -- override complexity must be auditable
- Key enabler: Push -- need to differentiate agent instances
- Design implication: Role-based defaults must remain the primary path; overrides are the exception, not the rule

### Outcome Statements

| # | Outcome Statement | Imp. | Sat. | Score | Priority |
|---|-------------------|------|------|-------|----------|
| 2.1 | Minimize the likelihood of an agent exceeding its intended authority | 95% | 60% | 13.0 | Underserved |
| 2.2 | Minimize the time to grant a specific agent elevated permissions | 75% | 10% | 12.0 | Underserved |
| 2.3 | Minimize the likelihood of permission configuration errors going undetected | 80% | 40% | 11.2 | Appropriately Served |
| 2.4 | Maximize the likelihood that permission state is auditable at any point | 85% | 30% | 13.4 | Underserved |

---

## Job 3: Agent Lifecycle Management

### Job Story

**When** I am running multiple agent sessions across projects in my workspace,
**I want to** have persistent agent identities that survive across sessions with session-scoped instances for isolation,
**so I can** track agent performance history, kill compromised sessions without invalidating the master identity, and see which agent has been most productive.

### Three Dimensions

| Dimension | Description |
|-----------|-------------|
| **Functional** | Create persistent "template" agent identities per workspace, spawn scoped session instances that inherit permissions, terminate sessions independently |
| **Emotional** | Feel that agents are reliable employees with trackable histories, not anonymous ephemeral processes |
| **Social** | Demonstrate that the AI workforce is managed professionally -- each agent has a track record |

### Forces Analysis

| Force | Description |
|-------|-------------|
| **Push** | `agent_session` records are ephemeral and disconnected. There is no way to ask "how has the PM agent performed over the last month?" because each session is an island with a bare string identifier |
| **Pull** | Template + scoped instances: `identity:pm-agent-ws123` accumulates history; `identity:pm-session-789` provides session isolation. Compromise one session, kill it, master identity persists |
| **Anxiety** | Will the two-tier identity model (template + session) create confusing ownership chains? When a session identity creates a task, does the template identity also "own" it? |
| **Habit** | Current `agent_session` table is simple: start session, do work, end session. No identity management needed |

### Assessment

- Switch likelihood: **Medium** (pull is attractive but anxiety about complexity is real)
- Key blocker: Anxiety -- ownership semantics between template and session identities need crisp rules
- Key enabler: Pull -- performance tracking across sessions is genuinely new capability
- Design implication: Start with template identities only (Phase 1). Session-scoped instances are Phase 2 -- do not block the core migration on them

### Outcome Statements

| # | Outcome Statement | Imp. | Sat. | Score | Priority |
|---|-------------------|------|------|-------|----------|
| 3.1 | Minimize the time to assess an agent's historical performance across sessions | 80% | 5% | 14.8 | Extremely Underserved |
| 3.2 | Minimize the likelihood of a compromised session affecting the master identity | 70% | 50% | 9.4 | Overserved |
| 3.3 | Minimize the time to bootstrap a new agent identity in a workspace | 65% | 30% | 9.0 | Overserved |

---

## Job 4: Full-Provenance Extraction

### Job Story

**When** a conversation mentions an agent by role or name (e.g., "the PM agent suggested we should prioritize auth"),
**I want to** have the extraction pipeline resolve that mention to the agent's identity record,
**so I can** query the full provenance graph -- "show me all suggestions made by agents that were actually implemented" -- with real identity nodes, not dangling string references.

### Three Dimensions

| Dimension | Description |
|-----------|-------------|
| **Functional** | Extraction pipeline resolves agent mentions to `identity` records, creates proper graph edges for agent-attributed actions |
| **Emotional** | Feel that the knowledge graph is complete and honest -- every actor in every statement has a real node |
| **Social** | The knowledge graph tells the true story of who contributed what, giving appropriate credit to both humans and agents |

### Forces Analysis

| Force | Description |
|-------|-------------|
| **Push** | `extraction/person.ts` only resolves human names to `person` records. Agent mentions become unlinked text. The graph has blind spots |
| **Pull** | Unified identity resolution: "the PM agent" resolves to `identity:pm-agent-ws123` the same way "Marcus" resolves to `identity:marcus-human-ws123`. Graph queries work uniformly |
| **Anxiety** | Will the extraction model (Haiku) reliably distinguish agent mentions from generic role references? "The agent" vs "an agent" -- false positive risk |
| **Habit** | Current pipeline ignores agent mentions entirely. Adding agent resolution increases extraction complexity and potential for noise |

### Assessment

- Switch likelihood: **Medium** (depends on Job 1 being complete first)
- Key blocker: Anxiety -- extraction accuracy for agent mentions needs validation
- Key enabler: Push -- graph completeness is a core value proposition
- Design implication: This is a downstream job. Depends on Job 1 (identity table exists) and Job 3 (agent identities registered). Should be a separate story from the core migration

### Outcome Statements

| # | Outcome Statement | Imp. | Sat. | Score | Priority |
|---|-------------------|------|------|-------|----------|
| 4.1 | Minimize the likelihood of an agent mention going unresolved in the graph | 70% | 5% | 12.6 | Underserved |
| 4.2 | Minimize the likelihood of false-positive agent identity resolution | 75% | 50% | 10.0 | Appropriately Served |

---

## Opportunity Scoring Summary (All Jobs)

| Rank | Outcome | Score | Job | Priority |
|------|---------|-------|-----|----------|
| 1 | Minimize time to determine which actor performed an action | 17.6 | J1 | Extremely Underserved |
| 2 | Minimize likelihood of unattributed/misattributed actions | 16.2 | J1 | Extremely Underserved |
| 3 | Minimize time to trace agent action to accountable human | 14.9 | J1 | Extremely Underserved |
| 4 | Maximize likelihood audit queries return complete results | 14.9 | J1 | Extremely Underserved |
| 5 | Minimize time to assess agent historical performance | 14.8 | J3 | Extremely Underserved |
| 6 | Maximize likelihood permission state is auditable | 13.4 | J2 | Underserved |
| 7 | Minimize likelihood of agent exceeding authority | 13.0 | J2 | Underserved |
| 8 | Minimize likelihood of unresolved agent mention in graph | 12.6 | J4 | Underserved |
| 9 | Minimize time to grant elevated permissions | 12.0 | J2 | Underserved |
| 10 | Minimize likelihood of permission config errors | 11.2 | J2 | Appropriately Served |
| 11 | Minimize likelihood of false-positive agent resolution | 10.0 | J4 | Appropriately Served |
| 12 | Minimize likelihood of compromised session affecting master | 9.4 | J3 | Overserved |
| 13 | Minimize time to bootstrap new agent identity | 9.0 | J3 | Overserved |

**Data quality**: Team estimate (N=1). Directional only. Confidence: Low-Medium.

### Prioritization Result

1. **Job 1 (Unified Audit Trail)** dominates the top 4 slots. This is the foundation -- without it, nothing else works. Must-have.
2. **Job 2 (Scoped Authorization)** is underserved and depends on Job 1. Should-have for initial release.
3. **Job 3 (Agent Lifecycle)** is split: template identities are Must-have (needed for Job 1), session-scoped instances are Could-have (overserved outcomes suggest current session model is adequate for now).
4. **Job 4 (Full-Provenance Extraction)** is underserved but fully dependent on Jobs 1+3. Could-have -- separate follow-up work.

---

## Job Dependency Map

```
Job 1: Unified Audit Trail (MUST)
  |
  +-- Job 3: Agent Lifecycle - Template Identities (MUST, enables J1)
  |     |
  |     +-- Job 3b: Session-Scoped Instances (COULD, deferred)
  |
  +-- Job 2: Scoped Authorization (SHOULD, builds on J1 identity table)
  |
  +-- Job 4: Full-Provenance Extraction (COULD, builds on J1+J3)
```
