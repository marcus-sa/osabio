# Session Context

## User Prompts

### Prompt 1

<system_instruction>
You are working inside Conductor, a Mac app that lets the user run many coding agents in parallel.
Your work should take place in the /Users/marcus/conductor/workspaces/brain/manila directory (unless otherwise directed), which has been set up for you to work in.
Each workspace has a .context directory (gitignored) where you can save files to collaborate with other agents.
The target branch for this workspace is main. Use this for actions like creating new PRs, bisecting, ...

### Prompt 2

Commit and push all changes

### Prompt 3

instead of using a random number generator for ports, can we find a random unused port instead ?

### Prompt 4

or is there a way for us to refactor smoke test suite setup, so we don't have to run a bun server in another process?
we could start the server inline, or even better, in memory if possible?

as far as i am aware, its more than possible to return an in memory server instance and run fetch over it

