# Session Context

## User Prompts

### Prompt 1

<system_instruction>
You are working inside Conductor, a Mac app that lets the user run many coding agents in parallel.
Your work should take place in the /Users/marcus/conductor/workspaces/brain-v1/london directory (unless otherwise directed), which has been set up for you to work in.
Each workspace has a .context directory (gitignored) where you can save files to collaborate with other agents.
The target branch for this workspace is main. Use this for actions like creating new PRs, bisectin...

### Prompt 2

<system-instruction>
The user has added 2 comments to the diff for this workspace. Please review and address these comments as part of your response. When addressing comments on the "original" side or on specific commits, read the file from that version (not the current version). Below are the comments, including metadata about what git state they were left on:

Comment #1:

File: app/src/server/proxy/proxy-auth.ts
Line: 172
User comment: "**Cache TTL can outlive the token's actual DB expiry*...

### Prompt 3

Commit and push all changes

