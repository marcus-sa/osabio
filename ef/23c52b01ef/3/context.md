# Session Context

## User Prompts

### Prompt 1

<system_instruction>
You are working inside Conductor, a Mac app that lets the user run many coding agents in parallel.
Your work should take place in the /Users/marcus/conductor/workspaces/brain-v1/lahore-v1 directory (unless otherwise directed), which has been set up for you to work in.
Each workspace has a .context directory (gitignored) where you can save files to collaborate with other agents.
The target branch for this workspace is main. Use this for actions like creating new PRs, bisec...

### Prompt 2

Base directory for this skill: /Users/marcus/.claude/skills/nw-finalize

# NW-FINALIZE: Feature Completion and Archive

**Wave**: CROSS_WAVE
**Agent**: @nw-platform-architect (default) or specified agent

## Overview

Finalize a completed feature: verify all steps done|create evolution document|migrate lasting artifacts to permanent directories|clean up temporary workspace. Agent gathers project data|analyzes execution history|writes summaries|migrates|cleans up.

`docs/feature/{feature-id}/`...

### Prompt 3

Stop hook feedback:
Prompt hook condition was not met: The hook expects a response in the format specified in the instructions, but this is a planning/finalization session where no implementation decisions or observations were made during this conversation. The nw-finalize skill executed a pre-existing plan; no new architecture decisions, contradictions, or unresolved questions arose during this session. This is a process execution (reading artifacts, creating evolution doc, migrating files, ...

### Prompt 4

yes

### Prompt 5

commit and push EVERYTHING

