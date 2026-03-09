import { describe, expect, it } from "bun:test";
import { RecordId } from "surrealdb";
import { createTestUser, fetchJson, setupAcceptanceSuite } from "../acceptance-test-kit";

/**
 * US-5: GitHub commit processor sets task status to done on push to non-main branch.
 * US-6: GitHub commit processor sets task status to completed on merge to main.
 *
 * These tests extend the existing github-webhook smoke test to validate
 * that push events trigger task status transitions based on branch.
 */

const getRuntime = setupAcceptanceSuite("webhook-status");

function makePushEvent(overrides: {
  ref?: string;
  defaultBranch?: string;
  commits?: Array<{
    id: string;
    message: string;
    timestamp: string;
    url: string;
    author: { name: string; email: string; username?: string };
  }>;
}) {
  const defaultBranch = overrides.defaultBranch ?? "main";
  return {
    ref: overrides.ref ?? `refs/heads/${defaultBranch}`,
    repository: {
      full_name: "acme/brain",
      default_branch: defaultBranch,
      html_url: "https://github.com/acme/brain",
    },
    commits: overrides.commits ?? [],
  };
}

async function pollForTaskStatus(
  surreal: ReturnType<typeof setupAcceptanceSuite> extends () => infer R ? (R extends { surreal: infer S } ? S : never) : never,
  taskRecord: RecordId<"task", string>,
  expectedStatus: string,
  timeoutMs: number,
): Promise<string | undefined> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const [rows] = await surreal
      .query<[Array<{ status: string }>]>(
        "SELECT status FROM $task;",
        { task: taskRecord },
      )
      .collect<[Array<{ status: string }>]>();
    if (rows[0]?.status === expectedStatus) return rows[0].status;
    await Bun.sleep(500);
  }
  // Return whatever status it has now
  const [rows] = await surreal
    .query<[Array<{ status: string }>]>(
      "SELECT status FROM $task;",
      { task: taskRecord },
    )
    .collect<[Array<{ status: string }>]>();
  return rows[0]?.status;
}

async function setupWorkspaceWithTask(
  baseUrl: string,
  surreal: ReturnType<typeof setupAcceptanceSuite> extends () => infer R ? (R extends { surreal: infer S } ? S : never) : never,
  suffix: string,
  taskStatus: string,
) {
  const user = await createTestUser(baseUrl, `wh-status-${suffix}`);

  const workspace = await fetchJson<{ workspaceId: string }>(
    `${baseUrl}/api/workspaces`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...user.headers },
      body: JSON.stringify({ name: `Webhook Status ${Date.now()} ${suffix}` }),
    },
  );

  const workspaceRecord = new RecordId("workspace", workspace.workspaceId);
  const taskId = `wh-task-${suffix}-${Date.now()}`;
  const taskRecord = new RecordId("task", taskId);

  await surreal.create(taskRecord).content({
    workspace: workspaceRecord,
    title: `Webhook status test task ${suffix}`,
    status: taskStatus,
    category: "engineering",
    priority: "medium",
    created_at: new Date(),
    updated_at: new Date(),
  });

  return { user, workspace, workspaceRecord, taskId, taskRecord };
}

