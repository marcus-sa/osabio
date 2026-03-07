# Architecture Design: Workspace Repository Path

## Problem

The coding agent orchestrator creates git worktrees for task isolation, but `repoRoot` is hardcoded to `process.cwd()` in `start-server.ts:71`. This means:
- Every workspace assumes the same repo (the server's working directory)
- Multi-workspace setups pointing at different repos are impossible
- There's no UI for the user to specify which repo a workspace operates on

## Decision: Per-Workspace `repo_path`

Store `repo_path` as an optional field on the workspace entity. Resolve it at assignment time instead of at server startup.

### Quality Attributes

| Attribute | Priority | How addressed |
|-----------|----------|---------------|
| Correctness | High | Each workspace targets the right repo |
| Simplicity | High | Single field addition, follows existing patterns |
| Fail-fast | High | Assignment guard rejects early if repo_path missing or invalid |

## Component Boundaries

This feature touches 6 existing layers. No new components are introduced.

```
┌─────────────────────────────────────────────────────────┐
│ Client                                                   │
│                                                          │
│  WorkspaceGuard.tsx ── repo_path text input (creation)   │
│  use-workspace.ts  ── pass repo_path in create request   │
│  AgentStatusSection ── show banner if repo_path missing  │
│                                                          │
├─────────────────────────────────────────────────────────┤
│ Shared Contracts                                         │
│                                                          │
│  CreateWorkspaceRequest  ── add repoPath?: string        │
│  WorkspaceBootstrapResponse ── add repoPath?: string     │
│                                                          │
├─────────────────────────────────────────────────────────┤
│ Server: Workspace                                        │
│                                                          │
│  parsing.ts          ── validate repoPath in parser      │
│  workspace-routes.ts ── persist repo_path on CREATE      │
│                      ── new: validate-repo-path endpoint │
│                      ── new: update-repo-path endpoint   │
│                                                          │
├─────────────────────────────────────────────────────────┤
│ Server: Orchestrator                                     │
│                                                          │
│  assignment-guard.ts ── add REPO_PATH_REQUIRED check     │
│  session-lifecycle.ts ── read repo_path from workspace   │
│  routes.ts / wiring  ── remove static repoRoot, resolve  │
│                         per-workspace from DB             │
│                                                          │
├─────────────────────────────────────────────────────────┤
│ Schema                                                   │
│                                                          │
│  Migration 0018: DEFINE FIELD repo_path ON workspace     │
│                  TYPE option<string>                      │
│                                                          │
├─────────────────────────────────────────────────────────┤
│ Runtime                                                  │
│                                                          │
│  start-server.ts ── keep process.cwd() as fallback for   │
│                     non-orchestrator routes only          │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

## C4 Container Diagram

```mermaid
C4Container
  title Workspace Repo Path - Container View

  Person(user, "User", "Creates workspaces, assigns tasks to agents")

  Container_Boundary(browser, "Browser") {
    Component(guard, "WorkspaceGuard", "React", "Workspace creation form with repo_path input")
    Component(agent_ui, "AgentStatusSection", "React", "Shows assign button or repo_path banner")
  }

  Container_Boundary(server, "Brain Server (Bun)") {
    Component(ws_routes, "Workspace Routes", "TypeScript", "Create workspace, validate/update repo_path")
    Component(orch_guard, "Assignment Guard", "TypeScript", "Validates repo_path set before assignment")
    Component(orch_lifecycle, "Session Lifecycle", "TypeScript", "Reads repo_path from workspace for worktree ops")
    Component(worktree, "Worktree Manager", "TypeScript", "git worktree add/remove/diff using repo_path")
  }

  ContainerDb(surreal, "SurrealDB", "workspace.repo_path")
  Container_Ext(git, "Git CLI", "Worktree operations + repo validation")

  Rel(user, guard, "Creates workspace with repo_path")
  Rel(user, agent_ui, "Assigns task to agent")
  Rel(guard, ws_routes, "POST /api/workspaces")
  Rel(agent_ui, orch_guard, "POST /api/orchestrator/:ws/assign")
  Rel(ws_routes, surreal, "CREATE workspace SET repo_path")
  Rel(ws_routes, git, "git rev-parse --git-dir (validation)")
  Rel(orch_guard, surreal, "SELECT repo_path FROM workspace")
  Rel(orch_lifecycle, worktree, "createWorktree(repoPath, ...)")
  Rel(worktree, git, "git worktree add/remove/diff")
```

## C4 Component Diagram: Data Flow

```mermaid
sequenceDiagram
  participant U as User
  participant UI as WorkspaceGuard
  participant API as Workspace Routes
  participant DB as SurrealDB
  participant Git as Git CLI

  Note over U,Git: Path 1: Set repo_path during workspace creation
  U->>UI: Fill name + repo_path
  UI->>API: POST /api/workspaces {name, repoPath}
  API->>Git: git -C <path> rev-parse --git-dir
  Git-->>API: exit 0 (valid)
  API->>DB: CREATE workspace SET repo_path = $path
  API-->>UI: 200 {workspaceId, ...}

  Note over U,Git: Path 2: Set repo_path later (before first assignment)
  U->>UI: Click "Assign Agent" (repo_path missing)
  UI-->>U: Show "Set repository path" prompt
  U->>API: POST /api/workspaces/:ws/repo-path {path}
  API->>Git: git -C <path> rev-parse --git-dir
  Git-->>API: exit 0
  API->>DB: UPDATE workspace SET repo_path = $path
  API-->>UI: 200 {valid: true}

  Note over U,Git: Path 3: Assignment reads repo_path from workspace
  U->>API: POST /api/orchestrator/:ws/assign {taskId}
  API->>DB: SELECT repo_path FROM workspace:$ws
  DB-->>API: repo_path = "/Users/marcus/myproject"
  API->>Git: git worktree add (using workspace repo_path)
```

## Change Inventory

### 1. Schema Migration (`0018_workspace_repo_path.surql`)

```sql
BEGIN TRANSACTION;
DEFINE FIELD OVERWRITE repo_path ON workspace TYPE option<string>;
COMMIT TRANSACTION;
```

### 2. Shared Contracts (`contracts.ts`)

```typescript
// Add to CreateWorkspaceRequest
export type CreateWorkspaceRequest = {
  name: string;
  description?: string;
  repoPath?: string;       // <-- new
};

// Add to WorkspaceBootstrapResponse
export type WorkspaceBootstrapResponse = {
  // ... existing fields ...
  repoPath?: string;        // <-- new
};
```

### 3. Server: Repo Path Validation

New function in `workspace-routes.ts`:

```typescript
async function validateRepoPath(path: string, shellExec: ShellExec): Promise<boolean> {
  const result = await shellExec("git", ["-C", path, "rev-parse", "--git-dir"], path);
  return result.exitCode === 0;
}
```

### 4. Server: New Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/workspaces/:workspaceId/repo-path` | Set/update repo_path with validation |

Request: `{ path: string }`
Response: `{ valid: true }` or `400 { error: "..." }`

### 5. Assignment Guard: New Check

Add between step 3 (workspace membership) and step 4 (status eligibility):

```
3.5. Repo path configured — workspace.repo_path must be a non-empty string
     Error: REPO_PATH_REQUIRED (400)
```

### 6. Orchestrator Wiring: Per-Workspace Resolution

`wireOrchestratorRoutes` currently takes a static `repoRoot: string`. Change `createSession` to:
1. Read `repo_path` from workspace record (already fetched in assignment guard)
2. Pass it as `repoRoot` to session lifecycle
3. Remove static `repoRoot` from `OrchestratorWiringDeps`

### 7. UI: WorkspaceGuard Form

Add text input for "Repository path" below description textarea. Optional, with placeholder showing example path format.

### 8. UI: AgentStatusSection Banner

When task is assignable but workspace has no `repo_path`, show:
> "Set a repository path for this workspace before assigning tasks to agents."
> [Set Repository Path] button

## Risks

| Risk | Mitigation |
|------|------------|
| Path becomes stale (repo moved/deleted) | Validate at assignment time, not just at save time |
| Path traversal / injection | Validate path is absolute, exists, and passes `git rev-parse` |
| Active sessions during path change | Block repo_path updates while any orchestrator session is active |
