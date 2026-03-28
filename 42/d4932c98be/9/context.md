# Session Context

## User Prompts

### Prompt 1

rewrite gh issue MCP tool registry with proxy-based tool injection and credential brokerage #178 - local tools won't be available. instead, it is recommended to use an agent with a runtime, such as openclaw

### Prompt 2

"Registration: When an agent runtime (e.g. OpenClaw) connects, it registers its available local tools via MCP tools/list. Brain stores these as mcp_tool nodes with execution_target: "runtime". - no it does not do that... there is no reason for it to register its own local tools

### Prompt 3

should we require a skill to be created for agents to use mcp_tools ? see gh issue #177

### Prompt 4

"One thing worth considering: should skill_requires automatically grant can_use when a skill is activated for an agent? That way admins don't have to wire both the skill assignment and individual tool 
  grants. The skill becomes a "tool bundle + expertise" package." yes

### Prompt 5

can we use better auth for mcp server auth?

### Prompt 6

[Request interrupted by user for tool use]

### Prompt 7

can we use better auth for the mcp tools auth_config & connected_account ?

### Prompt 8

yes

### Prompt 9

but better auth oauth providers have to be dynamically created at runtime. this is possible right ?

### Prompt 10

investigate those gaps first

### Prompt 11

Build it ourselves in SurrealDB

### Prompt 12

close #136 as superseded by #178

### Prompt 13

what about mcp tools that does not use oauth, but rather api keys or basic auth?

### Prompt 14

[Request interrupted by user]

### Prompt 15

what about mcp tools that does not use oauth, but rather api keys or basic auth? we completely removed that...

### Prompt 16

option 1

### Prompt 17

shouldnt mcp_tool also have output_schema ?

### Prompt 18

"optional since MCP's tools/list doesn't provide it, so it'd be populated manually or via LLM analysis for Brain-registered
   tools." - then how do agents know what mcp tools return as results?

### Prompt 19

# NW-RESEARCH: Evidence-Driven Knowledge Research

**Wave**: CROSS_WAVE
**Agent**: Nova (nw-researcher)
**Command**: `*research`

## Overview

Systematic evidence-based research with source verification. Cross-wave support providing research-backed insights for any nWave phase using trusted academic|official|industry sources.

Optional `--skill-for={agent-name}` distills research into a practitioner-focused skill file for a specific agent.

## Context Files Required

- ~/.claude/nWave/data/co...

### Prompt 20

[Request interrupted by user]

### Prompt 21

# NW-RESEARCH: Evidence-Driven Knowledge Research

**Wave**: CROSS_WAVE
**Agent**: Nova (nw-researcher)
**Command**: `*research`

## Overview

Systematic evidence-based research with source verification. Cross-wave support providing research-backed insights for any nWave phase using trusted academic|official|industry sources.

Optional `--skill-for={agent-name}` distills research into a practitioner-focused skill file for a specific agent.

## Context Files Required

- ~/.claude/nWave/data/co...

### Prompt 22

[Request interrupted by user]

### Prompt 23

# NW-RESEARCH: Evidence-Driven Knowledge Research

**Wave**: CROSS_WAVE
**Agent**: Nova (nw-researcher)
**Command**: `*research`

## Overview

Systematic evidence-based research with source verification. Cross-wave support providing research-backed insights for any nWave phase using trusted academic|official|industry sources.

Optional `--skill-for={agent-name}` distills research into a practitioner-focused skill file for a specific agent.

## Context Files Required

- ~/.claude/nWave/data/co...

### Prompt 24

[Request interrupted by user for tool use]

### Prompt 25

what are u talking about ? it is literally defined right here in the spec: https://modelcontextprotocol.io/specification/2025-06-18/server/tools#output-schema

