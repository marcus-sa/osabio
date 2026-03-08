import { describe, expect, it } from "bun:test";
import { RecordId } from "surrealdb";
import { createTestUser, fetchJson, setupSmokeSuite } from "../smoke-test-kit";

/**
 * Backward transitions (unchanged behavior).
 * Server owns abort and reject -- these reset task status to ready.
 *
 * These tests verify that backward transitions continue to work correctly
 * after forward transitions are moved to agents/processors.
 */

const getRuntime = setupSmokeSuite("backward-transitions");

async function createSessionWithTask(
  baseUrl: string,
  surreal: ReturnType<typeof setupSmokeSuite> extends () => infer R ? (R extends { surreal: infer S } ? S : never) : never,
  suffix: string,
  taskStatus: string,
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
    category: "backend",
    priority: "medium",
    created_at: new Date(),
    updated_at: new Date(),
  });

  // Create a session linked to the task
  const session = await fetchJson<{ session_id: string }>(
    `${baseUrl}/api/mcp/${workspace.workspaceId}/sessions`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...user.headers },
      body: JSON.stringify({ agent: "claude", task_id: taskId }),
    },
  );

  return { user, workspace, workspaceRecord, taskId, taskRecord, session };
}

describe("server-owned backward transitions", () => {
  it.skip("Given a session linked to an in_progress task, When the session is aborted, Then the task status resets to 'ready'", async () => {
    const { baseUrl, surreal } = getRuntime();
    const { user, session, taskRecord } = await createSessionWithTask(
      baseUrl, surreal, "abort-1", "in_progress",
    );

    const abortResult = await fetchJson<{ aborted: boolean }>(
      `${baseUrl}/api/orchestrator/sessions/${session.session_id}/abort`,
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

  it.skip("Given a session linked to an in_progress task, When the session is rejected, Then the task status resets to 'ready'", async () => {
    const { baseUrl, surreal } = getRuntime();
    const { user, session, taskRecord } = await createSessionWithTask(
      baseUrl, surreal, "reject-1", "in_progress",
    );

    const rejectResult = await fetchJson<{ rejected: boolean }>(
      `${baseUrl}/api/orchestrator/sessions/${session.session_id}/reject`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...user.headers },
        body: JSON.stringify({ reason: "Work not acceptable" }),
      },
    );

    expect(rejectResult.rejected).toBe(true);

    const [taskRows] = await surreal
      .query<[Array<{ status: string }>]>(
        "SELECT status FROM $task;",
        { task: taskRecord },
      )
      .collect<[Array<{ status: string }>]>();

    expect(taskRows[0]?.status).toBe("ready");
  }, 30_000);

  it.skip("Given a session linked to a 'done' task, When the session is aborted, Then the task status resets to 'ready'", async () => {
    const { baseUrl, surreal } = getRuntime();
    const { user, session, taskRecord } = await createSessionWithTask(
      baseUrl, surreal, "abort-done-1", "done",
    );

    await fetchJson<{ aborted: boolean }>(
      `${baseUrl}/api/orchestrator/sessions/${session.session_id}/abort`,
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
