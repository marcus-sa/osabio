# Session Context

## User Prompts

### Prompt 1

<system_instruction>
You are working inside Conductor, a Mac app that lets the user run many coding agents in parallel.
Your work should take place in the /Users/marcus/conductor/workspaces/brain-v1/los-angeles directory (unless otherwise directed), which has been set up for you to work in.
Each workspace has a .context directory (gitignored) where you can save files to collaborate with other agents.
The target branch for this workspace is main. Use this for actions like creating new PRs, bis...

### Prompt 2

Base directory for this skill: /Users/marcus/.claude/skills/nw-discover

# NW-DISCOVER: Evidence-Based Product Discovery

**Wave**: DISCOVER | **Agent**: Scout (nw-product-discoverer)

## Overview

Execute evidence-based product discovery through assumption testing and market validation. First wave in nWave (DISCOVER > DISCUSS > DESIGN > DEVOPS > DISTILL > DELIVER).

Scout establishes product-market fit through rigorous customer development using Mom Test interviewing principles and continuou...

### Prompt 3

we dont want to support local skills yet. that has been delegated

### Prompt 4

what do u mean by these are deferred:
Observer integration, policy governance at tool-call time

### Prompt 5

yes move policy governance back into MVP scope.
create follow up gh issue for "Observer integration (proposing skill updates, scanning for skill-related contradictions): This is about the system self-correcting over time — the Observer noticing stale skills, proposing version bumps, detecting skill-tool mismatches. Genuinely additive rather than foundational."

### Prompt 6

we need to build the ui for skills + agent creation step wizard as well

### Prompt 7

Base directory for this skill: /Users/marcus/.claude/skills/nw-discuss

# NW-DISCUSS: Jobs-to-be-Done Analysis, UX Journey Design, and Requirements Gathering

**Wave**: DISCUSS (wave 2 of 6) | **Agent**: Luna (nw-product-owner) | **Command**: `/nw-discuss`

## Overview

Execute DISCUSS wave through Luna's integrated workflow: JTBD analysis|UX journey discovery|emotional arc design|shared artifact tracking|requirements gathering|user story creation|acceptance criteria definition. Luna uncovers...

### Prompt 8

yes

### Prompt 9

Base directory for this skill: /Users/marcus/.claude/skills/nw-design

# NW-DESIGN: Architecture Design

**Wave**: DESIGN (wave 3 of 6) | **Agents**: Morgan (nw-solution-architect) | **Command**: `*design-architecture`

## Overview

Execute DESIGN wave through discovery-driven architecture design. Morgan asks about business drivers and constraints first, then recommends architecture that fits. Analyzes existing codebase, evaluates open-source alternatives, produces C4 diagrams (Mermaid) as ma...

### Prompt 10

Base directory for this skill: /Users/marcus/.claude/skills/nw-distill

# NW-DISTILL: Acceptance Test Creation and Business Validation

**Wave**: DISTILL (wave 5 of 6) | **Agent**: Quinn (nw-acceptance-designer)

## Overview

Create E2E acceptance tests from requirements|architecture|infrastructure design using Given-When-Then format. Produces executable specifications bridging business requirements and technical implementation. Infrastructure design from DEVOPS informs test environment setup...

### Prompt 11

Base directory for this skill: /Users/marcus/.claude/skills/nw-deliver

# NW-DELIVER: Complete DELIVER Wave Orchestrator

**Wave**: DELIVER (wave 6 of 6)|**Agent**: Main Instance (orchestrator)|**Command**: `/nw-deliver "{feature-description}"`

## Overview

Orchestrates complete DELIVER wave: feature description → production-ready code with mandatory quality gates. You (main Claude instance) coordinate by delegating to specialized agents via Task tool. Final wave (DISCOVER > DISCUSS > DESIGN...

### Prompt 12

Base directory for this skill: /Users/marcus/.claude/skills/nw-review

# NW-REVIEW: Expert Critique and Quality Assurance

**Wave**: CROSS_WAVE
**Agent**: Dynamic (nw-*-reviewer)

## Overview

Dispatches expert reviewer agent to critique workflow artifacts. Takes base agent name, appends `-reviewer`, invokes with artifact. Reviewer agent owns all review methodology|criteria|output format.

## Review Philosophy: Radical Candor

Every review MUST embody Radical Candor — kind AND clear, specific...

### Prompt 13

<system_instruction>
The user has attached these files. Read them before proceeding.
- /Users/marcus/conductor/workspaces/brain-v1/los-angeles/.context/attachments/PR instructions.md (954 B)
</system_instruction>



Create a PR

