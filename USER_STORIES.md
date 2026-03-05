# User Stories

---

## CLI Init Command (#88)

### US-S1: One-command Brain integration for any repo

**As a** developer adding Brain to a project,
**I want** `brain init` to configure everything (auth, MCP, hooks, CLAUDE.md, skills, git hooks),
**So that** I don't have to manually wire up each piece.

#### Acceptance Criteria

- [ ] Running `brain init` with `BRAIN_WORKSPACE_ID` set completes all 6 steps (auth, MCP, hooks, CLAUDE.md, skills, git hooks)
- [ ] After init, starting a new Claude Code session shows Brain MCP tools available
- [ ] After init, the SessionStart hook fires and loads project context
- [ ] Output prints a status line for each step

### US-S2: Per-repo credentials at `~/.brain/config.json`

**As a** developer working across multiple repos with different Brain workspaces,
**I want** each repo to have its own API key and workspace mapping,
**So that** the correct credentials are used automatically based on which repo I'm in.

#### Acceptance Criteria

- [ ] `brain init` in repo A with workspace X writes `repos["/path/to/repo-a"]` to `~/.brain/config.json`
- [ ] `brain init` in repo B with workspace Y adds `repos["/path/to/repo-b"]` without overwriting repo A's entry
- [ ] Running `brain system load-context` in repo A uses repo A's credentials
- [ ] Running `brain system load-context` in repo B uses repo B's credentials

### US-S3: MCP server registration in `.mcp.json`

**As a** developer running `brain init`,
**I want** the Brain MCP server registered in `.mcp.json`,
**So that** Claude Code discovers and starts it automatically.

#### Acceptance Criteria

- [ ] Creates `.mcp.json` with `mcpServers.brain` if file doesn't exist
- [ ] Preserves existing MCP servers in the file
- [ ] Entry uses `{ "command": "brain", "args": ["mcp"] }`

### US-S4: Claude Code hooks merged non-destructively

**As a** developer whose project already has hooks from other tools,
**I want** `brain init` to add Brain hooks without removing existing ones,
**So that** other tools continue to work.

#### Acceptance Criteria

- [ ] Brain hooks (SessionStart, UserPromptSubmit, Stop, SessionEnd) added to `.claude/settings.json`
- [ ] Existing hooks from other tools preserved
- [ ] Running `brain init` twice does not duplicate Brain hook entries

### US-S5: CLAUDE.md plugin instructions are idempotent

**As a** developer re-running `brain init` after an update,
**I want** the Brain section in CLAUDE.md to be replaced (not duplicated),
**So that** instructions stay current without manual cleanup.

#### Acceptance Criteria

- [ ] First run appends Brain instructions wrapped in `<!-- brain-plugin-start -->` / `<!-- brain-plugin-end -->` markers
- [ ] Second run replaces content between markers
- [ ] Existing CLAUDE.md content outside markers is untouched

### US-S6: Skills installed to `.claude/commands/`

**As a** developer using Brain with Claude Code,
**I want** Brain skills available as slash commands,
**So that** I can invoke `/brain-start-task` and `/brain-status` without manual setup.

#### Acceptance Criteria

- [ ] `brain init` creates `brain-start-task.md` and `brain-status.md` in `.claude/commands/`
- [ ] Skills are usable as `/brain-start-task <task_id>` and `/brain-status` in Claude Code

### US-S7: Git pre-commit hook installed

**As a** developer committing code in a Brain-connected repo,
**I want** a pre-commit hook that checks for task completions and constraint violations,
**So that** commits are validated against the knowledge graph.

#### Acceptance Criteria

- [ ] Installs `.git/hooks/pre-commit` running `brain check-commit`
- [ ] Does not overwrite existing pre-commit hooks from other tools
- [ ] Removes legacy Brain post-commit hooks

---

## Chat Deep-Linking (#86)

## US-1: Persist active conversation in URL

**As a** user chatting in Brain,
**I want** the URL to reflect which conversation I'm viewing,
**So that** refreshing the page doesn't lose my place.

### Acceptance Criteria

- [ ] Navigating to `/chat` shows a new/empty conversation
- [ ] Sending the first message in a new conversation updates the URL to `/chat/<conversationId>` (without adding a back-button entry)
- [ ] Clicking a conversation in the sidebar updates the URL to `/chat/<conversationId>`
- [ ] Refreshing the browser on `/chat/<conversationId>` reloads that conversation with all messages

## US-2: Browser history navigation between conversations

**As a** user switching between conversations,
**I want** the browser back/forward buttons to navigate between them,
**So that** I can return to a previous conversation without the sidebar.

### Acceptance Criteria

- [ ] Selecting conversation A, then conversation B, then pressing Back returns to conversation A
- [ ] Pressing Forward after Back returns to conversation B
- [ ] Starting a new conversation (`/chat`) and pressing Back returns to the previous conversation

## US-3: Deep-link to a specific message

**As a** user viewing an entity in the graph,
**I want** "Jump to message" to take me to the exact message in its conversation,
**So that** I can see the original context where an entity was extracted.

### Acceptance Criteria

- [ ] "Jump to message" in the entity detail provenance section navigates to `/chat/<conversationId>?message=<messageId>`
- [ ] The target message scrolls into view and receives a highlight animation
- [ ] Visiting `/chat/<conversationId>?message=<messageId>` directly (e.g. from a bookmark) loads the conversation and scrolls to the message
- [ ] If the message ID doesn't exist in the conversation, the conversation loads normally (no error)

## US-4: Branching preserves URL

**As a** user branching from a message,
**I want** the URL to update to the new branch conversation,
**So that** refreshing keeps me on the branch.

### Acceptance Criteria

