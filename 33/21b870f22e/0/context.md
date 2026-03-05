# Session Context

## User Prompts

### Prompt 1

<system_instruction>
You are working inside Conductor, a Mac app that lets the user run many coding agents in parallel.
Your work should take place in the /Users/marcus/conductor/workspaces/brain/victoria-v1 directory (unless otherwise directed), which has been set up for you to work in.
Each workspace has a .context directory (gitignored) where you can save files to collaborate with other agents.
The target branch for this workspace is main. Use this for actions like creating new PRs, bisect...

### Prompt 2

eliminate whats not needed

### Prompt 3

but it doesnt make sense to have these in repo settings:


  project_id?: string;
  project_name?: string;
  last_session?: string;
  session_id?: string;

a repo has multiple projects

### Prompt 4

does claude subagents trigger claude hooks?

### Prompt 5

hmm, the auto resolving projects etc doesnt make much sense. its up to the agent to know what to work on.
if it works on a predefined task, then ofc that might already be a part of a project.

### Prompt 6

summarize what has been changed

### Prompt 7

does the CLAUDE.md include instructions for agent on how to to map projects ?

### Prompt 8

yes

### Prompt 9

i also mean: instruct it how to map dirs in monorepo to projects
in a monolith, a submodule might be a project or feature
in a monorepo with microservices, a dir might be a project

### Prompt 10

commit changes

