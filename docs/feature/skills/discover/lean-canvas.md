# Lean Canvas: Skills Feature (#177)

## 1. Problem (Phase 1 Validated)

| # | Problem | Evidence |
|---|---------|---------|
| P1 | Agents have tools but no domain expertise -- every session starts from scratch | No `setSkillsConfig` in session lifecycle; adapter lacks skill support |
| P2 | No mechanism to assign or govern agent expertise | Agent creation wizard has no skill step; `possesses` relation not wired |
| P3 | Community expertise (80k+ skills) has no import path into the governance graph | Source-reference architecture researched but not implemented. Only github/git sources in scope — local skills delegated. |

## 2. Customer Segments (by JTBD)

| Segment | Job-to-be-Done | Priority |
|---------|---------------|----------|
| Workspace admins | Equip agents with the right expertise for specialized work | Primary |
| Platform operators | Manage skill libraries across workspaces, enforce policies | Secondary |
| Developers (open source) | Import community skills for coding agents | Tertiary (post-MVP) |

## 3. Unique Value Proposition

**Governed, versionable domain expertise for autonomous agents -- the missing layer between tools and learnings.**

Unlike raw MCP tools (functional but blind) or ad-hoc prompt engineering (fragile and ungovernable), Skills are graph-native instruction documents with lifecycle management, implicit tool grants, and policy enforcement.

## 4. Solution (Phase 3 Validated)

| # | Feature | Maps to Problem |
|---|---------|----------------|
| F1 | 3-step agent creation wizard (Config > Skills > Tools) | P2 |
| F2 | Skill CRUD with lifecycle (draft > active > deprecated) | P1, P2 |
| F3 | Source-reference integration with sandbox agent SDK | P1 |
| F4 | Implicit tool grants via `skill_requires` edges | P1, P2 |
| F5 | Community skill import (GitHub/skills.sh) | P3 |

## 5. Channels

| Channel | How skills reach agents | Status |
|---------|------------------------|--------|
| Agent creation wizard (UI) | Admin assigns skills during agent setup | To build |
| Session lifecycle (API) | Brain passes skill source refs to sandbox agent at session start | To build (adapter extension) |
| MCP tool gating (API) | Brain filters `tools/list` based on skill-derived grants | To build |
| skills.sh import (UI) | Admin browses/imports community skills | Post-MVP |

## 6. Revenue Streams

Open-source project. Value measured by:
- Agent session quality (fewer re-explanations, more consistent output)
- Governance coverage (percentage of agent expertise under policy control)
- Community contribution (skills created, imported, shared)
- Platform adoption (workspaces using skills)

## 7. Cost Structure

| Cost | Type | Estimate |
|------|------|----------|
| Development (wizard, CRUD, adapter) | One-time | 2-3 weeks engineering |
| Schema migration | One-time | 1 day |
| Ongoing maintenance | Recurring | Low -- follows established patterns (learning system) |
| Skill catalog storage (SurrealDB) | Recurring | Negligible (metadata only, no file content) |

## 8. Key Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Agents with skills assigned | >50% of sandbox agents | `SELECT count() FROM possesses GROUP BY in` |
| Skills per agent (average) | 2-5 | Graph query on `possesses` edges |
| Skill activation rate per session | >30% of assigned skills activate | `skill_evidence` telemetry (post-MVP) |
| Wizard completion rate | >85% | Frontend analytics on step 3 submit |
| Time to create agent with skills | <3 minutes | Wizard duration tracking |

## 9. Unfair Advantage

- **Graph-native governance**: Skills are nodes in the knowledge graph with policy enforcement, not files on disk. No other agent platform governs expertise this way.
- **Three-layer model**: Tools + Skills + Learnings is a coherent competency model. Competitors have tools. Some have prompt templates. None have a governed expertise layer with versioning and implicit tool grants.
- **Agent Skills spec compatibility**: Materialize to standard `SKILL.md` format, compatible with Claude Code, Codex, Cursor, and any Agent Skills-compatible client.

## 4 Big Risks Assessment

### Value Risk: Will admins want this?

| Signal | Direction | Confidence |
|--------|-----------|------------|
| Issue #177 with detailed schema | Positive | High |
| Research doc invested 2+ hours | Positive | High |
| Learning system adoption (if known) | Unknown | Medium |
| No competing feature request | Neutral | Medium |

**Assessment**: GREEN. The architectural gap is real and documented. The three-layer model is conceptually sound.

### Usability Risk: Can admins use the 3-step wizard?

| Signal | Direction | Confidence |
|--------|-----------|------------|
| Existing 2-step wizard is simple and works | Positive | High |
| Adding 2 optional steps may feel heavy | Risk | Medium |
| Skill checklist is a standard UI pattern | Positive | High |
| Implicit tool grants may confuse | Risk | Medium |

**Assessment**: YELLOW. The wizard extension is low-risk but H3 (tool grant comprehension) needs prototype validation. Mitigation: clear "via skill X" labels on derived tools.

### Feasibility Risk: Can we build this?

| Signal | Direction | Confidence |
|--------|-----------|------------|
| Schema designed and validated | Positive | High |
| Research confirms sandbox agent SDK supports `setSkillsConfig` | Positive | High |
| Learning system provides implementation pattern | Positive | High |
| Source-reference architecture avoids file storage complexity | Positive | High |
| `createAgentTransaction` already handles complex atomic creation | Positive | High |

**Assessment**: GREEN. All components have precedent in the codebase or confirmed SDK support.

### Viability Risk: Does this work for the project?

| Signal | Direction | Confidence |
|--------|-----------|------------|
| Aligns with Osabio's core mission (governed agent autonomy) | Positive | High |
| Fills documented architectural gap (README three-layer model) | Positive | High |
| Development cost is bounded (2-3 weeks) | Positive | High |
| No external dependencies or vendor risk | Positive | High |
| Open source -- no revenue impact to assess | Neutral | N/A |

**Assessment**: GREEN. Skills are a natural extension of the existing architecture.

## Gate G4 Evaluation

| Criterion | Status | Evidence |
|-----------|--------|---------|
| All 4 risks assessed | PASS | Value=GREEN, Usability=YELLOW, Feasibility=GREEN, Viability=GREEN |
| Lean Canvas complete | PASS | All 9 sections filled with evidence |
| Channel validated (1+) | PASS | Agent creation wizard is the primary channel, session lifecycle is the runtime channel |
| Stakeholder sign-off | PENDING | Maintainer review required |

**Gate G4: PROCEED (conditional on maintainer review)**

## Go/No-Go Recommendation

**GO** -- with the following conditions:

1. **Validate H1 (wizard comprehension)** with a quick prototype walkthrough before building
2. **MVP scope only** -- defer import, telemetry, policy enforcement, and Observer integration
3. **External agent path** must not regress -- steps 2+3 should feel like optional enhancements, not obstacles
4. **H3 (tool grant comprehension)** is the primary usability risk -- address with clear visual hierarchy in step 3

## Implementation Order Recommendation

1. Schema migration (skill table, relation tables)
2. Skill CRUD API (backend)
3. Sandbox adapter `setSkillsConfig` extension
4. Session lifecycle integration (pass source refs)
5. 3-step wizard (frontend)
6. MCP tool gating (backend)