- [ ] Clicking "Branch from here" on an assistant message creates the branch and updates URL to `/chat/<branchId>`
- [ ] Refreshing on the branch URL reloads the branch with inherited + own messages

## US-5: Invalid conversation URL

**As a** user who visits an invalid or stale conversation URL,
**I want** to be redirected gracefully,
**So that** I'm not stuck on a broken page.

### Acceptance Criteria

- [ ] Visiting `/chat/<nonexistent-id>` redirects to `/chat` with an error message displayed
- [ ] The error message is visible but non-blocking (can still start a new conversation)

## US-6: New conversation resets URL

**As a** user clicking "New conversation",
**I want** the URL to return to `/chat`,
**So that** the URL accurately reflects that no conversation is selected.

### Acceptance Criteria

- [ ] Clicking "New conversation" in the sidebar navigates to `/chat`
- [ ] Messages are cleared, input is ready for a fresh conversation

## US-7: Discuss entity resets chat state on route transitions

**As a** user pressing "Discuss" on an entity,
**I want** to always land on a fresh `/chat` with that entity context,
**So that** the discussion starts cleanly without leftover conversation state.

### Acceptance Criteria

- [ ] Pressing "Discuss" on an entity while on `/chat/<id>` navigates to `/chat`, clears the previous conversation messages, and shows the entity card at the top
- [ ] Navigating from `/chat` (with a discuss entity) to an existing `/chat/<id>` via the sidebar clears the discuss entity card — the existing conversation loads without stale discuss context
- [ ] Pressing "Discuss" on an entity while on `/chat` (no active conversation) shows the entity card and keeps the chat ready for a new message

## US-8: Chat agent treats user domain as business content, not Brain internals

**As a** user describing my business domain in Brain,
**I want** the chat agent to capture my concepts as graph entities,
**So that** it never confuses my domain model with Brain's own architecture — even when terms overlap.

### Acceptance Criteria

- [ ] Describing a hierarchy (e.g. "I want entities: Initiative -> Project -> Feature -> Task") triggers the PM agent to plan work items — the agent does not explain Brain's data model
- [ ] Using terms like "entities", "graph", "features", or "tasks" in a business context creates entities in the graph rather than prompting clarification about Brain internals
- [ ] The agent only explains Brain's architecture when explicitly asked (e.g. "How does Brain work?" or "What entity types does Brain support?")

---

## Directory-to-Entity Mapping (#97)

### US-M1: Map a directory to a brain project

**As a** developer working in a monorepo,
**I want** to map a directory to a brain project,
**So that** any coding agent working in that directory automatically loads the project's decisions, tasks, and constraints.

#### Acceptance Criteria

- [ ] `brain map ./services/auth project:abc123` creates/updates CLAUDE.md in the target directory with brain-map markers
- [ ] Entity is validated against the server (rejects invalid or out-of-scope IDs)
- [ ] Template includes "On first access" instruction to call `get_project_context`
- [ ] Re-running the same command updates idempotently (content between markers replaced, not duplicated)

### US-M2: Map a directory to a brain feature with parent project

**As a** developer organizing code by features,
**I want** to map a subdirectory to a brain feature with its parent project embedded,
**So that** agents get both feature scope and project context without extra lookups.

#### Acceptance Criteria

- [ ] `brain map ./services/auth/oauth feature:def456 --project abc123` writes CLAUDE.md with both feature and project IDs
- [ ] Template instructs agents to call `get_project_context` with the embedded project ID on first access
- [ ] Decisions/questions are scoped with `context: { project, feature }`

### US-M3: Map a directory to a brain feature without parent project

**As a** developer mapping a feature directory when the parent project isn't known,
**I want** the mapping to work without `--project`,
**So that** agents can resolve the parent project at runtime via MCP tools.

#### Acceptance Criteria

- [ ] `brain map ./services/auth/oauth feature:def456` succeeds without `--project`
- [ ] Template instructs agents to call `get_entity_detail` first to resolve the parent project, then `get_project_context`

### US-M4: Unmap a directory

**As a** developer who no longer needs a directory mapping,
**I want** to remove the brain mapping without affecting other CLAUDE.md content,
**So that** the directory returns to its default (unmapped) state.

#### Acceptance Criteria

- [ ] `brain unmap ./services/auth` removes the brain-map marker block from CLAUDE.md
- [ ] Other content in CLAUDE.md outside the markers is preserved
- [ ] If CLAUDE.md is empty after removing the block, the file is deleted

### US-M5: Agents auto-map directories during work

**As a** coding agent working in a Brain-connected repo,
**I want** instructions in CLAUDE.md to tell me to persist directory mappings when I confidently identify a match,
**So that** future agents entering the same directory don't have to rediscover the entity scope.

#### Acceptance Criteria

- [ ] `brain init` CLAUDE.md includes "Directory Mapping" section with auto-mapping instructions
- [ ] Agent checks for `<!-- brain-map-start -->` marker before mapping (avoids overwriting)
- [ ] Agent only maps when the match is confident, not speculative
- [ ] Agent runs `brain map <dir> <type>:<id>` via shell to persist the mapping

### US-M6: Hierarchical context composition via CLAUDE.md loading

**As a** coding agent working in a feature subdirectory,
**I want** to inherit the parent project's context via Claude Code's ancestor CLAUDE.md loading,
**So that** I get both project-level decisions/constraints and feature-level scope automatically.

#### Acceptance Criteria

- [ ] Agent in `auth/` loads both project CLAUDE.md (ancestor) and feature CLAUDE.md (current dir)
- [ ] Project context provides decisions and constraints; feature context provides entity scope
- [ ] Different markers (`brain-map-start/end`) don't conflict with init markers (`brain-plugin-start/end`)
