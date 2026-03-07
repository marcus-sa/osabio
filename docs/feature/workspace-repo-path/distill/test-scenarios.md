# Test Scenarios: Workspace Repository Path

## Acceptance Test File

`tests/acceptance/coding-agent-orchestrator/repo-path.test.ts`

## Scenarios

### Assignment Guard: repo_path Required

| # | Scenario | Given | When | Then | Status |
|---|----------|-------|------|------|--------|
| 1 | Block assignment without repo_path | Workspace with no repo_path, ready task | Assign task to agent | 400 with "repo_path" error | @pending |
| 2 | Allow assignment after repo_path set | Workspace with no repo_path, then set valid path | Assign task to agent | 200 with agentSessionId | @pending |

### Workspace Creation: Optional repo_path

| # | Scenario | Given | When | Then | Status |
|---|----------|-------|------|------|--------|
| 3 | Persist repo_path on creation | Valid git repo path | Create workspace with repoPath | Bootstrap includes repoPath | @pending |
| 4 | Reject invalid repo_path on creation | Non-git directory path | Create workspace with repoPath | 400 error | @pending |
| 5 | Allow creation without repo_path | No repoPath provided | Create workspace | 200, no repoPath in bootstrap | @pending |

### Update repo_path

| # | Scenario | Given | When | Then | Status |
|---|----------|-------|------|------|--------|
| 6 | Reject non-git path on update | Existing workspace | POST repo-path with non-git path | 400 error | @pending |
| 7 | Reject nonexistent path on update | Existing workspace | POST repo-path with bad path | 400 error | @pending |
| 8 | Accept valid git repo on update | Existing workspace | POST repo-path with valid git path | 200, bootstrap reflects path | @pending |

## Unit Tests (to be created during DELIVER)

| File | Coverage |
|------|----------|
| `tests/unit/coding-agent-orchestrator/assignment-guard.test.ts` | Add REPO_PATH_REQUIRED case |
| `tests/unit/coding-agent-orchestrator/routes.test.ts` | Add repo-path endpoint tests |

## Implementation Order

1. Schema migration (0016)
2. Assignment guard: REPO_PATH_REQUIRED check (unblocks scenario 1)
3. Workspace creation: parse + persist repoPath (unblocks scenarios 3-5)
4. Set repo-path endpoint (unblocks scenarios 6-8)
5. Wire per-workspace repoRoot into orchestrator (unblocks scenario 2)
6. UI: WorkspaceGuard form input + AgentStatusSection banner
