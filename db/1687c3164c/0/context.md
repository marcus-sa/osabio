# Session Context

## User Prompts

### Prompt 1

<system_instruction>
You are working inside Conductor, a Mac app that lets the user run many coding agents in parallel.
Your work should take place in the /Users/marcus/conductor/workspaces/brain-v1/los-angeles directory (unless otherwise directed), which has been set up for you to work in.
Each workspace has a .context directory (gitignored) where you can save files to collaborate with other agents.
The target branch for this workspace is main. Use this for actions like creating new PRs, bis...

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

Base directory for this skill: /Users/marcus/.claude/skills/nw-research

# NW-RESEARCH: Evidence-Driven Knowledge Research

**Wave**: CROSS_WAVE
**Agent**: Nova (nw-researcher)
**Command**: `*research`

## Overview

Systematic evidence-based research with source verification. Cross-wave support providing research-backed insights for any nWave phase using trusted academic|official|industry sources.

Optional `--skill-for={agent-name}` distills research into a practitioner-focused skill file fo...

### Prompt 4

what do we need this for "Brain’s BM25 triggers are orthogonal — they don’t affect the sandbox agent’s skill activation. BM25 is only useful for Brain’s own MCP context injection path (when Brain decides which skills to include in the MCP response)." ?

### Prompt 5

yes

### Prompt 6

Continue from where you left off.

### Prompt 7

"Governance happens at tool-call time, not skill-activation time. Brain can’t gate which skills the sandbox agent activates, but it controls which MCP tools are available and enforces policy at call time." well skills won't be injected unless they're assigned to the agent, so that is kind of irrelevant

### Prompt 8

we could theoretically still have skills in brain support files. surrealdb has built in support for file support
https://surrealdb.com/docs/surrealql/datamodel/files

would it be better to just store the skills as files in brain, and then update the files directly?

ofc we'd still extract description etc for metadata

### Prompt 9

we could theoretically still have skills in brain support scripts
. surrealdb has built in support for file support
https://surrealdb.com/docs/surrealql/datamodel/files

would it be better to just store the skills as files in brain, and then update the files directly?

ofc we'd still extract description etc for metadata

### Prompt 10

https://raw.githubusercontent.com/surrealdb/docs.surrealdb.com/refs/heads/main/src/content/doc-surrealql/datamodel/files.mdx

with this, we can download skills from skill.sh or github, store them as is, and then write them to the sdk

### Prompt 11

yes

### Prompt 12

what do we gain from storing the files themselves in our database? sandbox agent already supports downloading skills directly from github, local or git.
instead of storing the file contents themselves, we'd just store the sources.

compare pros/cons to these two approaches

### Prompt 13

option B is the quickest path to mvp. let's defer Brain-authored skills to later.

update original issue to reflect option B, and create a new issue for deferring
 Brain-authored skills to later

