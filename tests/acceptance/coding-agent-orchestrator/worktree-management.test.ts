/**
 * Worktree Management: Git worktree create, diff, merge, remove
 *
 * Traces: US-0.1 (worktree creation on assign), US-2.1 (diff for review),
 *         US-2.2 (merge on accept), walking skeleton (abort removes worktree)
 *
 * Validates that each agent assignment creates an isolated git worktree,
 * diffs are available for review, and worktrees are cleaned up on
 * accept (merge) or abort (remove).
 *
 * Driving ports: POST /api/orchestrator/:ws/assign
 *                GET  /api/orchestrator/:ws/sessions/:id/review
 *                POST /api/orchestrator/:ws/sessions/:id/accept
 *                POST /api/orchestrator/:ws/sessions/:id/abort
 */
import { describe, expect, it } from "bun:test";
import {
  setupOrchestratorSuite,
  createTestUser,
  createTestWorkspace,
  createReadyTask,
  assignTaskToAgent,
  getSessionStatus,
  getReviewSummary,
  acceptAgentWork,
  abortAgentSession,
} from "./orchestrator-test-kit";

const getRuntime = setupOrchestratorSuite("worktree_management");

describe("Worktree Management: Isolation per agent assignment", () => {
  // -------------------------------------------------------------------------
  // Happy Path: Worktree created on assignment
  // -------------------------------------------------------------------------
  it.skip("creates a dedicated worktree branch when a task is assigned", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a task ready for agent work
    const user = await createTestUser(baseUrl, "wt-create");
    const workspace = await createTestWorkspace(baseUrl, user);
    const task = await createReadyTask(surreal, workspace.workspaceId, {
      title: "Add user profile page",
    });

    // When the task is assigned to an agent
    const assignment = await assignTaskToAgent(
      baseUrl,
      user,
      workspace.workspaceId,
      task.taskId,
    );

    // Then the session is created with a dedicated branch for the agent's work
    const status = await getSessionStatus(
      baseUrl,
      user,
      workspace.workspaceId,
      assignment.agentSessionId,
    );
    expect(status.worktreeBranch).toBeTruthy();
    expect(status.worktreeBranch).toContain("agent/");
  }, 60_000);

  // -------------------------------------------------------------------------
  // Happy Path: Each assignment gets its own worktree
  // -------------------------------------------------------------------------
  it.skip("creates separate worktrees for different task assignments", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given two tasks ready for agent work
    const user = await createTestUser(baseUrl, "wt-multi");
    const workspace = await createTestWorkspace(baseUrl, user);
    const task1 = await createReadyTask(surreal, workspace.workspaceId, {
      title: "Add email notifications",
    });
    const task2 = await createReadyTask(surreal, workspace.workspaceId, {
      title: "Add webhook support",
    });

    // When both tasks are assigned to agents
    const assignment1 = await assignTaskToAgent(
      baseUrl,
      user,
      workspace.workspaceId,
      task1.taskId,
    );
    const assignment2 = await assignTaskToAgent(
      baseUrl,
      user,
      workspace.workspaceId,
      task2.taskId,
    );

    // Then each agent works in its own isolated branch
    const status1 = await getSessionStatus(
      baseUrl,
      user,
      workspace.workspaceId,
      assignment1.agentSessionId,
    );
    const status2 = await getSessionStatus(
      baseUrl,
      user,
      workspace.workspaceId,
      assignment2.agentSessionId,
    );
    expect(status1.worktreeBranch).not.toBe(status2.worktreeBranch);
  }, 120_000);
});

describe("Worktree Management: Diff review", () => {
  // -------------------------------------------------------------------------
  // Happy Path: Review shows changes made by agent
  // -------------------------------------------------------------------------
  it.skip("shows files changed and diff statistics in the review", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a task where the agent has finished its work
    const user = await createTestUser(baseUrl, "wt-diff");
    const workspace = await createTestWorkspace(baseUrl, user);
    const task = await createReadyTask(surreal, workspace.workspaceId, {
      title: "Create API endpoint for users",
    });
    const assignment = await assignTaskToAgent(
      baseUrl,
      user,
      workspace.workspaceId,
      task.taskId,
    );

    // When the user reviews the agent's completed work
    const review = await getReviewSummary(
      baseUrl,
      user,
      workspace.workspaceId,
      assignment.agentSessionId,
    );

    // Then the review contains a list of files changed
    expect(review.diff).toBeDefined();
    expect(review.diff.files).toBeInstanceOf(Array);
    expect(review.diff.stats).toBeDefined();
    expect(typeof review.diff.stats.filesChanged).toBe("number");
    expect(typeof review.diff.stats.insertions).toBe("number");
    expect(typeof review.diff.stats.deletions).toBe("number");

    // And the review includes the raw diff for detailed inspection
    expect(typeof review.diff.rawDiff).toBe("string");
  }, 60_000);

  // -------------------------------------------------------------------------
  // Happy Path: Review includes session activity summary
  // -------------------------------------------------------------------------
  it.skip("includes session activity in the review", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given completed agent work
    const user = await createTestUser(baseUrl, "wt-summary");
    const workspace = await createTestWorkspace(baseUrl, user);
    const task = await createReadyTask(surreal, workspace.workspaceId, {
      title: "Implement caching layer",
    });
    const assignment = await assignTaskToAgent(
      baseUrl,
      user,
      workspace.workspaceId,
      task.taskId,
    );

    // When the user reviews the work
    const review = await getReviewSummary(
      baseUrl,
      user,
      workspace.workspaceId,
      assignment.agentSessionId,
    );

    // Then the review shows how long the agent worked and what it did
    expect(review.session).toBeDefined();
    expect(review.session.orchestratorStatus).toBeTruthy();

    // And the task title is included for context
    expect(review.taskTitle).toBe("Implement caching layer");
  }, 60_000);
});

