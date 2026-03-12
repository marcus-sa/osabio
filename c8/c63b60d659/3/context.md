# Session Context

## User Prompts

### Prompt 1

<system_instruction>
You are working inside Conductor, a Mac app that lets the user run many coding agents in parallel.
Your work should take place in the /Users/marcus/conductor/workspaces/brain-v1/houston-v1 directory (unless otherwise directed), which has been set up for you to work in.
Each workspace has a .context directory (gitignored) where you can save files to collaborate with other agents.
The target branch for this workspace is main. Use this for actions like creating new PRs, bise...

### Prompt 2

Tool loaded.

### Prompt 3

# NW-FINALIZE: Feature Completion and Archive

**Wave**: CROSS_WAVE
**Agent**: @nw-platform-architect (default) or specified agent

## Overview

Finalize a completed feature: verify all steps done|create evolution document in docs/evolution/|clean up workflow files in docs/feature/{project-id}/|optionally generate reference docs. Agent gathers project data|analyzes execution history|writes summaries|archives|cleans up.

## Usage

```
/nw:finalize @{agent} "{project-id}"
```

## Context Files ...

