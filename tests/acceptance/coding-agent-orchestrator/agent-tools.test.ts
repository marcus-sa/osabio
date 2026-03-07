/**
 * Agent Tools: Brain MCP Tool Registration and Execution
 *
 * Traces: US-0.2 (agent reads context via tools),
 *         US-0.3 (agent updates task status via tools)
 *
 * Validates that the coding agent can read context and update task state
 * through Brain tools. Tests exercise the MCP endpoints that the agent
 * uses for context loading and status reporting.
 *
 * Driving ports: POST /api/mcp/:ws/task-context (via agent tool)
 *                POST /api/mcp/:ws/project-context (via agent tool)
 *                POST /api/mcp/:ws/tasks/status (via agent tool)
 *                POST /api/mcp/:ws/observations (via agent tool)
 */
import { describe, expect, it } from "bun:test";
import {
  setupOrchestratorSuite,
  createTestUser,
  createTestWorkspace,
  createReadyTask,
  createTestProject,
  getTaskStatus,
  fetchJson,
} from "./orchestrator-test-kit";

const getRuntime = setupOrchestratorSuite("agent_tools");

describe("Agent Tools: Agent reads task context", () => {
  // -------------------------------------------------------------------------
  // Happy Path: Agent retrieves task details
  // US-0.2
  // -------------------------------------------------------------------------
  it.skip("agent receives task title, description, and status when requesting task context", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a task with detailed description in a workspace
    const user = await createTestUser(baseUrl, "agent-taskctx");
    const workspace = await createTestWorkspace(baseUrl, user);
    const task = await createReadyTask(surreal, workspace.workspaceId, {
      title: "Implement CSV export",
      description: "Add ability to export entity data as CSV files with configurable columns",
    });

    // When the agent requests context for this task
    const context = await fetchJson<{
      title: string;
      description: string;
      status: string;
    }>(`${baseUrl}/api/mcp/${workspace.workspaceId}/task-context`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...user.headers },
      body: JSON.stringify({ task_id: task.taskId }),
    });

    // Then the agent receives the task details needed to begin work
    expect(context.title).toBe("Implement CSV export");
    expect(context.description).toContain("CSV");
    expect(context.status).toBe("ready");
  }, 60_000);

  // -------------------------------------------------------------------------
  // Happy Path: Agent retrieves project context
  // US-0.2
  // -------------------------------------------------------------------------
  it.skip("agent receives project structure and decisions when requesting project context", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a project with associated tasks in a workspace
    const user = await createTestUser(baseUrl, "agent-projctx");
    const workspace = await createTestWorkspace(baseUrl, user);
    const project = await createTestProject(
      surreal,
      workspace.workspaceId,
      "Data Platform",
    );
    await createReadyTask(surreal, workspace.workspaceId, {
      title: "Build data ingestion pipeline",
      projectId: project.projectId,
    });

    // When the agent requests context for the project
    const context = await fetchJson<{
      name: string;
      status: string;
    }>(`${baseUrl}/api/mcp/${workspace.workspaceId}/project-context`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...user.headers },
      body: JSON.stringify({ project_id: project.projectId }),
    });

    // Then the agent receives the project overview needed for informed decisions
    expect(context.name).toBe("Data Platform");
    expect(context.status).toBe("active");
  }, 60_000);

  // -------------------------------------------------------------------------
  // Error Path: Task context for nonexistent task
  // -------------------------------------------------------------------------
  it.skip("agent receives an error when requesting context for a nonexistent task", async () => {
    const { baseUrl } = getRuntime();

    // Given a workspace with no matching task
    const user = await createTestUser(baseUrl, "agent-notask");
    const workspace = await createTestWorkspace(baseUrl, user);

    // When the agent requests context for a task that does not exist
    const { fetchRaw } = await import("./orchestrator-test-kit");
    const response = await fetchRaw(
      `${baseUrl}/api/mcp/${workspace.workspaceId}/task-context`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...user.headers },
        body: JSON.stringify({ task_id: "nonexistent-id" }),
      },
    );

    // Then the request fails with a clear error
    expect(response.status).toBe(404);
  }, 60_000);
});

