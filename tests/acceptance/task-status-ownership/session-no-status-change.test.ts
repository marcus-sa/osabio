import { describe, expect, it } from "bun:test";
import { RecordId } from "surrealdb";
import { randomUUID } from "node:crypto";
import { createTestUser, createTestUserWithMcp, fetchJson, setupAcceptanceSuite } from "../acceptance-test-kit";

/**
 * US-1: Agent session creation does not change task status.
 * US-2: Session accept does not change task status.
 *
 * Walking skeleton: Creating a session for a task and accepting it
 * should only affect session lifecycle, never task status.
 * Forward transitions are agent/processor-owned.
 */

const getRuntime = setupAcceptanceSuite("session-no-status-change");

async function createWorkspaceAndTask(
  baseUrl: string,
  surreal: ReturnType<typeof setupAcceptanceSuite> extends () => infer R ? (R extends { surreal: infer S } ? S : never) : never,
  suffix: string,
  taskStatus: string,
) {
  const user = await createTestUserWithMcp(baseUrl, surreal, `session-status-${suffix}`, "session:write graph:read offline_access");

  const workspace = await fetchJson<{ workspaceId: string }>(
    `${baseUrl}/api/workspaces`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...user.headers },
      body: JSON.stringify({ name: `Session Status ${Date.now()} ${suffix}` }),
    },
  );

  const workspaceRecord = new RecordId("workspace", workspace.workspaceId);
  const taskId = `session-task-${suffix}-${Date.now()}`;
  const taskRecord = new RecordId("task", taskId);

  await surreal.create(taskRecord).content({
    workspace: workspaceRecord,
    title: `Test task for session status ${suffix}`,
    status: taskStatus,
    category: "engineering",
    priority: "medium",
    created_at: new Date(),
    updated_at: new Date(),
  });

  return { user, workspace, workspaceRecord, taskId, taskRecord };
}

/** Create a workspace + task + orchestrator-managed session directly in DB */
async function createWorkspaceWithOrchestratorSession(
  baseUrl: string,
  surreal: ReturnType<typeof setupAcceptanceSuite> extends () => infer R ? (R extends { surreal: infer S } ? S : never) : never,
  suffix: string,
  taskStatus: string,
) {
  const user = await createTestUser(baseUrl, `session-status-${suffix}`);

  const workspace = await fetchJson<{ workspaceId: string }>(
    `${baseUrl}/api/workspaces`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...user.headers },
      body: JSON.stringify({ name: `Session Status ${Date.now()} ${suffix}` }),
    },
  );

  const workspaceRecord = new RecordId("workspace", workspace.workspaceId);
  const taskId = `session-task-${suffix}-${Date.now()}`;
  const taskRecord = new RecordId("task", taskId);

  await surreal.create(taskRecord).content({
    workspace: workspaceRecord,
    title: `Test task for session status ${suffix}`,
    status: taskStatus,
    category: "engineering",
    priority: "medium",
    created_at: new Date(),
    updated_at: new Date(),
  });

  const sessionId = randomUUID();
  const sessionRecord = new RecordId("agent_session", sessionId);
  await surreal.create(sessionRecord).content({
    workspace: workspaceRecord,
    task_id: taskRecord,
    agent: "claude",
    orchestrator_status: "idle",
    started_at: new Date(),
    created_at: new Date(),
  });

  await surreal.query(
    `UPDATE $task SET source_session = $sess;`,
    { task: taskRecord, sess: sessionRecord },
  );

  return { user, workspace, workspaceRecord, taskId, taskRecord, sessionId };
}

