# Session Context

## User Prompts

### Prompt 1

<system_instruction>
You are working inside Conductor, a Mac app that lets the user run many coding agents in parallel.
Your work should take place in the /Users/marcus/conductor/workspaces/brain/zagreb-v3 directory (unless otherwise directed), which has been set up for you to work in.
Each workspace has a .context directory (gitignored) where you can save files to collaborate with other agents.
The target branch for this workspace is main. Use this for actions like creating new PRs, bisectin...

### Prompt 2

<system_instruction>
The user has attached these files. Read them before proceeding.
- /Users/marcus/conductor/workspaces/brain/zagreb-v3/.context/attachments/PR instructions.md
</system_instruction>



Create a PR

### Prompt 3

this is wrong: {
    "id": "feature-within-existing-project",
    "input": "We need to add a notification system to handle alerts and digests.",
    "intent": "multi_allowed",
    "workspace_seed": [
      { "kind": "project", "text": "Atlas" }
    ],
    "expectedEntities": [
      { "kind": "feature", "text_contains": "notification system" }
    ],
    "forbiddenExtractedKinds": ["person"]
  },

notification system is a project, and alerts and digests are features belonging to that project...

### Prompt 4

there are many more wrong cases.
e.g "Atlas" doesnt seem liek a project, it seems like the name of the workspace

### Prompt 5

commit amned

