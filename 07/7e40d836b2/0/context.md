# Session Context

## User Prompts

### Prompt 1

<system_instruction>
You are working inside Conductor, a Mac app that lets the user run many coding agents in parallel.
Your work should take place in the /Users/marcus/conductor/workspaces/brain-v1/munich-v2 directory (unless otherwise directed), which has been set up for you to work in.
Each workspace has a .context directory (gitignored) where you can save files to collaborate with other agents.
The target branch for this workspace is main. Use this for actions like creating new PRs, bisec...

### Prompt 2

Base directory for this skill: /Users/marcus/.claude/skills/nw-discover

# NW-DISCOVER: Evidence-Based Product Discovery

**Wave**: DISCOVER | **Agent**: Scout (nw-product-discoverer)

## Overview

Execute evidence-based product discovery through assumption testing and market validation. First wave in nWave (DISCOVER > DISCUSS > DESIGN > DEVOPS > DISTILL > DELIVER).

Scout establishes product-market fit through rigorous customer development using Mom Test interviewing principles and continuou...

### Prompt 3

agent type should be removed. we should rely on name / id instead.
the only difference is that some agents are brain managed and some are managed by the user in the workspace.
so we actually need three types: brain controlled, sandboxed via sandbox agent, and third, agents that are programmatically controlled/written (e.g via vercel ai sdk, langchain, etc
)

### Prompt 4

if we remove agent_type, what field will we then use to distinguish between brain, sandbox and external

### Prompt 5

"How do programmatic/external agents register with Brain? Currently Brain only knows about internal agents and MCP-connected ones (via brain init). What about a Vercel AI SDK agent or LangChain agent that wants to participate in the graph?"
it would connect via the llm proxy - but the agent itself would still have to be registered in brain first

### Prompt 6

we have authority_scopes, skills (todo), mcp tools and rar + intent for authorization

### Prompt 7

we have authority_scopes, skills (todo), mcp tools and rar + intent for authorization

it should not be possible to create a brain agent from the ui. they're read only.

we need to ship it al

### Prompt 8

no i dont want to move forward with implementation. i want to continue with the discovery phase

### Prompt 9

Continue from where you left off.

### Prompt 10

we have already discussed this ???

### Prompt 11

1. no, proxy token is fine
2. lives on the agent record. depending on those values, is what will be passed on to the sandbox agent sdk
3. agent belongs to identity which belongs to workspace
4. assign authority scopes at creation time

### Prompt 12

1. no, proxy token is fine
2. lives on the agent record. depending on those values, is what will be passed on to the sandbox agent sdk
3. agent will need a corresponding
 identity which belongs to workspace
4. assign authority scopes at creation time

### Prompt 13

1. look at the https://sandboxagent.dev/docs deploy section to derive it

2. there should be. check the code and schema

3. yes

### Prompt 14

option a

### Prompt 15

yes, session history and being able to spawn a sandbox session is relevant. 
session history can be used to view current active sessions, idle sessions (those waiting for input), and completed sessions

### Prompt 16

thats the scope.

yes, session history and being able to spawn a sandbox session is relevant. 
session history can be used to view current active sessions, idle sessions (those waiting for input), and completed sessions

### Prompt 17

so the sandbox agent deployment mode should be configurable per workspace. only one deployment mode should be supported (local, daytona, etc)

### Prompt 18

we already have workspace settings, so it would live there

"Does this split feel right" yes

### Prompt 19

sounds good. now complete the

### Prompt 20

sounds good. now complete the @docs/feature/agent-creation/discover/problem-validation.md doc

### Prompt 21

commit

