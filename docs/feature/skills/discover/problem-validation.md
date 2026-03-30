# Problem Validation: Skills Feature (#177)

## Problem Statement (In User Words)

"My agents can call tools but they don't know *how* to do domain-specific work. I have to re-explain the same expertise every session -- how to do a security audit, how to follow our coding standards, how to run a compliance check. Learnings correct past mistakes but they don't teach proactive expertise."

## The Gap: Tools vs Learnings

| Layer | What it provides | What's missing |
|-------|-----------------|----------------|
| Tools (MCP) | Functional capabilities ("call this API") | No guidance on *when* or *how* to use them together |
| Learnings | Reactive corrections ("don't do X again") | No proactive expertise ("here's how to do Y well") |
| **Skills (proposed)** | Domain expertise documents | **This is the gap** |

## Evidence from Codebase Analysis (Past Behavior)

### Evidence 1: Current agent creation has no expertise assignment

The existing `agent-create-page.tsx` is a 2-step flow: runtime selection, then a flat form (name, description, model, authority scopes). There is no mechanism to assign domain expertise at creation time or post-creation. Every agent starts as a blank slate beyond its authority scopes.

**File**: `/app/src/client/routes/agent-create-page.tsx` (lines 77-101: step 1, lines 105-187: step 2)

### Evidence 2: The learning system proves the pattern works

Osabio already has a complete lifecycle for injecting behavioral guidance into agents (Learnings: proposed > active > deactivated, with collision detection, pattern detection, and JIT loading with token budgets). Skills follow the exact same pattern but for proactive expertise rather than reactive corrections. The infrastructure for governed, versionable agent instructions already exists.

### Evidence 3: Session lifecycle already wires MCP but not skills

`session-lifecycle.ts` registers Brain's MCP server before session creation (`setMcpConfig`) but has no `setSkillsConfig` call. The sandbox adapter interface does not expose skills configuration. This is a concrete gap -- the plumbing exists for tools but not for expertise.

### Evidence 4: Research confirms the integration path

The `skills-sandbox-agent-integration.md` research document (2026-03-28) resolves key technical questions:
- Source reference architecture (Brain stores metadata, sandbox agent resolves files)
- LLM-driven activation (no client-side matching needed)
- Hybrid strategy validated (native skills + MCP tool gating)
- 80k+ community skills ecosystem compatibility via skills.sh

### Evidence 5: The three-layer competency model fills a known architectural gap

Osabio's architecture already distinguishes between Tools (MCP endpoints, functional) and Learnings (reactive corrections). The README documents this split. Skills as "proactive domain expertise" is the missing middle layer -- this maps directly to how human organizations work (tools, training manuals, lessons learned).

## Assumption Tracker

| # | Assumption | Category | Impact (x3) | Uncertainty (x2) | Ease (x1) | Score | Priority |
|---|-----------|----------|-------------|------------------|-----------|-------|----------|
| A1 | Workspace admins want to configure agent expertise during creation, not post-creation | Value | 2 (6) | 2 (4) | 1 (1) | 11 | Test soon |
| A2 | Three discrete wizard steps is the right granularity for agent creation | Usability | 2 (6) | 3 (6) | 1 (1) | 13 | Test first |
| A3 | Skills and tools should be separate wizard steps | Usability | 1 (3) | 2 (4) | 1 (1) | 8 | Test soon |
| A4 | The community skills ecosystem (skills.sh) matters to early adopters | Value | 2 (6) | 2 (4) | 2 (2) | 12 | Test first |
| A5 | LLM-driven activation (no trigger matching) is sufficient for skill selection | Feasibility | 3 (9) | 1 (2) | 2 (2) | 13 | Test first |
| A6 | Implicit tool grants (skill possession grants tool access) are intuitive to admins | Usability | 2 (6) | 2 (4) | 1 (1) | 11 | Test soon |
| A7 | Source-reference architecture (Brain stores pointers, not content) is viable for MVP | Feasibility | 3 (9) | 1 (2) | 1 (1) | 12 | Test first |
| A8 | External agents (non-sandbox) have no meaningful use for skills | Value | 1 (3) | 3 (6) | 1 (1) | 10 | Test soon |
| A9 | A linear wizard flow (cannot skip/jump steps) is acceptable | Usability | 1 (3) | 2 (4) | 1 (1) | 8 | Test soon |
| A10 | Sandbox config (coding_agents, env_vars, image) belongs in step 1, not a separate step | Usability | 1 (3) | 2 (4) | 1 (1) | 8 | Test soon |

## Interview Design (Mom Test)

Since this is an open-source developer tool with the maintainer as the primary user, discovery is grounded in codebase evidence and architectural analysis rather than traditional customer interviews. The "interviews" are with the codebase, the research document, and the maintainer's past behavior (issue creation, research investment, architectural decisions).

### Past Behavior Signals (Equivalent to Interview Data)

| Signal | What it tells us | Confidence |
|--------|-----------------|------------|
| Issue #177 created with detailed schema | Strong problem conviction, thought-through solution | High |
| Research document written (2026-03-28) | Active investment in understanding integration | High |
| Learning system already built and shipped | Proven pattern -- governance + lifecycle + JIT loading | High |
| Agent creation wizard already exists (2-step) | Existing UX foundation to extend | High |
| `possesses` relation in schema design | Agent-skill assignment is a core concept | High |
| `skill_supersedes` relation planned | Versioning is a first-class concern | Medium |
| `governs_skill` relation planned | Governance integration is planned from day 1 | High |

### Questions for Maintainer (To Validate Remaining Assumptions)

1. "When you last created a sandbox agent, what expertise did you have to re-explain each session?" (validates A1)
2. "Walk me through how you'd assign skills to an agent today if you could -- would you do it during creation or after?" (validates A1)
3. "How many skills would a typical agent have? 1-3? 5-10? 20+?" (informs wizard UX design)
4. "When you look at tools and skills together, do you think of them as one configuration concern or two separate ones?" (validates A3)
5. "For external agents (Claude Code via MCP proxy), what role would skills play if any?" (validates A8)

## Gate G1 Evaluation

| Criterion | Status | Evidence |
|-----------|--------|---------|
| 5+ data points confirming pain | PASS (5/5) | Codebase gaps, research investment, schema design, learning system precedent, session lifecycle gap |
| >60% confirm problem | PASS | All 5 evidence sources confirm the gap between Tools and Learnings |
| Problem in customer words | PASS | "Agents don't know how to do domain-specific work" -- derived from issue description |
| 3+ concrete examples | PASS | Security audits, coding standards, compliance checks, code review expertise |

**Gate G1: PROCEED to Phase 2 (Opportunity Mapping)**
