/**
 * UI Walking Skeleton: Agent Delegation Across Three Surfaces
 *
 * Verifies the minimal E2E path through all three UI surfaces:
 *   Surface 1 (Task Popup): assign button -> status badge
 *   Surface 2 (Governance Feed): review-ready item appears
 *   Surface 3 (Agent Review View): diff + accept
 *
 * Driving ports: POST /assign, GET /sessions/:id, GET /feed,
 *   GET /review, POST /accept, POST /reject
 *
 * Stories: US-0.4, US-0.5, US-1.2, US-2.1, US-2.2, US-2.3
 */
import { describe, it, expect } from "bun:test";
import {
  setupOrchestratorSuite,
  createTestUser,
  createTestWorkspace,
  createReadyTask,
  assignTaskToAgent,
  getSessionStatus,
  openTaskPopup,
  isAssignButtonVisible,
  getAgentBadgeText,
  getGovernanceFeed,
  findFeedItemForTask,
  feedItemHasActions,
  openReviewView,
  reviewShowsTaskContent,
  acceptAgentWork,
  rejectWithFeedback,
  getTaskStatus,
  simulateAgentCompletion,
  simulateAgentError,
  simulateAgentActive,
  waitForCondition,
  type TestUser,
  type TestWorkspace,
  type TestTask,
} from "./orchestrator-ui-test-kit";

const getRuntime = setupOrchestratorSuite("ui-walking-skeleton");

describe("UI Walking Skeleton: Agent Delegation Across Three Surfaces", () => {
  let user: TestUser;
  let workspace: TestWorkspace;

  // US-0.4, US-0.5, US-1.2, US-2.1, US-2.2
  it("assigns from popup, monitors in feed, accepts in review view", async () => {
    const runtime = getRuntime();
    user = await createTestUser(runtime.baseUrl, "ws1");
    workspace = await createTestWorkspace(runtime.baseUrl, user);

    // Given a task with status "ready"
    const taskTitle = `Implement input validation ${Date.now()}`;
    const task = await createReadyTask(
      runtime.surreal,
      workspace.workspaceId,
      { title: taskTitle, status: "ready" },
    );

    // Surface 1: Task Popup -- "Assign to Agent" button visible
    const detailBefore = await openTaskPopup(
      runtime.baseUrl,
      user,
      workspace.workspaceId,
      task.taskId,
    );
    expect(isAssignButtonVisible(detailBefore)).toBe(true);

    // When I assign the task to an agent
    const assignment = await assignTaskToAgent(
      runtime.baseUrl,
      user,
      workspace.workspaceId,
      task.taskId,
    );
    expect(assignment.agentSessionId).toBeDefined();

    // Simulate agent transitioning from spawning to active
    await simulateAgentActive(runtime, assignment.agentSessionId);

    // Then the popup shows a status badge "Agent working"
    const detailAfterAssign = await openTaskPopup(
      runtime.baseUrl,
      user,
      workspace.workspaceId,
      task.taskId,
    );
    expect(getAgentBadgeText(detailAfterAssign)).toBe("Agent working");

    // Simulate agent completing work (transitions to idle)
    await simulateAgentCompletion(runtime, assignment.agentSessionId);

    // Surface 2: Governance Feed -- review-ready item appears
    const feed = await getGovernanceFeed(
      runtime.baseUrl,
      user,
      workspace.workspaceId,
    );
    const feedResult = findFeedItemForTask(feed, taskTitle);
    expect(feedResult).toBeDefined();
    expect(feedResult!.tier).toBe("review");
    expect(
      feedItemHasActions(feedResult!.item, ["Review", "Abort"]),
    ).toBe(true);

    // Surface 3: Agent Review View -- task title and accept
    const review = await openReviewView(
      runtime.baseUrl,
      user,
      workspace.workspaceId,
      assignment.agentSessionId,
    );
    expect(reviewShowsTaskContent(review, taskTitle)).toBe(
      true,
    );

    // When I accept the agent's work
    const acceptResult = await acceptAgentWork(
      runtime.baseUrl,
      user,
      workspace.workspaceId,
      assignment.agentSessionId,
    );
    expect(acceptResult.accepted).toBe(true);

    // Then the task status is "done"
    const finalStatus = await getTaskStatus(runtime.surreal, task.taskId);
    expect(finalStatus).toBe("done");
  }, 60_000);

  // US-2.3
  it("rejects agent work with feedback and sees agent resume", async () => {
    const runtime = getRuntime();
    user = await createTestUser(runtime.baseUrl, "ws2");
    workspace = await createTestWorkspace(runtime.baseUrl, user);

    // Given a task assigned to an agent with completed work
    const task = await createReadyTask(
      runtime.surreal,
      workspace.workspaceId,
      { title: `Fix login bug ${Date.now()}`, status: "ready" },
    );
    const assignment = await assignTaskToAgent(
      runtime.baseUrl,
      user,
      workspace.workspaceId,
      task.taskId,
    );
    await simulateAgentCompletion(runtime, assignment.agentSessionId);

    // When I reject the work with feedback
    const rejectResult = await rejectWithFeedback(
      runtime.baseUrl,
      user,
      workspace.workspaceId,
      assignment.agentSessionId,
      "Please add input validation for email field",
    );
    expect(rejectResult.rejected).toBe(true);
    expect(rejectResult.continuing).toBe(true);

    // Then the task popup badge shows "Agent working"
    const detailAfterReject = await openTaskPopup(
      runtime.baseUrl,
      user,
      workspace.workspaceId,
      task.taskId,
    );
    expect(getAgentBadgeText(detailAfterReject)).toBe("Agent working");
  }, 60_000);

  // US-1.2
  it("surfaces agent error as blocking feed item", async () => {
    const runtime = getRuntime();
    user = await createTestUser(runtime.baseUrl, "ws3");
    workspace = await createTestWorkspace(runtime.baseUrl, user);

    // Given a task assigned to an agent
    const taskTitle = `Refactor auth module ${Date.now()}`;
    const task = await createReadyTask(
      runtime.surreal,
      workspace.workspaceId,
      { title: taskTitle, status: "ready" },
    );
    const assignment = await assignTaskToAgent(
      runtime.baseUrl,
      user,
      workspace.workspaceId,
      task.taskId,
    );

    // When the agent encounters an error
    await simulateAgentError(
      runtime,
      assignment.agentSessionId,
      "Out of memory during compilation",
    );

    // Then the governance feed shows a blocking item
    const feed = await getGovernanceFeed(
      runtime.baseUrl,
      user,
      workspace.workspaceId,
    );
    const feedResult = findFeedItemForTask(feed, taskTitle);
    expect(feedResult).toBeDefined();
    expect(feedResult!.tier).toBe("blocking");
    expect(feedResult!.item.reason).toContain(
      "Out of memory during compilation",
    );
  }, 60_000);
});
