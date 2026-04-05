# Session Context

## User Prompts

### Prompt 1

Base directory for this skill: /Users/marcus/.claude/skills/nw-bugfix

# NW-BUGFIX: Defect Resolution Workflow

**Wave**: CROSS_WAVE
**Agents**: Rex (nw-troubleshooter) → selected crafter (OOP or FP per project paradigm)

## Overview

End-to-end bug fix pipeline: diagnose root cause, review findings with user, then deliver regression tests that fail with the bug and pass with the fix. Ensures every defect produces a test that prevents recurrence.

## Flow

```
INPUT: "{bug-description}"
  │
 ...

### Prompt 2

yes

### Prompt 3

are u sure that removing /api/auth from BETTER_AUTH_URL doesnt break anything else?

### Prompt 4

backwards compatibility doesnt matter

### Prompt 5

commit

### Prompt 6

[Request interrupted by user for tool use]

### Prompt 7

commit