describe("GitHub push to feature branch sets task to done (US-5)", () => {
  // Walking skeleton: push to feature branch with task ref -> task done

  it("Given a task in_progress, When a commit referencing it is pushed to a feature branch, Then the task status becomes 'done' and an implemented_by relation is created", async () => {
    const { baseUrl, surreal } = getRuntime();
    const { workspace, taskId, taskRecord } = await setupWorkspaceWithTask(
      baseUrl, surreal, "feat-done-1", "in_progress",
    );

    const sha = `feat${Date.now().toString(16)}deadbeef`;
    const event = makePushEvent({
      ref: "refs/heads/feature/login",
      defaultBranch: "main",
      commits: [{
        id: sha,
        message: `task:${taskId} implement login flow`,
        timestamp: new Date().toISOString(),
        url: `https://github.com/acme/brain/commit/${sha}`,
        author: { name: "Marcus", email: "marcus@test.com", username: "marcus-sa" },
      }],
    });

    const res = await fetch(
      `${baseUrl}/api/workspaces/${workspace.workspaceId}/webhooks/github`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-github-event": "push",
        },
        body: JSON.stringify(event),
      },
    );

    expect(res.status).toBe(202);

    // Poll for task status to change to done (async processing)
    const finalStatus = await pollForTaskStatus(surreal, taskRecord, "done", 20_000);
    expect(finalStatus).toBe("done");

    // Verify implemented_by relation exists
    const [linkRows] = await surreal
      .query<[Array<{ id: RecordId }>]>(
        "SELECT id FROM implemented_by WHERE `in` = $task;",
        { task: taskRecord },
      )
      .collect<[Array<{ id: RecordId }>]>();

    expect(linkRows.length).toBeGreaterThan(0);
  }, 45_000);

  it("Given a task already 'done', When a push references it on a feature branch, Then the task remains 'done' (idempotent)", async () => {
    const { baseUrl, surreal } = getRuntime();
    const { workspace, taskId, taskRecord } = await setupWorkspaceWithTask(
      baseUrl, surreal, "feat-idemp-1", "done",
    );

    const sha = `idemp${Date.now().toString(16)}deadbeef`;
    const event = makePushEvent({
      ref: "refs/heads/feature/cleanup",
      defaultBranch: "main",
      commits: [{
        id: sha,
        message: `task:${taskId} minor cleanup`,
        timestamp: new Date().toISOString(),
        url: `https://github.com/acme/brain/commit/${sha}`,
        author: { name: "Marcus", email: "marcus@test.com" },
      }],
    });

    await fetch(
      `${baseUrl}/api/workspaces/${workspace.workspaceId}/webhooks/github`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-github-event": "push",
        },
        body: JSON.stringify(event),
      },
    );

    // Wait a bit for async processing
    await Bun.sleep(5_000);

    const [rows] = await surreal
      .query<[Array<{ status: string }>]>(
        "SELECT status FROM $task;",
        { task: taskRecord },
      )
      .collect<[Array<{ status: string }>]>();

    expect(rows[0]?.status).toBe("done");
  }, 30_000);
});

