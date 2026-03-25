# Session Context

## User Prompts

### Prompt 1

<system_instruction>
You are working inside Conductor, a Mac app that lets the user run many coding agents in parallel.
Your work should take place in the /Users/marcus/conductor/workspaces/brain-v1/el-paso-v1 directory (unless otherwise directed), which has been set up for you to work in.
Each workspace has a .context directory (gitignored) where you can save files to collaborate with other agents.
The target branch for this workspace is main. Use this for actions like creating new PRs, bise...

### Prompt 2

Base directory for this skill: /Users/marcus/.claude/skills/nw-research

# NW-RESEARCH: Evidence-Driven Knowledge Research

**Wave**: CROSS_WAVE
**Agent**: Nova (nw-researcher)
**Command**: `*research`

## Overview

Systematic evidence-based research with source verification. Cross-wave support providing research-backed insights for any nWave phase using trusted academic|official|industry sources.

Optional `--skill-for={agent-name}` distills research into a practitioner-focused skill file fo...

### Prompt 3

also relevant: 
- https://sandboxagent.dev/docs/llm-credentials#personal-subscription

### Prompt 4

Session persistence	External (Postgres, Rivet)	SurrealDB native

wrong, we can writer our own driver: https://sandboxagent.dev/docs/session-persistence#custom-driver

### Prompt 5

what we can do with the mcp server endpoint, is dynamically create mcp servers per agent

so it calls: localhost:3000/mcp/agent/<name> and only the relevant tools will be made available, but isn't this what we're doing with our proxy anyway?

### Prompt 6

we still want them to proxy through brain regardless

### Prompt 7

no, i mean the coding agents still sends requests through brain's proxy...

### Prompt 8

"That also means the personal subscription model doesn’t apply" YES THIS STILL APPLIES, BECAUSE THAT IS CURRNETLY SUPPORTED

### Prompt 9

now, let's evaluate for the mcp tools, if it makes more sense to expose them via the proxy or via the dynamic per agent mcp server endpoint

### Prompt 10

YOU DONT UNDERSTAND HOW THE PROXY WORKS: THE PROXY EXECUTES THE LLM TOOLS

### Prompt 11

yes, your understanding is correct. now re-evaluate

### Prompt 12

native tools are NOT proxy-executed, besides that, your understanding is correct.

### Prompt 13

native tools are passthrough (ungoverned)

### Prompt 14

Stop hook feedback:
Prompt hook condition was not met: Brain MCP tools are not available in this session. The session ended with architectural analysis of two competing approaches (Proxy-executes vs Dynamic-MCP-endpoint) for routing MCP tool calls in coding agent sandboxes, but no decision was recorded via Brain tools. Cannot log decisions without access to brain-start-task, brain-status, or decision logging endpoints.

### Prompt 15

WHAT DO YOU THINK IS THE BEST APPROACH?

### Prompt 16

Stop hook feedback:
Prompt hook condition was not met: Brain MCP tools (brain-status, brain-start-task) are not available in this session. Cannot log decisions, questions, observations, or task updates without access to Brain knowledge graph endpoints. Review requested but logging blocked.

### Prompt 17

yes

### Prompt 18

this means we also need to refactor the existing orchestrator to use sandbox agent

### Prompt 19

Continue from where you left off.

### Prompt 20

THE ORCHESTRATOR (CODING AGENT) IS USING CLAUDE'S AGENT SDK ....

### Prompt 21

also relevant:
- https://sandboxagent.dev/docs/session-restoration
- https://sandboxagent.dev/docs/agent-sessions

### Prompt 22

"Worktree elimination — sandbox provider replaces git worktrees for isolation" i am not so sure that this replaces git worktrees for local deployment.. https://sandboxagent.dev/docs/deploy/local - check source code in /Users/marcus/Git/sandbox-agent

### Prompt 23

not only coding agents will use agent sandbox, but also the custom agents that the user will configure

