/**
 * Agent Task Selection: Assign with agent lookup
 *
 * Validates that the orchestrator assign endpoint can accept an optional agentId,
 * look up the agent in the workspace, and pass the agent name through to the
 * agent_session record instead of hard-coding "claude".
 *
 * Driving port: POST /api/orchestrator/:ws/assign
 * Driven port: agent_session.agent field in SurrealDB
 */
import { describe, expect, it } from "bun:test";
import {
  setupOrchestratorSuite,
  createTestUser,
  createTestWorkspace,
  createReadyTask,
  getAgentSessionsForTask,
  fetchRaw,
} from "./orchestrator-test-kit";
import { createAgentTransaction } from "../../../app/src/server/agents/agent-queries";

const getRuntime = setupOrchestratorSuite("agent_task_selection");

describe("Agent Task Selection: assign with agent lookup", () => {
  // -------------------------------------------------------------------------
  // Scenario 1: assign with agent ID uses agent name
  // -------------------------------------------------------------------------
  it("assign with agent ID uses agent name", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a user with a workspace and a registered agent
    const user = await createTestUser(baseUrl, "ats1");
    const workspace = await createTestWorkspace(baseUrl, user);
    const agentResult = await createAgentTransaction(
      surreal,
      workspace.workspaceId,
      { name: "my-custom-agent", runtime: "sandbox" },
      new Date(),
    );
    const task = await createReadyTask(surreal, workspace.workspaceId, {
      title: "Implement feature with custom agent",
    });

    // When the user assigns the task with the agent's ID
    const response = await fetchRaw(
      `${baseUrl}/api/orchestrator/${workspace.workspaceId}/assign`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...user.headers },
        body: JSON.stringify({ taskId: task.taskId, agentId: agentResult.agent.id }),
      },
    );

    // Then the assignment succeeds
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.agentSessionId).toBeTruthy();

    // And the agent_session record uses the looked-up agent name
    const sessions = await getAgentSessionsForTask(surreal, task.taskId);
    expect(sessions.length).toBe(1);
    expect(sessions[0].agent).toBe("my-custom-agent");
  });

  // -------------------------------------------------------------------------
  // Scenario 2: assign without agent ID defaults to claude
  // -------------------------------------------------------------------------
  it("assign without agent ID defaults to claude", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a user with a workspace and a task
    const user = await createTestUser(baseUrl, "ats2");
    const workspace = await createTestWorkspace(baseUrl, user);
    const task = await createReadyTask(surreal, workspace.workspaceId, {
      title: "Implement feature with default agent",
    });

    // When the user assigns the task without an agentId
    const response = await fetchRaw(
      `${baseUrl}/api/orchestrator/${workspace.workspaceId}/assign`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...user.headers },
        body: JSON.stringify({ taskId: task.taskId }),
      },
    );

    // Then the assignment succeeds
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.agentSessionId).toBeTruthy();

    // And the agent_session record defaults to "claude"
    const sessions = await getAgentSessionsForTask(surreal, task.taskId);
    expect(sessions.length).toBe(1);
    expect(sessions[0].agent).toBe("claude");
  });

  // -------------------------------------------------------------------------
  // Scenario 3: assign with unknown agent ID returns 404
  // -------------------------------------------------------------------------
  it("assign with unknown agent ID returns 404", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a user with a workspace and a task, but no matching agent
    const user = await createTestUser(baseUrl, "ats3");
    const workspace = await createTestWorkspace(baseUrl, user);
    const task = await createReadyTask(surreal, workspace.workspaceId, {
      title: "Implement feature with nonexistent agent",
    });

    // When the user assigns the task with a non-existent agentId
    const response = await fetchRaw(
      `${baseUrl}/api/orchestrator/${workspace.workspaceId}/assign`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...user.headers },
        body: JSON.stringify({ taskId: task.taskId, agentId: "00000000-0000-0000-0000-000000000000" }),
      },
    );

    // Then the request fails with 404
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toContain("not found");
  });

  // -------------------------------------------------------------------------
  // Scenario 4: assign with cross-workspace agent ID returns 404
  // -------------------------------------------------------------------------
  it("assign with cross-workspace agent ID returns 404", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a user with two workspaces, and an agent registered only in workspace B
    const user = await createTestUser(baseUrl, "ats4");
    const workspaceA = await createTestWorkspace(baseUrl, user, "Workspace A");
    const workspaceB = await createTestWorkspace(baseUrl, user, "Workspace B");
    const agentResult = await createAgentTransaction(
      surreal,
      workspaceB.workspaceId,
      { name: "workspace-b-agent", runtime: "sandbox" },
      new Date(),
    );
    const task = await createReadyTask(surreal, workspaceA.workspaceId, {
      title: "Implement feature in workspace A",
    });

    // When the user assigns the task in workspace A with the agent from workspace B
    const response = await fetchRaw(
      `${baseUrl}/api/orchestrator/${workspaceA.workspaceId}/assign`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...user.headers },
        body: JSON.stringify({ taskId: task.taskId, agentId: agentResult.agent.id }),
      },
    );

    // Then the request fails with 404 (agent not in this workspace)
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toContain("not found");
  });
});