describe("Worktree Management: Cleanup on accept and abort", () => {
  // -------------------------------------------------------------------------
  // Happy Path: Merge on accept
  // -------------------------------------------------------------------------
  it.skip("merges the agent's branch when work is accepted", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given completed agent work on a task
    const user = await createTestUser(baseUrl, "wt-merge");
    const workspace = await createTestWorkspace(baseUrl, user);
    const task = await createReadyTask(surreal, workspace.workspaceId, {
      title: "Add input sanitization",
    });
    const assignment = await assignTaskToAgent(
      baseUrl,
      user,
      workspace.workspaceId,
      task.taskId,
    );

    // When the user accepts the work
    const result = await acceptAgentWork(
      baseUrl,
      user,
      workspace.workspaceId,
      assignment.agentSessionId,
    );

    // Then the work is accepted and the agent's branch is merged
    expect(result.accepted).toBe(true);

    // And the session no longer appears in active sessions
    const { listActiveSessions } = await import("./orchestrator-test-kit");
    const sessions = await listActiveSessions(
      baseUrl,
      user,
      workspace.workspaceId,
    );
    const found = sessions.find(
      (s) => s.agentSessionId === assignment.agentSessionId,
    );
    expect(found).toBeUndefined();
  }, 60_000);

  // -------------------------------------------------------------------------
  // Happy Path: Remove on abort
  // -------------------------------------------------------------------------
  it.skip("removes the agent's branch when the session is aborted", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given an active agent session
    const user = await createTestUser(baseUrl, "wt-abort");
    const workspace = await createTestWorkspace(baseUrl, user);
    const task = await createReadyTask(surreal, workspace.workspaceId, {
      title: "Refactor error handling",
    });
    const assignment = await assignTaskToAgent(
      baseUrl,
      user,
      workspace.workspaceId,
      task.taskId,
    );

    // When the user aborts the agent session
    const result = await abortAgentSession(
      baseUrl,
      user,
      workspace.workspaceId,
      assignment.agentSessionId,
    );

    // Then the agent's work is discarded and the branch is removed
    expect(result.aborted).toBe(true);

    // And no active sessions remain for that task
    const { listActiveSessions } = await import("./orchestrator-test-kit");
    const sessions = await listActiveSessions(
      baseUrl,
      user,
      workspace.workspaceId,
    );
    const found = sessions.find(
      (s) => s.agentSessionId === assignment.agentSessionId,
    );
    expect(found).toBeUndefined();
  }, 60_000);

  // -------------------------------------------------------------------------
  // Error Path: Review not available for aborted sessions
  // -------------------------------------------------------------------------
  it.skip("review is not available for an aborted session", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given an agent session that was aborted
    const user = await createTestUser(baseUrl, "wt-no-review");
    const workspace = await createTestWorkspace(baseUrl, user);
    const task = await createReadyTask(surreal, workspace.workspaceId, {
      title: "Build dashboard widgets",
    });
    const assignment = await assignTaskToAgent(
      baseUrl,
      user,
      workspace.workspaceId,
      task.taskId,
    );
    await abortAgentSession(
      baseUrl,
      user,
      workspace.workspaceId,
      assignment.agentSessionId,
    );

    // When the user tries to review the aborted session
    const { fetchRaw } = await import("./orchestrator-test-kit");
    const response = await fetchRaw(
      `${baseUrl}/api/orchestrator/${workspace.workspaceId}/sessions/${assignment.agentSessionId}/review`,
      { headers: user.headers },
    );

    // Then the review is not available because the work was discarded
    expect(response.status).toBe(404);
  }, 60_000);
});
