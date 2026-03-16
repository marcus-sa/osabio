# Session Context

## User Prompts

### Prompt 1

<system_instruction>
You are working inside Conductor, a Mac app that lets the user run many coding agents in parallel.
Your work should take place in the /Users/marcus/conductor/workspaces/brain-v1/seoul-v1 directory (unless otherwise directed), which has been set up for you to work in.
Each workspace has a .context directory (gitignored) where you can save files to collaborate with other agents.
The target branch for this workspace is main. Use this for actions like creating new PRs, bisect...

### Prompt 2

"Renamed $session → $sess in all SurrealDB bound parameters across 4 files. session is a protected variable in SurrealDB v3.0, which caused the RELATE $session->invoked->$trace query to fail after 3 retries, resulting in missing session edges. This fixes:" add this to learnings in AGENTS.md

