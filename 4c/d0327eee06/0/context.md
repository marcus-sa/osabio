# Session Context

## User Prompts

### Prompt 1

<system_instruction>
You are working inside Conductor, a Mac app that lets the user run many coding agents in parallel.
Your work should take place in the /Users/marcus/conductor/workspaces/brain-v1/munich-v2 directory (unless otherwise directed), which has been set up for you to work in.
Each workspace has a .context directory (gitignored) where you can save files to collaborate with other agents.
The target branch for this workspace is main. Use this for actions like creating new PRs, bisec...

### Prompt 2

Base directory for this skill: /Users/marcus/.claude/skills/nw-discuss

# NW-DISCUSS: Jobs-to-be-Done Analysis, UX Journey Design, and Requirements Gathering

**Wave**: DISCUSS (wave 2 of 6) | **Agent**: Luna (nw-product-owner) | **Command**: `/nw-discuss`

## Overview

Execute DISCUSS wave through Luna's integrated workflow: JTBD analysis|UX journey discovery|emotional arc design|shared artifact tracking|requirements gathering|user story creation|acceptance criteria definition. Luna uncovers...

### Prompt 3

1. cross cutting
2. yes
3. Comprehensive
4. skip jtbd

### Prompt 4

"image" and "snapshot" is irrelevant if sandbox provider is local (default)

### Prompt 5

Base directory for this skill: /Users/marcus/.claude/skills/nw-design

# NW-DESIGN: Architecture Design

**Wave**: DESIGN (wave 3 of 6) | **Agents**: Morgan (nw-solution-architect) | **Command**: `*design-architecture`

## Overview

Execute DESIGN wave through discovery-driven architecture design. Morgan asks about business drivers and constraints first, then recommends architecture that fits. Analyzes existing codebase, evaluates open-source alternatives, produces C4 diagrams (Mermaid) as ma...

### Prompt 6

Stop hook feedback:
Prompt hook condition was not met: MCP tools not available in this hook context. Cannot log to Brain. Review output as informational only.

### Prompt 7

Base directory for this skill: /Users/marcus/.claude/skills/nw-distill

# NW-DISTILL: Acceptance Test Creation and Business Validation

**Wave**: DISTILL (wave 5 of 6) | **Agent**: Quinn (nw-acceptance-designer)

## Overview

Create E2E acceptance tests from requirements|architecture|infrastructure design using Given-When-Then format. Produces executable specifications bridging business requirements and technical implementation. Infrastructure design from DEVOPS informs test environment setup...

### Prompt 8

Base directory for this skill: /Users/marcus/.claude/skills/nw-review

# NW-REVIEW: Expert Critique and Quality Assurance

**Wave**: CROSS_WAVE
**Agent**: Dynamic (nw-*-reviewer)

## Overview

Dispatches expert reviewer agent to critique workflow artifacts. Takes base agent name, appends `-reviewer`, invokes with artifact. Reviewer agent owns all review methodology|criteria|output format.

## Review Philosophy: Radical Candor

Every review MUST embody Radical Candor — kind AND clear, specific...

### Prompt 9

design & distill
 artifacts

### Prompt 10

fix everything

### Prompt 11

add to AGENTS.md: deferred work should always be created as github issues

### Prompt 12

commit everything

