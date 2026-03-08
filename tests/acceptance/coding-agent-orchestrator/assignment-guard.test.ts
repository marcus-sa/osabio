/**
 * Assignment Guard: Task Eligibility and One-Agent-Per-Task
 *
 * Traces: US-0.1 (validation acceptance criteria)
 *
 * Validates that only eligible tasks can be assigned to agents, and that
 * no task can have more than one active agent working on it simultaneously.
 *
 * Driving port: POST /api/orchestrator/:ws/assign
 */
import { describe, expect, it } from "bun:test";
import {
  setupOrchestratorSuite,
  createTestUser,
  createTestWorkspace,
  createReadyTask,
  assignTaskToAgent,
  abortAgentSession,
  acceptAgentWork,
  simulateSessionStatus,
  fetchRaw,
} from "./orchestrator-test-kit";

const getRuntime = setupOrchestratorSuite("assignment_guard");

describe("Assignment Guard: Task eligibility validation", () => {
  // -------------------------------------------------------------------------
  // Happy Path: Eligible task statuses
  // -------------------------------------------------------------------------
  it("accepts assignment for a task with status 'ready'", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a task with status "ready"
    const user = await createTestUser(baseUrl, "guard-ready");
    const workspace = await createTestWorkspace(baseUrl, user);
    const task = await createReadyTask(surreal, workspace.workspaceId, {
      title: "Implement search feature",
      status: "ready",
    });

    // When the user assigns the task to an agent
    const assignment = await assignTaskToAgent(
      baseUrl,
      user,
      workspace.workspaceId,
      task.taskId,
    );

    // Then the assignment is accepted
    expect(assignment.agentSessionId).toBeTruthy();
  }, 60_000);

  it("accepts assignment for a task with status 'todo'", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a task with status "todo"
    const user = await createTestUser(baseUrl, "guard-todo");
    const workspace = await createTestWorkspace(baseUrl, user);
    const task = await createReadyTask(surreal, workspace.workspaceId, {
      title: "Write unit tests for parser",
      status: "todo",
    });

    // When the user assigns the task to an agent
    const assignment = await assignTaskToAgent(
      baseUrl,
      user,
      workspace.workspaceId,
      task.taskId,
    );

    // Then the assignment is accepted
    expect(assignment.agentSessionId).toBeTruthy();
  }, 60_000);

  // -------------------------------------------------------------------------
  // Error Path: Ineligible task statuses
  // -------------------------------------------------------------------------
  it("rejects assignment for a task already in progress", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a task that is already in progress
    const user = await createTestUser(baseUrl, "guard-inprogress");
    const workspace = await createTestWorkspace(baseUrl, user);
    const task = await createReadyTask(surreal, workspace.workspaceId, {
      title: "Build notification system",
      status: "in_progress",
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

    // Then the assignment is rejected because the task is not in an assignable status
    expect(response.status).toBe(409);
  }, 60_000);

  it("rejects assignment for a completed task", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a task that is already completed
    const user = await createTestUser(baseUrl, "guard-done");
    const workspace = await createTestWorkspace(baseUrl, user);
    const task = await createReadyTask(surreal, workspace.workspaceId, {
      title: "Deploy v1.0 release",
      status: "done",
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

    // Then the assignment is rejected because completed tasks cannot be reassigned
    expect(response.status).toBe(409);
  }, 60_000);

  it("rejects assignment for a task that does not exist", async () => {
    const { baseUrl } = getRuntime();

    // Given a task identifier that does not exist
    const user = await createTestUser(baseUrl, "guard-missing");
    const workspace = await createTestWorkspace(baseUrl, user);

    // When the user tries to assign a nonexistent task
    const response = await fetchRaw(
      `${baseUrl}/api/orchestrator/${workspace.workspaceId}/assign`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...user.headers },
        body: JSON.stringify({ taskId: "nonexistent-task-id" }),
      },
    );

    // Then the assignment is rejected because the task was not found
    expect(response.status).toBe(404);
  }, 60_000);
});