describe("session creation does not change task status (US-1)", () => {
  // Walking skeleton: session creation preserves task status

  it("Given a task with status 'ready', When an agent session is created for that task, Then the task status remains 'ready' and source_session is linked", async () => {
    const { baseUrl, surreal } = getRuntime();
    const { user, workspace, taskId, taskRecord } = await createWorkspaceAndTask(
      baseUrl, surreal, "ready-1", "ready",
    );

    // Create agent session for the task via MCP endpoint
    const session = await fetchJson<{ session_id: string }>(
      `${baseUrl}/api/mcp/${workspace.workspaceId}/sessions/start`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...user.mcpHeaders },
        body: JSON.stringify({ agent: "claude", task_id: taskId }),
      },
    );

    expect(session.session_id).toBeDefined();

    // Verify task status was NOT changed
    const [taskRows] = await surreal
      .query<[Array<{ status: string; source_session?: RecordId }>]>(
        "SELECT status, source_session FROM $task;",
        { task: taskRecord },
      )
      .collect<[Array<{ status: string; source_session?: RecordId }>]>();

    expect(taskRows[0]?.status).toBe("ready");
    expect(taskRows[0]?.source_session).toBeDefined();
  }, 30_000);

  it("Given a task with status 'todo', When an agent session is created for that task, Then the task status remains 'todo'", async () => {
    const { baseUrl, surreal } = getRuntime();
    const { user, workspace, taskId, taskRecord } = await createWorkspaceAndTask(
      baseUrl, surreal, "todo-1", "todo",
    );

    await fetchJson<{ session_id: string }>(
      `${baseUrl}/api/mcp/${workspace.workspaceId}/sessions/start`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...user.mcpHeaders },
        body: JSON.stringify({ agent: "claude", task_id: taskId }),
      },
    );

    const [taskRows] = await surreal
      .query<[Array<{ status: string }>]>(
        "SELECT status FROM $task;",
        { task: taskRecord },
      )
      .collect<[Array<{ status: string }>]>();

    expect(taskRows[0]?.status).toBe("todo");
  }, 30_000);

  it("Given a task with status 'in_progress', When an agent session is created, Then the task status remains 'in_progress'", async () => {
    const { baseUrl, surreal } = getRuntime();
    const { user, workspace, taskId, taskRecord } = await createWorkspaceAndTask(
      baseUrl, surreal, "inprog-1", "in_progress",
    );

    await fetchJson<{ session_id: string }>(
      `${baseUrl}/api/mcp/${workspace.workspaceId}/sessions/start`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...user.mcpHeaders },
        body: JSON.stringify({ agent: "claude", task_id: taskId }),
      },
    );

    const [taskRows] = await surreal
      .query<[Array<{ status: string }>]>(
        "SELECT status FROM $task;",
        { task: taskRecord },
      )
      .collect<[Array<{ status: string }>]>();

    expect(taskRows[0]?.status).toBe("in_progress");
  }, 30_000);
});

describe("session accept does not change task status (US-2)", () => {
  it("Given a session linked to an in_progress task, When the session is accepted, Then the task status remains 'in_progress'", async () => {
    const { baseUrl, surreal } = getRuntime();
    const { user, workspace, sessionId, taskRecord } = await createWorkspaceWithOrchestratorSession(
      baseUrl, surreal, "accept-1", "in_progress",
    );

    // Accept the session via orchestrator endpoint
    const acceptResult = await fetchJson<{ accepted: boolean }>(
      `${baseUrl}/api/orchestrator/${workspace.workspaceId}/sessions/${sessionId}/accept`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...user.headers },
        body: JSON.stringify({ summary: "Work completed" }),
      },
    );

    expect(acceptResult.accepted).toBe(true);

    // Verify task status was NOT changed to done
    const [taskRows] = await surreal
      .query<[Array<{ status: string }>]>(
        "SELECT status FROM $task;",
        { task: taskRecord },
      )
      .collect<[Array<{ status: string }>]>();

    expect(taskRows[0]?.status).toBe("in_progress");
  }, 45_000);

  it("Given a session linked to a task already marked 'done', When the session is accepted, Then the task status remains 'done'", async () => {
    const { baseUrl, surreal } = getRuntime();
    const { user, workspace, sessionId, taskRecord } = await createWorkspaceWithOrchestratorSession(
      baseUrl, surreal, "accept-2", "done",
    );

    await fetchJson<{ accepted: boolean }>(
      `${baseUrl}/api/orchestrator/${workspace.workspaceId}/sessions/${sessionId}/accept`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...user.headers },
        body: JSON.stringify({ summary: "Already done" }),
      },
    );

    const [taskRows] = await surreal
      .query<[Array<{ status: string }>]>(
        "SELECT status FROM $task;",
        { task: taskRecord },
      )
      .collect<[Array<{ status: string }>]>();

    expect(taskRows[0]?.status).toBe("done");
  }, 45_000);
});
