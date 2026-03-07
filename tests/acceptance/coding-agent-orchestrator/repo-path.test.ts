/**
 * Workspace Repository Path: Assignment Guard and Lifecycle
 *
 * Traces: US-1 (set repo_path during creation), US-2 (prompt before assignment),
 *         US-3 (update repo_path)
 *
 * Validates that the orchestrator requires a valid repo_path on the workspace
 * before allowing task assignment, and that repo_path can be set during
 * workspace creation or updated later.
 *
 * Driving ports:
 *   POST /api/workspaces                           (create with repo_path)
 *   POST /api/workspaces/:ws/repo-path             (set/update repo_path)
 *   POST /api/orchestrator/:ws/assign              (blocked without repo_path)
 *   GET  /api/workspaces/:ws/bootstrap             (repo_path in response)
 */
import { describe, expect, it } from "bun:test";
import {
  setupOrchestratorSuite,
  createTestUser,
  createReadyTask,
  assignTaskToAgent,
  fetchRaw,
  fetchJson,
} from "./orchestrator-test-kit";

const getRuntime = setupOrchestratorSuite("repo_path");

// ---------------------------------------------------------------------------
// Helper: create workspace with optional repo_path
// ---------------------------------------------------------------------------

type TestWorkspace = { workspaceId: string; conversationId: string };

async function createWorkspaceWithRepoPath(
  baseUrl: string,
  user: { headers: Record<string, string> },
  options?: { repoPath?: string },
): Promise<TestWorkspace> {
  return fetchJson<TestWorkspace>(`${baseUrl}/api/workspaces`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...user.headers },
    body: JSON.stringify({
      name: `Repo Path Test ${Date.now()}`,
      ...(options?.repoPath ? { repoPath: options.repoPath } : {}),
    }),
  });
}

async function setRepoPath(
  baseUrl: string,
  user: { headers: Record<string, string> },
  workspaceId: string,
  path: string,
): Promise<Response> {
  return fetchRaw(`${baseUrl}/api/workspaces/${workspaceId}/repo-path`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...user.headers },
    body: JSON.stringify({ path }),
  });
}

// ---------------------------------------------------------------------------
// US-2: Assignment blocked when repo_path is missing
// ---------------------------------------------------------------------------

describe("Repo Path: Assignment guard requires repo_path", () => {
  it("rejects task assignment when workspace has no repo_path", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace created without a repo_path
    const user = await createTestUser(baseUrl, "repo-none");
    const workspace = await createWorkspaceWithRepoPath(baseUrl, user);
    const task = await createReadyTask(surreal, workspace.workspaceId, {
      title: "Build login page",
    });

    // When the user tries to assign the task to an agent
    const response = await fetchRaw(
      `${baseUrl}/api/orchestrator/${workspace.workspaceId}/assign`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...user.headers },
        body: JSON.stringify({ taskId: task.taskId }),
      },
    );

    // Then the assignment is rejected because repo_path is not configured
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("repo_path");
  }, 60_000);

  it("allows task assignment after repo_path is set", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace initially created without a repo_path
    const user = await createTestUser(baseUrl, "repo-set-later");
    const workspace = await createWorkspaceWithRepoPath(baseUrl, user);
    const task = await createReadyTask(surreal, workspace.workspaceId, {
      title: "Add search endpoint",
    });

    // And the user sets the repo_path to a valid git repository
    const repoPath = process.cwd(); // The test project itself is a git repo
    const setResponse = await setRepoPath(
      baseUrl,
      user,
      workspace.workspaceId,
      repoPath,
    );
    expect(setResponse.status).toBe(200);

    // When the user assigns the task to an agent
    const assignment = await assignTaskToAgent(
      baseUrl,
      user,
      workspace.workspaceId,
      task.taskId,
    );

    // Then the assignment succeeds
    expect(assignment.agentSessionId).toBeTruthy();
  }, 60_000);
});

// ---------------------------------------------------------------------------
// US-1: Set repo_path during workspace creation
// ---------------------------------------------------------------------------