describe("Agent Tools: Agent updates task status", () => {
  // -------------------------------------------------------------------------
  // Happy Path: Agent marks task as blocked
  // US-0.3
  // -------------------------------------------------------------------------
  it.skip("agent changes task status to blocked and records the reason", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a task that the agent is working on
    const user = await createTestUser(baseUrl, "agent-block");
    const workspace = await createTestWorkspace(baseUrl, user);
    const task = await createReadyTask(surreal, workspace.workspaceId, {
      title: "Integrate payment gateway",
      status: "in_progress",
    });

    // When the agent reports that the task is blocked
    await fetchJson(`${baseUrl}/api/mcp/${workspace.workspaceId}/tasks/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...user.headers },
      body: JSON.stringify({
        task_id: task.taskId,
        status: "blocked",
        reason: "Missing API credentials for payment provider",
      }),
    });

    // Then the task status is updated to blocked
    const status = await getTaskStatus(surreal, task.taskId);
    expect(status).toBe("blocked");
  }, 60_000);

  // -------------------------------------------------------------------------
  // Happy Path: Agent marks task as done
  // US-0.3
  // -------------------------------------------------------------------------
  it.skip("agent changes task status to done upon completion", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a task that the agent has been working on
    const user = await createTestUser(baseUrl, "agent-done");
    const workspace = await createTestWorkspace(baseUrl, user);
    const task = await createReadyTask(surreal, workspace.workspaceId, {
      title: "Add rate limiting middleware",
      status: "in_progress",
    });

    // When the agent reports that the task is completed
    await fetchJson(`${baseUrl}/api/mcp/${workspace.workspaceId}/tasks/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...user.headers },
      body: JSON.stringify({
        task_id: task.taskId,
        status: "done",
      }),
    });

    // Then the task status is updated to done
    const status = await getTaskStatus(surreal, task.taskId);
    expect(status).toBe("done");
  }, 60_000);

  // -------------------------------------------------------------------------
  // Error Path: Invalid status transition
  // -------------------------------------------------------------------------
  it.skip("agent cannot set an invalid status value", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a task with status "ready"
    const user = await createTestUser(baseUrl, "agent-badstatus");
    const workspace = await createTestWorkspace(baseUrl, user);
    const task = await createReadyTask(surreal, workspace.workspaceId, {
      title: "Fix memory leak",
    });

    // When the agent tries to set an invalid status
    const { fetchRaw } = await import("./orchestrator-test-kit");
    const response = await fetchRaw(
      `${baseUrl}/api/mcp/${workspace.workspaceId}/tasks/status`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...user.headers },
        body: JSON.stringify({
          task_id: task.taskId,
          status: "invalid_status",
        }),
      },
    );

    // Then the request is rejected because the status value is not allowed
    expect(response.ok).toBe(false);
  }, 60_000);
});

describe("Agent Tools: Agent creates observations", () => {
  // -------------------------------------------------------------------------
  // Happy Path: Agent logs an observation about a risk
  // US-0.3 (related)
  // -------------------------------------------------------------------------
  it.skip("agent creates an observation to flag a risk discovered during work", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace where the agent is working
    const user = await createTestUser(baseUrl, "agent-obs");
    const workspace = await createTestWorkspace(baseUrl, user);

    // When the agent creates an observation about a discovered risk
    const observation = await fetchJson<{ id: string }>(
      `${baseUrl}/api/mcp/${workspace.workspaceId}/observations`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...user.headers },
        body: JSON.stringify({
          text: "Authentication tokens are stored in localStorage, vulnerable to XSS",
          severity: "warning",
          category: "security",
        }),
      },
    );

    // Then the observation is recorded for the team to review
    expect(observation.id).toBeTruthy();
  }, 60_000);

  // -------------------------------------------------------------------------
  // Happy Path: Agent logs a conflict observation
  // -------------------------------------------------------------------------
  it.skip("agent creates a conflict observation when contradictory requirements are found", async () => {
    const { baseUrl } = getRuntime();

    // Given a workspace where the agent encounters contradictory decisions
    const user = await createTestUser(baseUrl, "agent-conflict");
    const workspace = await createTestWorkspace(baseUrl, user);

    // When the agent flags the contradiction
    const observation = await fetchJson<{ id: string }>(
      `${baseUrl}/api/mcp/${workspace.workspaceId}/observations`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...user.headers },
        body: JSON.stringify({
          text: "Task requires SQLite but project decision specifies PostgreSQL",
          severity: "conflict",
          category: "architecture",
        }),
      },
    );

    // Then the conflict is surfaced for human resolution
    expect(observation.id).toBeTruthy();
  }, 60_000);
});
