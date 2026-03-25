# Session Context

## User Prompts

### Prompt 1

<system_instruction>
You are working inside Conductor, a Mac app that lets the user run many coding agents in parallel.
Your work should take place in the /Users/marcus/conductor/workspaces/brain-v1/el-paso-v1 directory (unless otherwise directed), which has been set up for you to work in.
Each workspace has a .context directory (gitignored) where you can save files to collaborate with other agents.
The target branch for this workspace is main. Use this for actions like creating new PRs, bise...

### Prompt 2

Base directory for this skill: /Users/marcus/.claude/skills/nw-finalize

# NW-FINALIZE: Feature Completion and Archive

**Wave**: CROSS_WAVE
**Agent**: @nw-platform-architect (default) or specified agent

## Overview

Finalize a completed feature: verify all steps done|create evolution document|migrate lasting artifacts to permanent directories|clean up temporary workspace. Agent gathers project data|analyzes execution history|writes summaries|migrates|cleans up.

`docs/feature/{feature-id}/`...

### Prompt 3

Base directory for this skill: /Users/marcus/.claude/skills/nw-execute

# NW-EXECUTE: Atomic Task Execution

**Wave**: EXECUTION_WAVE | **Agent**: Dispatched agent (specified by caller)

## Overview

Dispatch a single roadmap step to an agent. Orchestrator extracts step context from roadmap so agent never loads the full roadmap.

## Syntax

```
/nw-execute @{agent} "{feature-id}" "{step-id}"
```

## Context Files Required

- `docs/feature/{feature-id}/deliver/roadmap.json` — Orchestrator read...

### Prompt 4

Continue from where you left off.

### Prompt 5

remove embedding env vars. no longer required

X-Brain-Auth header will have to be defined via ANTHROPIC_CUSTOM_HEADERS env var

### Prompt 6

Continue from where you left off.

### Prompt 7

THE EMBEDDING ENV VARS ARE NO LONGER USED!!!!