describe("Assignment Guard: One agent per task enforcement", () => {
  // -------------------------------------------------------------------------
  // Error Path: Duplicate assignment prevention
  // -------------------------------------------------------------------------
  it("rejects a second agent assignment while first agent is still working", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a task that already has an active agent working on it
    const user = await createTestUser(baseUrl, "guard-dup");
    const workspace = await createTestWorkspace(baseUrl, user);
    const task = await createReadyTask(surreal, workspace.workspaceId, {
      title: "Optimize database queries",
    });

    await assignTaskToAgent(
      baseUrl,
      user,
      workspace.workspaceId,
      task.taskId,
    );

    // When another assignment is attempted for the same task
    const response = await fetchRaw(
      `${baseUrl}/api/orchestrator/${workspace.workspaceId}/assign`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...user.headers },
        body: JSON.stringify({ taskId: task.taskId }),
      },
    );

    // Then the second assignment is rejected because only one agent can work on a task
    expect(response.status).toBe(409);
  }, 60_000);

  it("allows reassignment after previous agent session was aborted", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a task whose previous agent session was aborted
    const user = await createTestUser(baseUrl, "guard-reuse");
    const workspace = await createTestWorkspace(baseUrl, user);
    const task = await createReadyTask(surreal, workspace.workspaceId, {
      title: "Fix login timeout bug",
    });

    const first = await assignTaskToAgent(
      baseUrl,
      user,
      workspace.workspaceId,
      task.taskId,
    );

    await abortAgentSession(
      baseUrl,
      user,
      workspace.workspaceId,
      first.agentSessionId,
    );

    // When the user assigns the task to a new agent
    const second = await assignTaskToAgent(
      baseUrl,
      user,
      workspace.workspaceId,
      task.taskId,
    );

    // Then the new assignment is accepted because the previous session was terminated
    expect(second.agentSessionId).toBeTruthy();
    expect(second.agentSessionId).not.toBe(first.agentSessionId);
  }, 120_000);

  it("allows reassignment after previous agent session completed and was accepted", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a task whose agent work was previously accepted
    const user = await createTestUser(baseUrl, "guard-reaccept");
    const workspace = await createTestWorkspace(baseUrl, user);
    const task = await createReadyTask(surreal, workspace.workspaceId, {
      title: "Add password reset flow",
    });

    const first = await assignTaskToAgent(
      baseUrl,
      user,
      workspace.workspaceId,
      task.taskId,
    );

    // Simulate agent completing work (mock agent produces no messages)
    await simulateSessionStatus(surreal, first.agentSessionId, "idle");

    await acceptAgentWork(
      baseUrl,
      user,
      workspace.workspaceId,
      first.agentSessionId,
    );

    // The task is now "done" -- update it back to "ready" to simulate needing rework
    await surreal.query(
      `UPDATE $task SET status = "ready", updated_at = time::now();`,
      { task: task.taskRecord },
    );

    // When the user assigns the task again
    const second = await assignTaskToAgent(
      baseUrl,
      user,
      workspace.workspaceId,
      task.taskId,
    );

    // Then a new agent session is created
    expect(second.agentSessionId).toBeTruthy();
    expect(second.agentSessionId).not.toBe(first.agentSessionId);
  }, 120_000);
});

describe("Assignment Guard: Input validation", () => {
  // -------------------------------------------------------------------------
  // Error Path: Malformed requests
  // -------------------------------------------------------------------------
  it("rejects assignment without a task identifier", async () => {
    const { baseUrl } = getRuntime();

    // Given a user attempting to assign without specifying which task
    const user = await createTestUser(baseUrl, "guard-notask");
    const workspace = await createTestWorkspace(baseUrl, user);

    // When the assignment request omits the task identifier
    const response = await fetchRaw(
      `${baseUrl}/api/orchestrator/${workspace.workspaceId}/assign`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...user.headers },
        body: JSON.stringify({}),
      },
    );

    // Then the request is rejected for missing required information
    expect(response.status).toBe(400);
  }, 60_000);

  it("rejects assignment to a workspace the user does not belong to", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a user who does not belong to the target workspace
    const owner = await createTestUser(baseUrl, "guard-owner");
    const outsider = await createTestUser(baseUrl, "guard-outsider");
    const workspace = await createTestWorkspace(baseUrl, owner);
    const task = await createReadyTask(surreal, workspace.workspaceId, {
      title: "Add audit logging",
    });

    // When the outsider tries to assign a task in that workspace
    const response = await fetchRaw(
      `${baseUrl}/api/orchestrator/${workspace.workspaceId}/assign`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...outsider.headers },
        body: JSON.stringify({ taskId: task.taskId }),
      },
    );

    // Then the request is rejected due to insufficient access
    expect(response.status).toBe(403);
  }, 60_000);
});
