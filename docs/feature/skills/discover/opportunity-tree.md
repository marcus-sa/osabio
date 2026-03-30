# Opportunity Solution Tree: Skills Feature (#177)

## Desired Outcome

Workspace admins can equip agents with governed, versionable domain expertise so agents perform specialized work without per-session re-explanation.

## Job Map (JTBD)

**Main Job**: Configure an agent with the right expertise for its role

| Step | Job Step | Current Experience |
|------|----------|-------------------|
| Define | Determine what expertise this agent needs | Manual -- admin knows from experience, no catalog |
| Locate | Find skills that match the need | No skill catalog exists; copy-paste from other projects |
| Prepare | Assign skills to the agent | No mechanism -- agents start as blank slates |
| Confirm | Verify the agent has correct expertise | No visibility -- run a session and see what happens |
| Execute | Agent performs domain work using skills | Agent has tools but no "how-to" guidance |
| Monitor | Track which skills activated and helped | No telemetry on skill usage |
| Modify | Update or replace skills when needs change | No versioning or lifecycle management |
| Conclude | Agent delivers expert-quality work | Quality depends on ad-hoc prompt engineering |

## Opportunity Scoring

Scoring based on codebase analysis, architectural patterns, and research evidence.

| # | Opportunity | Importance (1-10) | Satisfaction (1-10) | Score | Action |
|---|------------|-------------------|---------------------|-------|--------|
| O1 | Assign domain expertise to agents at creation time | 9 | 1 | 17 | Pursue |
| O2 | Discover and browse available skills for assignment | 8 | 1 | 15 | Pursue |
| O3 | Govern skill usage through policies | 8 | 2 | 14 | Pursue |
| O4 | Import community skills from external registries | 7 | 1 | 13 | Pursue |
| O5 | Track which skills activated during sessions | 6 | 1 | 11 | Evaluate |
| O6 | Version and evolve skills over time | 7 | 2 | 12 | Pursue |
| O7 | Understand skill-derived tool grants | 7 | 1 | 13 | Pursue |
| O8 | Configure tools available to agents at creation time | 8 | 2 | 14 | Pursue |

### Top 3 Opportunities (Score >8, Pursue)

**O1 (Score: 17) -- Assign domain expertise to agents at creation time**
- Highest importance: the core value proposition
- Zero satisfaction today: no mechanism exists
- Maps to wizard Step 2 (Skills Setup)

**O2 (Score: 15) -- Discover and browse available skills**
- Admins need to see what's available before they can assign
- Zero satisfaction: no skill catalog in the product
- Maps to skill browsing UI within wizard Step 2

**O8 (Score: 14) -- Configure tools available to agents at creation time**
- Tools and skills are tightly coupled (implicit grants)
- Low satisfaction: tool assignment is disconnected from agent creation
- Maps to wizard Step 3 (Tools Setup)

## Opportunity Solution Tree

```
Desired Outcome: Agents perform specialized work via governed expertise
|
+-- O1: Assign domain expertise at creation time (Score: 17)
|   +-- S1a: 3-step wizard (Config > Skills > Tools)
|   +-- S1b: 2-step wizard + post-creation skill panel
|   +-- S1c: Single-page form with expandable sections
|
+-- O2: Discover and browse available skills (Score: 15)
|   +-- S2a: Searchable skill catalog with category filters
|   +-- S2b: Skill recommendation engine based on agent description
|   +-- S2c: Minimal checklist of workspace skills
|
+-- O8: Configure tools at creation time (Score: 14)
|   +-- S8a: Explicit tool selection + skill-derived grants display
|   +-- S8b: Tools auto-derived from skills only (no manual selection)
|   +-- S8c: Post-creation tool configuration
|
+-- O7: Understand skill-derived tool grants (Score: 13)
|   +-- S7a: Visual indicator showing "via skill X" on tool grants
|   +-- S7b: Expandable skill card showing required tools
|   +-- S7c: Separate "effective tools" summary view
|
+-- O4: Import community skills (Score: 13)
|   +-- S4a: GitHub URL import with metadata extraction
|   +-- S4b: skills.sh registry browser
|   +-- S4c: Manual SKILL.md file upload
|
+-- O6: Version and evolve skills (Score: 12)
|   +-- S6a: Supersede chain with status lifecycle
|   +-- S6b: Simple overwrite with audit log
|
+-- O5: Track skill activation (Score: 11)
|   +-- S5a: Session telemetry with skill_evidence edges
|   +-- S5b: Activation count on skill detail page
```

## Solution Evaluation for Top Opportunities

### O1: 3-Step Wizard vs Alternatives

| Solution | Pros | Cons | Recommendation |
|----------|------|------|----------------|
| S1a: 3-step wizard | Clear mental model, mirrors the conceptual layers (identity > expertise > capabilities) | More clicks, may feel heavy for simple agents | Test with prototype |
| S1b: 2-step + post-creation panel | Faster creation, add skills later | Breaks "configure once" mental model, risk of unconfigured agents | Deprioritize |
| S1c: Single-page with sections | All visible at once, fast for power users | Overwhelming for new users, long scroll | Deprioritize |

**Recommendation**: S1a (3-step wizard) with an important nuance -- Steps 2 and 3 should be skippable. External agents may not use skills. Sandbox agents with no skills assigned yet should still be creatable.

### O2: Skill Discovery Within Wizard

| Solution | Pros | Cons | Recommendation |
|----------|------|------|----------------|
| S2a: Searchable catalog | Scalable, works with many skills | Over-engineered for MVP (few skills initially) | Phase 2 |
| S2b: Recommendation engine | Smart, reduces admin effort | Complex, needs training data | Future |
| S2c: Minimal checklist | Simple, fast, works for <20 skills | Doesn't scale | **MVP** |

**Recommendation**: S2c (checklist) for MVP. Each skill shows name + description. When workspace has >20 skills, upgrade to S2a.

### O8: Tool Configuration

| Solution | Pros | Cons | Recommendation |
|----------|------|------|----------------|
| S8a: Explicit + skill-derived | Full control, transparency | More complex UI | **MVP** |
| S8b: Auto-derived only | Simplest | Removes direct tool grants | Too restrictive |
| S8c: Post-creation | Simpler wizard | Breaks "configure once" flow | Deprioritize |

**Recommendation**: S8a. Show two sections: "Skill-derived tools" (read-only, shows which skills grant which tools) and "Additional tools" (manual `can_use` grants).

## Gate G2 Evaluation

| Criterion | Status | Evidence |
|-----------|--------|---------|
| Opportunities identified (5+) | PASS | 8 opportunities mapped |
| Top scores >8 | PASS | O1=17, O2=15, O8=14 (all >8) |
| Job step coverage (80%+) | PASS | All 8 job steps have mapped opportunities |
| Team alignment | PASS (single maintainer) | Consistent with issue #177 design direction |

**Gate G2: PROCEED to Phase 3 (Solution Testing)**
