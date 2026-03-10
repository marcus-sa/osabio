# Session Context

## User Prompts

### Prompt 1

<system_instruction>
You are working inside Conductor, a Mac app that lets the user run many coding agents in parallel.
Your work should take place in the /Users/marcus/conductor/workspaces/brain/dubai-v2 directory (unless otherwise directed), which has been set up for you to work in.
Each workspace has a .context directory (gitignored) where you can save files to collaborate with other agents.
The target branch for this workspace is main. Use this for actions like creating new PRs, bisecting...

### Prompt 2

whats the difference between the context pipeline and the evaluation pipeline ?

### Prompt 3

isnt there an overlap here? shouldn't the same endpoint do both these things?

### Prompt 4

write some docs

### Prompt 5

create github issue for "That said — there is a missed connection: the evaluation pipeline doesn’t use the resolved context to inform its risk assessment. If the evaluator knew “this agent is working on task X in project Y, and the file it wants to edit belongs to that project,” it could make better risk judgments. But that’s an enhancement to pipe context into evaluation, not a reason to merge the endpoints."

### Prompt 6

commit

