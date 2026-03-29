# Session Context

## User Prompts

### Prompt 1

how to spawn a process as a different user

### Prompt 2

e.g, i want to spawn claude code under a different user, to prevent it from access directories its not allowed to

### Prompt 3

does this also work for linux

### Prompt 4

how would i use this with https://sandboxagent.dev/docs/deploy/local ?

### Prompt 5

Stop hook feedback:
Prompt hook condition was not met: Brain MCP tools are not available in this session. Cannot log decisions, questions, observations, or suggestions. This appears to be a research/advisory session about process isolation and Sandbox Agent deployment patterns, which would benefit from logging the architectural decisions discussed (Docker vs local user vs cgroups approaches, trade-offs between isolation strength vs complexity), but the tools to do so are unavailable.

### Prompt 6

i cannot use docker with the local provider ... the whole point of the local provider ,is taht u have claude code installed and logged in so that u can reuse the credentials

### Prompt 7

why wouldnt /home/claude-sandbox/work just have its own repo? lol

### Prompt 8

create a md in docs/research for linux and macos setup

### Prompt 9

Base directory for this skill: /Users/marcus/.claude/skills/nw-research

# NW-RESEARCH: Evidence-Driven Knowledge Research

**Wave**: CROSS_WAVE
**Agent**: Nova (nw-researcher)
**Command**: `*research`

## Overview

Systematic evidence-based research with source verification. Cross-wave support providing research-backed insights for any nWave phase using trusted academic|official|industry sources.

Optional `--skill-for={agent-name}` distills research into a practitioner-focused skill file fo...

### Prompt 10

i was only interested in nomad for local sandbox agent user isolation running processes directly on a single machine. wouldn't nomad still be relevant for ease of deployment?

### Prompt 11

Stop hook feedback:
Prompt hook condition was not met: MCP Brain tools unavailable in this session. Cannot log decisions, questions, observations, task progress, or suggestions. Session includes substantive research and documentation work that should be preserved:

**Decisions made:**
- Choose Nomad `exec2` driver over `exec` and `raw_exec` for modern Linux isolation
- Frame Nomad value proposition for local single-machine use (ease of deployment via declarative HCL) vs multi-node clusters
- ...

### Prompt 12

grrr stop using fucking anthropic api keys. this whole setup is meant to built on the fact that we're using claude code's existing auth + credentials

### Prompt 13

Stop hook feedback:
Prompt hook condition was not met: MCP Brain tools are not available in this session. Cannot log decisions, questions, observations, task progress, subtasks, or suggestions. The session included substantive work creating two research documents (sandbox-agent-user-isolation.md and nomad-agent-orchestration.md) with multiple design decisions and identified follow-up work that should be preserved but cannot be logged without MCP access.

### Prompt 14

commit both docs

