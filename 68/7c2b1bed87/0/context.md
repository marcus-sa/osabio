# Session Context

## User Prompts

### Prompt 1

<system_instruction>
You are working inside Conductor, a Mac app that lets the user run many coding agents in parallel.
Your work should take place in the /Users/marcus/conductor/workspaces/brain/budapest-v2 directory (unless otherwise directed), which has been set up for you to work in.
Each workspace has a .context directory (gitignored) where you can save files to collaborate with other agents.
The target branch for this workspace is main. Use this for actions like creating new PRs, bisect...

### Prompt 2

yes, sure

### Prompt 3

Continue from where you left off.

### Prompt 4

why do we need caching?

### Prompt 5

no, why arent we keeping the existing architecture where it writes to dir CLAUDE.md?

### Prompt 6

Continue from where you left off.

### Prompt 7

no, why arent we keeping the existing architecture where it writes maps to dir CLAUDE.md?

### Prompt 8

"Task tool additionalContext — but subagents already read the repo and directory CLAUDE.md files"

but is this better?

### Prompt 9

sure

### Prompt 10

[Request interrupted by user for tool use]

### Prompt 11

""
echo '{"tool_name":"Task","tool_input":{"prompt":"Fix the auth bug in /repo/services/auth"}}' | brain system pretooluse
# → JSON with additionalContext containing workspace projects
"""
why would we only load workspace projects here???

i mean come on, think for fuck sake

### Prompt 12

"subagents don’t have graph context. Giving them project names is useless." - is this only for subagents?

### Prompt 13

[Request interrupted by user for tool use]

### Prompt 14

"Walk upward from process.cwd() looking for CLAUDE.md files with <!-- brain-map-start --> markers"

why the fuck would it do this? doesn't claude already load these???

### Prompt 15

ok, so maybe it does need to traverse up directory to find and load the CLAUDE.md file. should we use our own file format instead?

what's the point of putting this in CLAUDE.md files then? we could just have .brain/config.json in the repo with all the mappings

or is there even a need to have mappings in version control? 

shouldn't our system be intelligent enough to map current dir / file to project / feature ?

### Prompt 16

[Request interrupted by user for tool use]

### Prompt 17

"BM25 search — search intent text across entity types (task titles, project names, decision summaries, etc.) using existing buildWorkspaceSearchSQL" is vector embedding search better?

### Prompt 18

[Request interrupted by user for tool use]

### Prompt 19

"SessionStart (brain system load-context):

Currently: calls getWorkspaceContext(), formats shallow overview
Change: calls new /context endpoint with { intent: "starting session", cwd: process.cwd() }
Gets full project context automatically when scope can be inferred"

is there any gain in"calls new /context endpoint with { intent: "starting session", cwd: process.cwd() }" ?

