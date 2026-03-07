# ADR-002: Git Worktree Isolation for Agent Tasks

## Status

Accepted

## Context

When a coding agent works on a task, it modifies files in a git repository. We need an isolation mechanism that:

- Prevents agent changes from affecting the main working tree
- Allows concurrent agents to work on different tasks without conflicts
- Produces clean diffs for human review
- Supports accept (merge) and reject (discard) workflows
- Works with OpenCode's `directory` parameter for session creation

## Decision

**Git worktrees**: Brain creates a git worktree per task at `.brain/worktrees/agent-{taskSlug}` on branch `agent/{taskSlug}`. The OpenCode client receives `directory: worktreePath` so the agent works entirely within the isolated worktree.

Lifecycle:
- **Assign**: `git worktree add .brain/worktrees/agent-{taskSlug} -b agent/{taskSlug}`
- **Diff for review**: `git diff main...agent/{taskSlug}` (natural consequence of branch-based isolation)
- **Accept**: `git merge agent/{taskSlug}` from main, then `git worktree remove` + `git branch -D`
- **Reject with feedback**: Agent continues in same worktree on same branch
- **Abort**: `git worktree remove --force` + `git branch -D agent/{taskSlug}`

The `.brain/worktrees/` directory is added to `.gitignore`.

## Alternatives Considered

### Alternative 1: Separate Clones

Create a full `git clone` per agent task.

- **Expected impact**: Complete isolation, zero risk of worktree locking issues
- **Why insufficient**: Full clone duplicates entire git history (disk-heavy for large repos). Clone time proportional to repo size -- could exceed <5s target for large repos. No shared object store -- wastes disk. Merging back requires remote operations (push/pull) instead of local branch merge.

### Alternative 2: Stash/Branch on Main Working Tree

Agent works directly in the main working tree, using `git stash` or branches without worktrees.

- **Expected impact**: Zero setup overhead, simplest possible approach
- **Why insufficient**: Only one agent can work at a time (working tree contention). User's uncommitted changes would conflict with agent work. No isolation -- agent errors could corrupt working tree state. `git stash` is fragile for complex multi-file changes.

### Alternative 3: Patch-Based (No Git Integration)

Agent works in a temp directory. Brain captures file diffs as patches.

- **Expected impact**: Maximum isolation from git state
- **Why insufficient**: Loses git history context (agent can't `git log`, `git blame`). Applying patches back is error-prone (context line mismatches). No incremental commits within agent session. OpenCode expects a git repository -- would need to init a fresh repo per task, losing project history.

### Alternative 4: Container-Scoped Filesystem

Mount repo as read-only in container, agent writes to overlay filesystem.

- **Expected impact**: True filesystem isolation
- **Why insufficient**: Requires Docker. Overlay diffs are filesystem-level, not semantic git diffs. Merge back requires translating filesystem changes to git operations. Excessive complexity for the isolation benefit. Same container concerns as ADR-001 Alternative 3.

## Consequences

### Positive

- **Disk efficient**: Worktrees share the git object store. Only the working tree files are duplicated.
- **Fast creation**: `git worktree add` is near-instant regardless of repo size (no clone/copy).
- **Natural diff**: `git diff main...agent/{taskSlug}` produces exactly the review diff needed. No event accumulation or custom diff logic.
- **Concurrent agents**: Multiple worktrees coexist without conflict. Each on its own branch.
- **OpenCode compatible**: OpenCode's `directory` parameter points directly to the worktree path. Agent sees a normal git repo.
- **Incremental commits**: Agent can commit within the worktree. Full commit history available for review.
- **Reject+continue**: On rejection, the worktree persists. Agent receives feedback and continues working on the same branch.

### Negative

- **Worktree locking**: Git allows only one worktree per branch. If cleanup fails, the branch is locked. Mitigation: force-remove on abort.
- **Filesystem cleanup**: Orphaned worktrees consume disk. Mitigation: startup cleanup scan matching `.brain/worktrees/agent-*` against active `agent_session` records.
- **Path validation**: Worktree paths must be validated to prevent path traversal. Mitigation: construct paths programmatically from sanitized task slugs, never from user input.
- **Branch naming collisions**: If the same task is reassigned, the branch name conflicts. Mitigation: append a short suffix (timestamp or counter) if branch already exists, or require prior cleanup.

### Path Convention

```
{repoRoot}/.brain/worktrees/agent-{taskSlug}/    -- worktree directory
agent/{taskSlug}                                   -- branch name
```

Where `taskSlug` is derived from the task title (lowercase, hyphenated, truncated to 50 chars) with the task record ID suffix for uniqueness.
