/**
 * Walking Skeleton: Assign Task to Agent, Monitor, Accept
 *
 * Traces: US-0.1, US-0.2, US-0.3, US-2.2
 *
 * This is the minimum viable E2E path through the coding agent orchestrator.
 * A user assigns a task to an agent, monitors its status, and accepts the
 * completed work. This is the FIRST test to enable -- all others start skipped.
 *
 * Driving ports: POST /api/orchestrator/:ws/assign
 *                GET  /api/orchestrator/:ws/sessions/:id
 *                POST /api/orchestrator/:ws/sessions/:id/accept
 */
import { describe, expect, it } from "bun:test";
import {
  setupOrchestratorSuite,
  createTestUser,
  createTestWorkspace,
  createReadyTask,
  assignTaskToAgent,
  getSessionStatus,
  acceptAgentWork,
  getTaskStatus,
  getAgentSessionsForTask,
} from "./orchestrator-test-kit";

const getRuntime = setupOrchestratorSuite("walking_skeleton");

describe("Walking Skeleton: User assigns task, monitors agent, accepts work", () => {
  // -------------------------------------------------------------------------
  // Walking Skeleton 1: Complete assign-monitor-accept journey
  // US-0.1 + US-2.2
  // -------------------------------------------------------------------------
  it("user assigns a ready task to an agent, checks progress, and accepts the result", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a user with a workspace containing a task ready for work
    const user = await createTestUser(baseUrl, "skeleton");
    const workspace = await createTestWorkspace(baseUrl, user);
    const task = await createReadyTask(surreal, workspace.workspaceId, {
      title: "Add login form validation",
      description: "Validate email format and password strength on the login form",
    });

    // When the user assigns the task to a coding agent
    const assignment = await assignTaskToAgent(
      baseUrl,
      user,
      workspace.workspaceId,
      task.taskId,
    );

    // Then an agent session is created with a stream for monitoring
    expect(assignment.agentSessionId).toBeTruthy();
    expect(assignment.streamUrl).toBeTruthy();

    // And the task status changes to "in_progress"
    const taskStatus = await getTaskStatus(surreal, task.taskId);
    expect(taskStatus).toBe("in_progress");

    // And the agent session is recorded in the workspace
    const sessions = await getAgentSessionsForTask(surreal, task.taskId);
    expect(sessions.length).toBe(1);
    expect(sessions[0].agent).toBe("claude-agent-sdk");

    // When the user checks the agent's progress
    const status = await getSessionStatus(
      baseUrl,
      user,
      workspace.workspaceId,
      assignment.agentSessionId,
    );

    // Then the session shows as active or idle (agent working or awaiting review)
    expect(["spawning", "active", "idle"]).toContain(status.orchestratorStatus);
    expect(status.startedAt).toBeTruthy();

    // When the user accepts the completed agent work
    const acceptResult = await acceptAgentWork(
      baseUrl,
      user,
      workspace.workspaceId,
      assignment.agentSessionId,
    );

    // Then the work is accepted
    expect(acceptResult.accepted).toBe(true);

    // And the task is marked as done
    const finalTaskStatus = await getTaskStatus(surreal, task.taskId);
    expect(finalTaskStatus).toBe("done");

    // And the agent session is completed
    const finalSessions = await getAgentSessionsForTask(surreal, task.taskId);
    const completedSession = finalSessions.find(
      (s) => s.id.id === assignment.agentSessionId,
    );
    expect(completedSession?.orchestrator_status).toBe("completed");
  }, 120_000);

  // -------------------------------------------------------------------------
  // Walking Skeleton 2: Assign and abort journey
  // US-0.1 (partial)
  // -------------------------------------------------------------------------
  it("user assigns a task then aborts the agent, returning the task to ready", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a user with a task assigned to an agent
    const user = await createTestUser(baseUrl, "skeleton-abort");
    const workspace = await createTestWorkspace(baseUrl, user);
    const task = await createReadyTask(surreal, workspace.workspaceId, {
      title: "Refactor authentication module",
      description: "Extract auth logic into separate service",
    });

    const assignment = await assignTaskToAgent(
      baseUrl,
      user,
      workspace.workspaceId,
      task.taskId,
    );

    // When the user aborts the agent session
    const { abortAgentSession } = await import("./orchestrator-test-kit");
    const abortResult = await abortAgentSession(
      baseUrl,
      user,
      workspace.workspaceId,
      assignment.agentSessionId,
    );

    // Then the session is aborted
    expect(abortResult.aborted).toBe(true);

    // And the task returns to ready status so it can be reassigned
    const taskStatus = await getTaskStatus(surreal, task.taskId);
    expect(taskStatus).toBe("ready");

    // And the agent session is marked as aborted
    const sessions = await getAgentSessionsForTask(surreal, task.taskId);
    const abortedSession = sessions.find(
      (s) => s.id.id === assignment.agentSessionId,
    );
    expect(abortedSession?.orchestrator_status).toBe("aborted");
  }, 120_000);
});
