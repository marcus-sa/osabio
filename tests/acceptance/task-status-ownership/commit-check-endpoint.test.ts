import { describe, expect, it } from "bun:test";
import { RecordId } from "surrealdb";
import { createTestUser, createTestUserWithMcp, fetchJson, setupAcceptanceSuite } from "../acceptance-test-kit";

/**
 * US-3: brain commit-check parses task refs and sets tasks to done.
 *
 * Tests the server endpoint POST /api/mcp/:workspaceId/commits/post-check
 * which accepts a commit message, extracts task refs (regex fast path),
 * and sets matched tasks to done.
 */

const getRuntime = setupAcceptanceSuite("commit-check");

async function setupWorkspaceWithTasks(
  baseUrl: string,
  surreal: ReturnType<typeof setupAcceptanceSuite> extends () => infer R ? (R extends { surreal: infer S } ? S : never) : never,
  suffix: string,
  tasks: Array<{ id: string; title: string; status: string }>,
) {
  const user = await createTestUserWithMcp(baseUrl, surreal, `commit-check-${suffix}`);

  const workspace = await fetchJson<{ workspaceId: string }>(
    `${baseUrl}/api/workspaces`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...user.headers },
      body: JSON.stringify({ name: `Commit Check ${Date.now()} ${suffix}` }),
    },
  );

  const workspaceRecord = new RecordId("workspace", workspace.workspaceId);
  const taskRecords: Array<{ id: string; record: RecordId<"task", string> }> = [];

  for (const task of tasks) {
    const taskRecord = new RecordId("task", task.id);
    await surreal.create(taskRecord).content({
      workspace: workspaceRecord,
      title: task.title,
      status: task.status,
      category: "engineering",
      priority: "medium",
      created_at: new Date(),
      updated_at: new Date(),
    });
    taskRecords.push({ id: task.id, record: taskRecord });
  }

  return { user, workspace, workspaceRecord, taskRecords };
}