describe("Repo Path: Set during workspace creation", () => {
  it("persists repo_path when provided during workspace creation", async () => {
    const { baseUrl } = getRuntime();

    // Given a valid git repository path
    const repoPath = process.cwd();
    const user = await createTestUser(baseUrl, "repo-create");

    // When the user creates a workspace with a repo_path
    const workspace = await createWorkspaceWithRepoPath(baseUrl, user, {
      repoPath,
    });

    // Then the workspace bootstrap response includes the repo_path
    const bootstrap = await fetchJson<{ repoPath?: string }>(
      `${baseUrl}/api/workspaces/${workspace.workspaceId}/bootstrap`,
      { headers: user.headers },
    );
    expect(bootstrap.repoPath).toBe(repoPath);
  }, 60_000);

  it("rejects workspace creation with an invalid repo_path", async () => {
    const { baseUrl } = getRuntime();

    // Given a path that is not a git repository
    const user = await createTestUser(baseUrl, "repo-invalid");

    // When the user creates a workspace with an invalid repo_path
    const response = await fetchRaw(`${baseUrl}/api/workspaces`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...user.headers },
      body: JSON.stringify({
        name: "Invalid Repo Test",
        repoPath: "/tmp/not-a-git-repo-" + Date.now(),
      }),
    });

    // Then creation is rejected because the path is not a valid git repo
    expect(response.status).toBe(400);
  }, 60_000);

  it("allows workspace creation without a repo_path", async () => {
    const { baseUrl } = getRuntime();

    // Given no repo_path is provided
    const user = await createTestUser(baseUrl, "repo-optional");

    // When the user creates a workspace without repo_path
    const workspace = await createWorkspaceWithRepoPath(baseUrl, user);

    // Then the workspace is created successfully
    expect(workspace.workspaceId).toBeTruthy();

    // And bootstrap response has no repoPath
    const bootstrap = await fetchJson<{ repoPath?: string }>(
      `${baseUrl}/api/workspaces/${workspace.workspaceId}/bootstrap`,
      { headers: user.headers },
    );
    expect(bootstrap.repoPath).toBeUndefined();
  }, 60_000);
});

// ---------------------------------------------------------------------------
// US-3: Update repo_path on existing workspace
// ---------------------------------------------------------------------------

describe("Repo Path: Update on existing workspace", () => {
  it("validates the path is a git repository when setting repo_path", async () => {
    const { baseUrl } = getRuntime();

    const user = await createTestUser(baseUrl, "repo-validate");
    const workspace = await createWorkspaceWithRepoPath(baseUrl, user);

    // When the user sets repo_path to a non-git directory
    const response = await setRepoPath(
      baseUrl,
      user,
      workspace.workspaceId,
      "/tmp/not-a-git-repo-" + Date.now(),
    );

    // Then the update is rejected
    expect(response.status).toBe(400);
  }, 60_000);

  it("validates the path exists when setting repo_path", async () => {
    const { baseUrl } = getRuntime();

    const user = await createTestUser(baseUrl, "repo-noexist");
    const workspace = await createWorkspaceWithRepoPath(baseUrl, user);

    // When the user sets repo_path to a nonexistent directory
    const response = await setRepoPath(
      baseUrl,
      user,
      workspace.workspaceId,
      "/nonexistent/path/that/does/not/exist",
    );

    // Then the update is rejected
    expect(response.status).toBe(400);
  }, 60_000);

  it("updates repo_path to a valid git repository", async () => {
    const { baseUrl } = getRuntime();

    const user = await createTestUser(baseUrl, "repo-update");
    const workspace = await createWorkspaceWithRepoPath(baseUrl, user);
    const repoPath = process.cwd();

    // When the user sets repo_path to a valid git repository
    const response = await setRepoPath(
      baseUrl,
      user,
      workspace.workspaceId,
      repoPath,
    );

    // Then the update succeeds
    expect(response.status).toBe(200);

    // And the bootstrap response reflects the updated path
    const bootstrap = await fetchJson<{ repoPath?: string }>(
      `${baseUrl}/api/workspaces/${workspace.workspaceId}/bootstrap`,
      { headers: user.headers },
    );
    expect(bootstrap.repoPath).toBe(repoPath);
  }, 60_000);
});
