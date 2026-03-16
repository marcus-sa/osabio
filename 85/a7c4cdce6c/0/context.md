# Session Context

## User Prompts

### Prompt 1

<system_instruction>
You are working inside Conductor, a Mac app that lets the user run many coding agents in parallel.
Your work should take place in the /Users/marcus/conductor/workspaces/brain-v1/london directory (unless otherwise directed), which has been set up for you to work in.
Each workspace has a .context directory (gitignored) where you can save files to collaborate with other agents.
The target branch for this workspace is main. Use this for actions like creating new PRs, bisectin...

### Prompt 2

# NW-DISTILL: Acceptance Test Creation and Business Validation

**Wave**: DISTILL (wave 5 of 6) | **Agent**: Quinn (nw-acceptance-designer)

## Overview

Create E2E acceptance tests from requirements|architecture|infrastructure design using Given-When-Then format. Produces executable specifications bridging business requirements and technical implementation. Infrastructure design from DEVOP informs test environment setup.

## Interactive Decision Points

### Decision 1: Feature Scope
**Questi...

### Prompt 3

commit everything

### Prompt 4

# NW-DELIVER: Complete DELIVER Wave Orchestrator

**Wave**: DELIVER (wave 6 of 6)|**Agent**: Main Instance (orchestrator)|**Command**: `/nw:deliver "{feature-description}"`

## Overview

Orchestrates complete DELIVER wave: feature description → production-ready code with mandatory quality gates. You (main Claude instance) coordinate by delegating to specialized agents via Task tool. Final wave (DISCOVER > DISCUSS > DESIGN > DEVOP > DISTILL > DELIVER).

Sub-agents cannot use Skill tool or `/nw...

### Prompt 5

we no longer need this hook since brain llm proxy handles context injection:

    "SessionStart": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "entire hooks claude-code session-start"
          }
        ]
      },
      {
        "hooks": [
          {
            "type": "command",
            "command": "brain system load-context"
          }
        ]
      }
    ],

we need to revisit our claude hooks and determine ...

### Prompt 6

systematically remove SessionStart → brain system load-context and PreToolUse → brain system pretooluse

### Prompt 7

Continue from where you left off.

### Prompt 8

systematically remove SessionStart → brain system load-context and PreToolUse → brain system pretooluse from cli as well

### Prompt 9

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