describe("commit-check endpoint sets tasks to done (US-3)", () => {
  // Walking skeleton: commit with task ref sets task to done

  it("Given a task in_progress and a commit referencing it, When commit-check runs, Then the task status becomes 'done'", async () => {
    const { baseUrl, surreal } = getRuntime();
    const taskId = `cc-task-${Date.now()}-single`;

    const { user, workspace, taskRecords } = await setupWorkspaceWithTasks(
      baseUrl, surreal, "single-1",
      [{ id: taskId, title: "Implement login flow", status: "in_progress" }],
    );

    const res = await fetch(
      `${baseUrl}/api/mcp/${workspace.workspaceId}/commits/post-check`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...user.mcpHeaders },
        body: JSON.stringify({
          message: `Implement login flow\n\ntask:${taskId}`,
        }),
      },
    );

    expect(res.ok).toBe(true);

    // Verify task status changed to done
    const [taskRows] = await surreal
      .query<[Array<{ status: string }>]>(
        "SELECT status FROM $task;",
        { task: taskRecords[0]!.record },
      )
      .collect<[Array<{ status: string }>]>();

    expect(taskRows[0]?.status).toBe("done");
  }, 30_000);

  it("Given multiple tasks in_progress, When commit-check runs with message referencing both, Then both tasks become 'done'", async () => {
    const { baseUrl, surreal } = getRuntime();
    const taskId1 = `cc-task-${Date.now()}-multi-a`;
    const taskId2 = `cc-task-${Date.now()}-multi-b`;

    const { user, workspace, taskRecords } = await setupWorkspaceWithTasks(
      baseUrl, surreal, "multi-1",
      [
        { id: taskId1, title: "Auth flow", status: "in_progress" },
        { id: taskId2, title: "Token refresh", status: "in_progress" },
      ],
    );

    await fetch(
      `${baseUrl}/api/mcp/${workspace.workspaceId}/commits/post-check`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...user.mcpHeaders },
        body: JSON.stringify({
          message: `Batch update\n\ntasks: ${taskId1}, ${taskId2}`,
        }),
      },
    );

    for (const tr of taskRecords) {
      const [rows] = await surreal
        .query<[Array<{ status: string }>]>(
          "SELECT status FROM $task;",
          { task: tr.record },
        )
        .collect<[Array<{ status: string }>]>();
      expect(rows[0]?.status).toBe("done");
    }
  }, 30_000);

  // --- Error paths ---

  it("Given a commit message with no task refs, When commit-check runs, Then no task statuses change and response is successful", async () => {
    const { baseUrl, surreal } = getRuntime();
    const taskId = `cc-task-${Date.now()}-noref`;

    const { user, workspace, taskRecords } = await setupWorkspaceWithTasks(
      baseUrl, surreal, "noref-1",
      [{ id: taskId, title: "Unrelated task", status: "in_progress" }],
    );

    const res = await fetch(
      `${baseUrl}/api/mcp/${workspace.workspaceId}/commits/post-check`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...user.mcpHeaders },
        body: JSON.stringify({ message: "Fix typo in README" }),
      },
    );

    expect(res.ok).toBe(true);

    const [taskRows] = await surreal
      .query<[Array<{ status: string }>]>(
        "SELECT status FROM $task;",
        { task: taskRecords[0]!.record },
      )
      .collect<[Array<{ status: string }>]>();

    expect(taskRows[0]?.status).toBe("in_progress");
  }, 30_000);

  it("Given a task already 'done', When commit-check runs referencing it, Then the task remains 'done' and no error occurs (idempotent)", async () => {
    const { baseUrl, surreal } = getRuntime();
    const taskId = `cc-task-${Date.now()}-idempotent`;

    const { user, workspace, taskRecords } = await setupWorkspaceWithTasks(
      baseUrl, surreal, "idemp-1",
      [{ id: taskId, title: "Already done task", status: "done" }],
    );

    const res = await fetch(
      `${baseUrl}/api/mcp/${workspace.workspaceId}/commits/post-check`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...user.mcpHeaders },
        body: JSON.stringify({
          message: `followup\n\ntask:${taskId}`,
        }),
      },
    );

    expect(res.ok).toBe(true);

    const [taskRows] = await surreal
      .query<[Array<{ status: string }>]>(
        "SELECT status FROM $task;",
        { task: taskRecords[0]!.record },
      )
      .collect<[Array<{ status: string }>]>();

    expect(taskRows[0]?.status).toBe("done");
  }, 30_000);

  it("Given a commit referencing a task id that does not exist, When commit-check runs, Then the response succeeds without error", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUserWithMcp(baseUrl, surreal, "commit-check-missing");

    const workspace = await fetchJson<{ workspaceId: string }>(
      `${baseUrl}/api/workspaces`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...user.headers },
        body: JSON.stringify({ name: `Commit Check Missing ${Date.now()}` }),
      },
    );

    const res = await fetch(
      `${baseUrl}/api/mcp/${workspace.workspaceId}/commits/post-check`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...user.mcpHeaders },
        body: JSON.stringify({
          message: "task:nonexistent-task-9999 some work",
        }),
      },
    );

    // Should not fail -- missing task refs are gracefully ignored
    expect(res.ok).toBe(true);
  }, 30_000);

  it("Given no commit message in the request body, When commit-check is called, Then a validation error is returned", async () => {
    const { baseUrl, surreal } = getRuntime();
    const user = await createTestUserWithMcp(baseUrl, surreal, "commit-check-empty");

    const workspace = await fetchJson<{ workspaceId: string }>(
      `${baseUrl}/api/workspaces`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...user.headers },
        body: JSON.stringify({ name: `Commit Check Empty ${Date.now()}` }),
      },
    );

    const res = await fetch(
      `${baseUrl}/api/mcp/${workspace.workspaceId}/commits/post-check`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...user.mcpHeaders },
        body: JSON.stringify({}),
      },
    );

    expect(res.ok).toBe(false);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  }, 30_000);

  it("Given an invalid workspace id, When commit-check is called, Then a 401 is returned", async () => {
    const { baseUrl } = getRuntime();

    const res = await fetch(
      `${baseUrl}/api/mcp/nonexistent-workspace/commits/post-check`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "task:abc-1234 some work" }),
      },
    );

    // No auth token → 401 before workspace lookup
    expect(res.status).toBe(401);
  }, 30_000);
});
