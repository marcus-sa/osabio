# US-004: Worktree Manager Feature Flag

## Problem
Marcus is self-hosting Brain for a team that does not use git worktrees. The workspace settings UI shows a "Repository Path" configuration field that confuses his team members -- they don't know what it's for, and entering a wrong path could cause issues. He wants to hide this UI element unless the instance is explicitly configured for worktree management.

## Who
- Platform operator | Configuring a Brain instance for a specific team workflow | Wants clean UI without irrelevant features

## Solution
The `WORKTREE_MANAGER_ENABLED` environment variable controls visibility of the repository path configuration in workspace settings. When `false` (default), the repo path UI is hidden. When `true`, it is shown and the admin can configure repo paths per workspace.

## Job Traceability
- Job 3: Worktree Manager Feature Flag

## Domain Examples

### 1: Worktree UI hidden by default (Happy Path)
Marcus deploys Brain without setting `WORKTREE_MANAGER_ENABLED`. His team member Ana opens workspace settings and sees standard workspace configuration -- project name, description, etc. No repo path field is visible.

### 2: Worktree UI enabled for coding teams (Happy Path)
Kai deploys Brain for a coding team and sets `WORKTREE_MANAGER_ENABLED=true`. He opens workspace settings and sees the "Repository Path" field. He enters `/home/kai/projects/brain` and saves. The worktree manager now knows where to find the repo.

### 3: Flag does not affect backend (Boundary)
Marcus has `WORKTREE_MANAGER_ENABLED=false`. The MCP server still accepts worktree-related commands if invoked directly -- the flag only controls UI visibility, not backend capability.

## UAT Scenarios (BDD)

### Scenario: Repo path UI hidden when flag is false
Given the server is running with WORKTREE_MANAGER_ENABLED=false
When Ana opens workspace settings
Then the repository path configuration field is not visible

### Scenario: Repo path UI visible when flag is true
Given the server is running with WORKTREE_MANAGER_ENABLED=true
When Kai opens workspace settings
Then the repository path configuration field is visible
And Kai can enter a path value

### Scenario: Default behavior without flag set
Given the server is running without WORKTREE_MANAGER_ENABLED set
When Ana opens workspace settings
Then the repository path configuration field is not visible

### Scenario: Repo path can be saved per workspace
Given the server is running with WORKTREE_MANAGER_ENABLED=true
And Kai is in workspace "brain-dev"
When Kai sets the repository path to "/home/kai/projects/brain"
Then the path is saved for workspace "brain-dev"
And the path persists across page reloads

## Acceptance Criteria
- [ ] `WORKTREE_MANAGER_ENABLED` defaults to `false` when not set
- [ ] Repo path UI is hidden in workspace settings when flag is false
- [ ] Repo path UI is visible and functional when flag is true
- [ ] Repo path is stored per-workspace (not global)
- [ ] Flag controls UI visibility only -- no backend behavior change

## Technical Notes
- `ServerConfig.worktreeManagerEnabled` already defined in US-001
- The client needs access to the flag value -- expose via a config/feature-flags API endpoint or include in server-rendered page data
- Workspace `repo_path` field already exists (migration `0016_workspace_repo_path.surql`)
- This is a UI-only change -- the workspace repo_path API endpoints remain functional regardless of flag

## Dependencies
- US-001 (Self-Hosted Environment Configuration) -- provides `config.worktreeManagerEnabled`
- Migration 0016 (workspace repo_path field) -- already applied
