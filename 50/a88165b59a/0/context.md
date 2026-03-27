# Session Context

## User Prompts

### Prompt 1

<system_instruction>
You are working inside Conductor, a Mac app that lets the user run many coding agents in parallel.
Your work should take place in the /Users/marcus/conductor/workspaces/brain-v1/phoenix-v2 directory (unless otherwise directed), which has been set up for you to work in.
Each workspace has a .context directory (gitignored) where you can save files to collaborate with other agents.
The target branch for this workspace is main. Use this for actions like creating new PRs, bise...

### Prompt 2

Base directory for this skill: /Users/marcus/.claude/skills/nw-roadmap

# NW-ROADMAP: Goal Planning

**Wave**: CROSS_WAVE
**Agent**: Architect (nw-solution-architect) or domain-appropriate agent

## Overview

Dispatches expert agent to fill a pre-scaffolded YAML roadmap skeleton. CLI tools handle structure; agent handles content.

Output: `docs/feature/{feature-id}/deliver/roadmap.json`

## Usage

```bash
/nw-roadmap @nw-solution-architect "Migrate monolith to microservices"
/nw-roadmap @nw-s...

### Prompt 3

Base directory for this skill: /Users/marcus/.claude/skills/nw-deliver

# NW-DELIVER: Complete DELIVER Wave Orchestrator

**Wave**: DELIVER (wave 6 of 6)|**Agent**: Main Instance (orchestrator)|**Command**: `/nw-deliver "{feature-description}"`

## Overview

Orchestrates complete DELIVER wave: feature description → production-ready code with mandatory quality gates. You (main Claude instance) coordinate by delegating to specialized agents via Task tool. Final wave (DISCOVER > DISCUSS > DESIGN...