describe("GitHub push to main sets task to completed (US-6)", () => {
  // Walking skeleton: merge to main -> task completed

  it("Given a task with status 'done', When a commit referencing it is pushed to main, Then the task status becomes 'completed'", async () => {
    const { baseUrl, surreal } = getRuntime();
    const { workspace, taskId, taskRecord } = await setupWorkspaceWithTask(
      baseUrl, surreal, "main-comp-1", "done",
    );

    const sha = `main${Date.now().toString(16)}deadbeef`;
    const event = makePushEvent({
      ref: "refs/heads/main",
      defaultBranch: "main",
      commits: [{
        id: sha,
        message: `task:${taskId} finalize login flow`,
        timestamp: new Date().toISOString(),
        url: `https://github.com/acme/brain/commit/${sha}`,
        author: { name: "Marcus", email: "marcus@test.com", username: "marcus-sa" },
      }],
    });

    const res = await fetch(
      `${baseUrl}/api/workspaces/${workspace.workspaceId}/webhooks/github`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-github-event": "push",
        },
        body: JSON.stringify(event),
      },
    );

    expect(res.status).toBe(202);

    const finalStatus = await pollForTaskStatus(surreal, taskRecord, "completed", 20_000);
    expect(finalStatus).toBe("completed");
  }, 45_000);

  it("Given a task with status 'in_progress', When a commit referencing it lands on main, Then the task status becomes 'completed'", async () => {
    const { baseUrl, surreal } = getRuntime();
    const { workspace, taskId, taskRecord } = await setupWorkspaceWithTask(
      baseUrl, surreal, "main-skip-1", "in_progress",
    );

    const sha = `skip${Date.now().toString(16)}deadbeef`;
    const event = makePushEvent({
      ref: "refs/heads/main",
      defaultBranch: "main",
      commits: [{
        id: sha,
        message: `task:${taskId} direct commit to main`,
        timestamp: new Date().toISOString(),
        url: `https://github.com/acme/brain/commit/${sha}`,
        author: { name: "Marcus", email: "marcus@test.com" },
      }],
    });

    await fetch(
      `${baseUrl}/api/workspaces/${workspace.workspaceId}/webhooks/github`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-github-event": "push",
        },
        body: JSON.stringify(event),
      },
    );

    const finalStatus = await pollForTaskStatus(surreal, taskRecord, "completed", 20_000);
    expect(finalStatus).toBe("completed");
  }, 45_000);

  it("Given a task already 'completed', When a merge to main references it again, Then the task remains 'completed' (idempotent)", async () => {
    const { baseUrl, surreal } = getRuntime();
    const { workspace, taskId, taskRecord } = await setupWorkspaceWithTask(
      baseUrl, surreal, "main-idemp-1", "completed",
    );

    const sha = `midemp${Date.now().toString(16)}deadbeef`;
    const event = makePushEvent({
      ref: "refs/heads/main",
      defaultBranch: "main",
      commits: [{
        id: sha,
        message: `task:${taskId} already completed`,
        timestamp: new Date().toISOString(),
        url: `https://github.com/acme/brain/commit/${sha}`,
        author: { name: "Marcus", email: "marcus@test.com" },
      }],
    });

    await fetch(
      `${baseUrl}/api/workspaces/${workspace.workspaceId}/webhooks/github`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-github-event": "push",
        },
        body: JSON.stringify(event),
      },
    );

    await Bun.sleep(5_000);

    const [rows] = await surreal
      .query<[Array<{ status: string }>]>(
        "SELECT status FROM $task;",
        { task: taskRecord },
      )
      .collect<[Array<{ status: string }>]>();

    expect(rows[0]?.status).toBe("completed");
  }, 30_000);

  it("Given a push to a non-main branch, When the same commit later merges to main, Then status upgrades from done to completed", async () => {
    const { baseUrl, surreal } = getRuntime();
    const { workspace, taskId, taskRecord } = await setupWorkspaceWithTask(
      baseUrl, surreal, "upgrade-1", "in_progress",
    );

    const sha = `upgrd${Date.now().toString(16)}deadbeef`;
    const commitData = {
      id: sha,
      message: `task:${taskId} implement feature`,
      timestamp: new Date().toISOString(),
      url: `https://github.com/acme/brain/commit/${sha}`,
      author: { name: "Marcus", email: "marcus@test.com", username: "marcus-sa" },
    };

    // First: push to feature branch -> should set done
    const featureEvent = makePushEvent({
      ref: "refs/heads/feature/my-work",
      defaultBranch: "main",
      commits: [commitData],
    });

    await fetch(
      `${baseUrl}/api/workspaces/${workspace.workspaceId}/webhooks/github`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-github-event": "push",
        },
        body: JSON.stringify(featureEvent),
      },
    );

    const doneStatus = await pollForTaskStatus(surreal, taskRecord, "done", 20_000);
    expect(doneStatus).toBe("done");

    // Second: merge to main -> should upgrade to completed
    const mainEvent = makePushEvent({
      ref: "refs/heads/main",
      defaultBranch: "main",
      commits: [{ ...commitData, id: `merge${sha}` }],
    });

    await fetch(
      `${baseUrl}/api/workspaces/${workspace.workspaceId}/webhooks/github`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-github-event": "push",
        },
        body: JSON.stringify(mainEvent),
      },
    );

    const completedStatus = await pollForTaskStatus(surreal, taskRecord, "completed", 20_000);
    expect(completedStatus).toBe("completed");
  }, 60_000);
});

describe("push without task refs does not affect task status", () => {
  it("Given a task in_progress, When a commit without task refs is pushed, Then the task status remains unchanged", async () => {
    const { baseUrl, surreal } = getRuntime();
    const { workspace, taskRecord } = await setupWorkspaceWithTask(
      baseUrl, surreal, "noref-wh-1", "in_progress",
    );

    const sha = `noref${Date.now().toString(16)}deadbeef`;
    const event = makePushEvent({
      ref: "refs/heads/feature/other",
      defaultBranch: "main",
      commits: [{
        id: sha,
        message: "refactor: clean up imports",
        timestamp: new Date().toISOString(),
        url: `https://github.com/acme/brain/commit/${sha}`,
        author: { name: "Marcus", email: "marcus@test.com" },
      }],
    });

    await fetch(
      `${baseUrl}/api/workspaces/${workspace.workspaceId}/webhooks/github`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-github-event": "push",
        },
        body: JSON.stringify(event),
      },
    );

    // Wait for processing then check status unchanged
    await Bun.sleep(5_000);

    const [rows] = await surreal
      .query<[Array<{ status: string }>]>(
        "SELECT status FROM $task;",
        { task: taskRecord },
      )
      .collect<[Array<{ status: string }>]>();

    expect(rows[0]?.status).toBe("in_progress");
  }, 30_000);
});
