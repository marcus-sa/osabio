# Session Context

## User Prompts

### Prompt 1

<system_instruction>
You are working inside Conductor, a Mac app that lets the user run many coding agents in parallel.
Your work should take place in the /Users/marcus/conductor/workspaces/brain/dubai-v2 directory (unless otherwise directed), which has been set up for you to work in.
Each workspace has a .context directory (gitignored) where you can save files to collaborate with other agents.
The target branch for this workspace is main. Use this for actions like creating new PRs, bisecting...

### Prompt 2

u can see it takes a long time, but im unsure which tests are taking that long:

2m 44s
Run bun test --concurrent --timeout=180000 --env-file=.env tests/acceptance/core/
bun test v1.3.10 (30e609e0)

tests/acceptance/core/priority.test.ts:

tests/acceptance/core/cli-init-auth.test.ts:

tests/acceptance/core/authority.test.ts:

tests/acceptance/core/extraction-quality.test.ts:

tests/acceptance/core/logging.test.ts:

tests/acceptance/core/graph-relationships.test.ts:

tests/acceptance/core/read...

