/**
 * Review Flow: Diff Review, Accept, Reject with Feedback
 *
 * Traces: US-2.1 (review agent output), US-2.2 (accept),
 *         US-2.3 (reject and provide feedback)
 *
 * Validates the complete review cycle: user views the diff and session
 * summary, then either accepts the work (merging changes) or rejects it
 * with feedback (agent resumes incorporating the feedback).
 *
 * Driving ports: GET  /api/orchestrator/:ws/sessions/:id/review
 *                POST /api/orchestrator/:ws/sessions/:id/accept
 *                POST /api/orchestrator/:ws/sessions/:id/reject
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
  rejectWithFeedback,
  getTaskStatus,
  fetchRaw,
} from "./orchestrator-test-kit";

const getRuntime = setupOrchestratorSuite("review_flow");

describe("Review Flow: Viewing agent work for review", () => {
  // -------------------------------------------------------------------------
  // Happy Path: Review shows diff and session summary
  // US-2.1
  // -------------------------------------------------------------------------
  it.skip("review provides diff summary and agent activity trace", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a task where the agent has completed its work
    const user = await createTestUser(baseUrl, "review-view");
    const workspace = await createTestWorkspace(baseUrl, user);
    const task = await createReadyTask(surreal, workspace.workspaceId, {
      title: "Add password strength indicator",
      description: "Show a visual indicator of password strength during registration",
    });
    const assignment = await assignTaskToAgent(
      baseUrl,
      user,
      workspace.workspaceId,
      task.taskId,
    );

    // When the user views the review for the completed work
    const review = await getReviewSummary(
      baseUrl,
      user,
      workspace.workspaceId,
      assignment.agentSessionId,
    );

    // Then the review shows which files were changed
    expect(review.diff).toBeDefined();
    expect(review.diff.files).toBeInstanceOf(Array);
    for (const file of review.diff.files) {
      expect(file.path).toBeTruthy();
      expect(["added", "modified", "deleted"]).toContain(file.status);
      expect(typeof file.additions).toBe("number");
      expect(typeof file.deletions).toBe("number");
    }

    // And the review shows overall change statistics
    expect(typeof review.diff.stats.filesChanged).toBe("number");

    // And the review includes a trace of the agent's session activity
    expect(review.session).toBeDefined();
    expect(review.session.orchestratorStatus).toBeTruthy();

    // And the review identifies the task that was worked on
    expect(review.taskTitle).toBe("Add password strength indicator");
  }, 60_000);

  // -------------------------------------------------------------------------
  // Happy Path: Review shows the branch name for manual inspection
  // US-2.1
  // -------------------------------------------------------------------------
  it.skip("session status includes the branch name for manual code inspection", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a task with completed agent work
    const user = await createTestUser(baseUrl, "review-branch");
    const workspace = await createTestWorkspace(baseUrl, user);
    const task = await createReadyTask(surreal, workspace.workspaceId, {
      title: "Refactor database connection pool",
    });
    const assignment = await assignTaskToAgent(
      baseUrl,
      user,
      workspace.workspaceId,
      task.taskId,
    );

    // When the user checks the session details
    const status = await getSessionStatus(
      baseUrl,
      user,
      workspace.workspaceId,
      assignment.agentSessionId,
    );

    // Then the branch name is available for manual code inspection
    expect(status.worktreeBranch).toBeTruthy();
  }, 60_000);
});

describe("Review Flow: Accepting agent work", () => {
  // -------------------------------------------------------------------------
  // Happy Path: Accept merges changes and completes task
  // US-2.2
  // -------------------------------------------------------------------------
  it.skip("accepting work marks the task as done and completes the session", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given completed agent work ready for review
    const user = await createTestUser(baseUrl, "review-accept");
    const workspace = await createTestWorkspace(baseUrl, user);
    const task = await createReadyTask(surreal, workspace.workspaceId, {
      title: "Add health check endpoint",
    });
    const assignment = await assignTaskToAgent(
      baseUrl,
      user,
      workspace.workspaceId,
      task.taskId,
    );

    // When the user accepts the agent's work
    const result = await acceptAgentWork(
      baseUrl,
      user,
      workspace.workspaceId,
      assignment.agentSessionId,
    );

    // Then the work is accepted
    expect(result.accepted).toBe(true);

    // And the task is marked as done
    const taskStatus = await getTaskStatus(surreal, task.taskId);
    expect(taskStatus).toBe("done");

    // And the agent session is marked as completed
    const status = await getSessionStatus(
      baseUrl,
      user,
      workspace.workspaceId,
      assignment.agentSessionId,
    );
    expect(status.orchestratorStatus).toBe("completed");
  }, 60_000);

  // -------------------------------------------------------------------------
  // Error Path: Cannot accept an already-aborted session
  // -------------------------------------------------------------------------
  it.skip("cannot accept work from an aborted session", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a session that was already aborted
    const user = await createTestUser(baseUrl, "review-aborted");
    const workspace = await createTestWorkspace(baseUrl, user);
    const task = await createReadyTask(surreal, workspace.workspaceId, {
      title: "Add data export feature",
    });
    const assignment = await assignTaskToAgent(
      baseUrl,
      user,
      workspace.workspaceId,
      task.taskId,
    );

    const { abortAgentSession } = await import("./orchestrator-test-kit");
    await abortAgentSession(
      baseUrl,
      user,
      workspace.workspaceId,
      assignment.agentSessionId,
    );

    // When the user tries to accept the aborted session
    const response = await fetchRaw(
      `${baseUrl}/api/orchestrator/${workspace.workspaceId}/sessions/${assignment.agentSessionId}/accept`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...user.headers },
      },
    );

    // Then the accept is rejected because the work was already discarded
    expect(response.status).toBe(409);
  }, 60_000);

  // -------------------------------------------------------------------------
  // Error Path: Cannot accept a nonexistent session
  // -------------------------------------------------------------------------
  it.skip("cannot accept work from a nonexistent session", async () => {
    const { baseUrl } = getRuntime();

    // Given a session identifier that does not exist
    const user = await createTestUser(baseUrl, "review-noexist");
    const workspace = await createTestWorkspace(baseUrl, user);

    // When the user tries to accept a nonexistent session
    const response = await fetchRaw(
      `${baseUrl}/api/orchestrator/${workspace.workspaceId}/sessions/nonexistent-session/accept`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...user.headers },
      },
    );

    // Then the request fails because no matching session was found
    expect(response.status).toBe(404);
  }, 30_000);
});

describe("Review Flow: Rejecting with feedback", () => {
  // -------------------------------------------------------------------------
  // Happy Path: Rejection sends feedback, agent resumes
  // US-2.3
  // -------------------------------------------------------------------------
  it.skip("rejecting with feedback returns the task to in-progress and the agent continues", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given completed agent work that the user wants to improve
    const user = await createTestUser(baseUrl, "review-reject");
    const workspace = await createTestWorkspace(baseUrl, user);
    const task = await createReadyTask(surreal, workspace.workspaceId, {
      title: "Build notification preferences UI",
    });
    const assignment = await assignTaskToAgent(
      baseUrl,
      user,
      workspace.workspaceId,
      task.taskId,
    );

    // When the user rejects the work with specific feedback
    const result = await rejectWithFeedback(
      baseUrl,
      user,
      workspace.workspaceId,
      assignment.agentSessionId,
      "Please add unit tests for the notification preferences component and handle the case where preferences have not been set yet.",
    );

    // Then the rejection is acknowledged and the agent continues working
    expect(result.rejected).toBe(true);
    expect(result.continuing).toBe(true);

    // And the task returns to in-progress status
    const taskStatus = await getTaskStatus(surreal, task.taskId);
    expect(taskStatus).toBe("in_progress");
  }, 60_000);

  // -------------------------------------------------------------------------
  // Error Path: Rejection without feedback text
  // -------------------------------------------------------------------------
  it.skip("rejects the rejection request when no feedback text is provided", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given completed agent work
    const user = await createTestUser(baseUrl, "review-nofeedback");
    const workspace = await createTestWorkspace(baseUrl, user);
    const task = await createReadyTask(surreal, workspace.workspaceId, {
      title: "Add audit trail logging",
    });
    const assignment = await assignTaskToAgent(
      baseUrl,
      user,
      workspace.workspaceId,
      task.taskId,
    );

    // When the user rejects without providing feedback
    const response = await fetchRaw(
      `${baseUrl}/api/orchestrator/${workspace.workspaceId}/sessions/${assignment.agentSessionId}/reject`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...user.headers },
        body: JSON.stringify({}),
      },
    );

    // Then the rejection is refused because the agent needs feedback to improve
    expect(response.status).toBe(400);
  }, 60_000);

  // -------------------------------------------------------------------------
  // Error Path: Cannot reject an already-completed session
  // -------------------------------------------------------------------------
  it.skip("cannot reject a session that has already been accepted", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a session whose work was already accepted
    const user = await createTestUser(baseUrl, "review-alreadydone");
    const workspace = await createTestWorkspace(baseUrl, user);
    const task = await createReadyTask(surreal, workspace.workspaceId, {
      title: "Implement role-based permissions",
    });
    const assignment = await assignTaskToAgent(
      baseUrl,
      user,
      workspace.workspaceId,
      task.taskId,
    );
    await acceptAgentWork(
      baseUrl,
      user,
      workspace.workspaceId,
      assignment.agentSessionId,
    );

    // When the user tries to reject the already-accepted session
    const response = await fetchRaw(
      `${baseUrl}/api/orchestrator/${workspace.workspaceId}/sessions/${assignment.agentSessionId}/reject`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...user.headers },
        body: JSON.stringify({
          feedback: "Actually, please also add documentation",
        }),
      },
    );

    // Then the rejection is refused because the work was already finalized
    expect(response.status).toBe(409);
  }, 60_000);
});
