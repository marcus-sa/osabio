import { describe, expect, it } from "bun:test";
import { RecordId } from "surrealdb";
import { randomUUID } from "node:crypto";
import { createTestUser, fetchJson, setupAcceptanceSuite } from "../acceptance-test-kit";

/**
 * Backward transitions (unchanged behavior).
 * Server owns abort and reject -- these reset task status to ready.
 *
 * These tests verify that backward transitions continue to work correctly
 * after forward transitions are moved to agents/processors.
 */

const getRuntime = setupAcceptanceSuite("backward-transitions");

async function createSessionWithTask(
  baseUrl: string,
  surreal: ReturnType<typeof setupAcceptanceSuite> extends () => infer R ? (R extends { surreal: infer S } ? S : never) : never,
  suffix: string,
  taskStatus: string,
  orchestratorStatus: string = "active",
) {
  const user = await createTestUser(baseUrl, `backward-${suffix}`);

  const workspace = await fetchJson<{ workspaceId: string }>(
    `${baseUrl}/api/workspaces`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...user.headers },
      body: JSON.stringify({ name: `Backward ${Date.now()} ${suffix}` }),
    },
  );

  const workspaceRecord = new RecordId("workspace", workspace.workspaceId);
  const taskId = `backward-task-${suffix}-${Date.now()}`;
  const taskRecord = new RecordId("task", taskId);

  await surreal.create(taskRecord).content({
    workspace: workspaceRecord,
    title: `Backward transition test ${suffix}`,
    status: taskStatus,
    category: "engineering",
    priority: "medium",
    created_at: new Date(),
    updated_at: new Date(),
  });

  // Create an orchestrator-managed session directly in the DB
  const sessionId = randomUUID();
  const sessionRecord = new RecordId("agent_session", sessionId);
  await surreal.create(sessionRecord).content({
    workspace: workspaceRecord,
    task_id: taskRecord,
    agent: "claude",
    orchestrator_status: orchestratorStatus,
    started_at: new Date(),
    created_at: new Date(),
  });

  // Link task to session
  await surreal.query(
    `UPDATE $task SET source_session = $sess;`,
    { task: taskRecord, sess: sessionRecord },
  );

  return { user, workspace, workspaceRecord, taskId, taskRecord, session: { session_id: sessionId } };
}

describe("server-owned backward transitions", () => {
  it("Given a session linked to an in_progress task, When the session is aborted, Then the task status resets to 'ready'", async () => {
    const { baseUrl, surreal } = getRuntime();
    const { user, workspace, session, taskRecord } = await createSessionWithTask(
      baseUrl, surreal, "abort-1", "in_progress",
    );

    const abortResult = await fetchJson<{ aborted: boolean }>(
      `${baseUrl}/api/orchestrator/${workspace.workspaceId}/sessions/${session.session_id}/abort`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...user.headers },
        body: JSON.stringify({ reason: "Agent crashed" }),
      },
    );

    expect(abortResult.aborted).toBe(true);

    const [taskRows] = await surreal
      .query<[Array<{ status: string }>]>(
        "SELECT status FROM $task;",
        { task: taskRecord },
      )
      .collect<[Array<{ status: string }>]>();

    expect(taskRows[0]?.status).toBe("ready");
  }, 30_000);

  it("Given a session linked to an in_progress task, When the session is rejected, Then the task status remains 'in_progress' (agent resumes work)", async () => {
    const { baseUrl, surreal } = getRuntime();
    const { user, workspace, session, taskRecord } = await createSessionWithTask(
      baseUrl, surreal, "reject-1", "in_progress", "idle",
    );

    const rejectResult = await fetchJson<{ rejected: boolean }>(
      `${baseUrl}/api/orchestrator/${workspace.workspaceId}/sessions/${session.session_id}/reject`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...user.headers },
        body: JSON.stringify({ feedback: "Work not acceptable" }),
      },
    );

    expect(rejectResult.rejected).toBe(true);

    const [taskRows] = await surreal
      .query<[Array<{ status: string }>]>(
        "SELECT status FROM $task;",
        { task: taskRecord },
      )
      .collect<[Array<{ status: string }>]>();

    expect(taskRows[0]?.status).toBe("in_progress");
  }, 30_000);

  it("Given a session linked to a 'done' task, When the session is aborted, Then the task status resets to 'ready'", async () => {
    const { baseUrl, surreal } = getRuntime();
    const { user, workspace, session, taskRecord } = await createSessionWithTask(
      baseUrl, surreal, "abort-done-1", "done",
    );

    await fetchJson<{ aborted: boolean }>(
      `${baseUrl}/api/orchestrator/${workspace.workspaceId}/sessions/${session.session_id}/abort`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...user.headers },
        body: JSON.stringify({ reason: "Need to redo" }),
      },
    );

    const [taskRows] = await surreal
      .query<[Array<{ status: string }>]>(
        "SELECT status FROM $task;",
        { task: taskRecord },
      )
      .collect<[Array<{ status: string }>]>();

    expect(taskRows[0]?.status).toBe("ready");
  }, 30_000);
});
