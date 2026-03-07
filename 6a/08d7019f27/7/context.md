# Session Context

## User Prompts

### Prompt 1

<system_instruction>
You are working inside Conductor, a Mac app that lets the user run many coding agents in parallel.
Your work should take place in the /Users/marcus/conductor/workspaces/brain/richmond directory (unless otherwise directed), which has been set up for you to work in.
Each workspace has a .context directory (gitignored) where you can save files to collaborate with other agents.
The target branch for this workspace is main. Use this for actions like creating new PRs, bisecting...

### Prompt 2

Tool loaded.

### Prompt 3

# NW-ROOT-WHY: Toyota 5 Whys Root Cause Analysis

**Wave**: CROSS_WAVE
**Agent**: Rex (nw-troubleshooter)

## Overview

Systematic root cause analysis using Toyota's 5 Whys with multi-causal investigation and evidence-based validation. Investigates multiple cause branches at each level|validates solutions against all identified root causes.

## Agent Invocation

@nw-troubleshooter

Execute \*investigate-root-cause for {problem-statement}.

**Configuration:**
- investigation_depth: 5
- multi_c...

### Prompt 4

Tool loaded.

### Prompt 5

https://opencode.ai/docs/sdk/#_top

### Prompt 6

Tool loaded.

### Prompt 7

Tool loaded.

### Prompt 8

Tool loaded.

### Prompt 9

# NW-DISCUSS: Jobs-to-be-Done Analysis, UX Journey Design, and Requirements Gathering

**Wave**: DISCUSS (wave 2 of 6) | **Agent**: Luna (nw-product-owner) | **Command**: `/nw:discuss`

## Overview

Execute DISCUSS wave through Luna's integrated workflow: JTBD analysis|UX journey discovery|emotional arc design|shared artifact tracking|requirements gathering|user story creation|acceptance criteria definition. Luna uncovers jobs users accomplish, maps to journeys and requirements, handles compl...

### Prompt 10

# NW-DESIGN: Architecture Design

**Wave**: DESIGN (wave 3 of 6) | **Agents**: Morgan (nw-solution-architect) | **Command**: `*design-architecture`

## Overview

Execute DESIGN wave through discovery-driven architecture design. Morgan asks about business drivers and constraints first, then recommends architecture that fits. Analyzes existing codebase, evaluates open-source alternatives, produces C4 diagrams (Mermaid) as mandatory output.

## Context Files Required

- docs/feature/{feature-nam...

### Prompt 11

Tool loaded.

### Prompt 12

# NW-ROADMAP: Goal Planning

**Wave**: CROSS_WAVE
**Agent**: Architect (nw-solution-architect) or domain-appropriate agent

## Overview

Dispatches expert agent to fill a pre-scaffolded YAML roadmap skeleton. CLI tools handle structure; agent handles content.

Output: `docs/feature/{project-id}/roadmap.yaml`

## Usage

```bash
/nw:roadmap @nw-solution-architect "Migrate monolith to microservices"
/nw:roadmap @nw-software-crafter "Replace legacy authentication system"
/nw:roadmap @nw-product-o...

### Prompt 13

before the task gets delegated, we need to ensure that the brain cli is installed and authenticated for the repo

### Prompt 14

Continue from where you left off.

### Prompt 15

init only needs to happen once in the original repo path, not in the git worktrees

### Prompt 16

the first prompt to the coding agent should be something like "brain start task xxx" and then the cli will also validate that it is authenticated. that also verifies if brain cli is actually installed on the machine

### Prompt 17

# NW-DISTILL: Acceptance Test Creation and Business Validation

**Wave**: DISTILL (wave 5 of 6) | **Agent**: Quinn (nw-acceptance-designer)

## Overview

Create E2E acceptance tests from requirements|architecture|infrastructure design using Given-When-Then format. Produces executable specifications bridging business requirements and technical implementation. Infrastructure design from DEVOP informs test environment setup.

## Interactive Decision Points

### Decision 1: Feature Scope
**Questi...

