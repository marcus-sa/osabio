import { describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { RecordId, type Surreal } from "surrealdb";
import { generateApiKey, hashApiKey } from "../../app/src/server/mcp/api-key";
import { fetchJson, setupSmokeSuite } from "./smoke-test-kit";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const getRuntime = setupSmokeSuite("intent-context");

type IntentContextResponse = {
  level: "task" | "project" | "workspace";
  data: Record<string, unknown>;
};

type AuthedWorkspace = {
  workspaceId: string;
  workspaceRecord: RecordId<"workspace", string>;
  apiKey: string;
};

async function createWorkspaceWithApiKey(
  baseUrl: string,
  surreal: Surreal,
  name?: string,
): Promise<AuthedWorkspace> {
  const { workspaceId } = await fetchJson<{ workspaceId: string }>(`${baseUrl}/api/workspaces`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: name ?? `Intent Smoke ${Date.now()}`,
      ownerDisplayName: "Test",
    }),
  });

  const workspaceRecord = new RecordId("workspace", workspaceId);
  const apiKey = generateApiKey();
  const hash = await hashApiKey(apiKey);
  await surreal.update(workspaceRecord).merge({
    api_key_hash: hash,
    onboarding_complete: true,
    onboarding_summary_pending: false,
    onboarding_completed_at: new Date(),
  });

  return { workspaceId, workspaceRecord, apiKey };
}

async function seedProject(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
  name: string,
): Promise<RecordId<"project", string>> {
  const projectRecord = new RecordId("project", randomUUID());
  await surreal.create(projectRecord).content({
    name,
    status: "active",
    workspace: workspaceRecord,
    created_at: new Date(),
    updated_at: new Date(),
  });
  await surreal
    .relate(workspaceRecord, new RecordId("has_project", randomUUID()), projectRecord, {
      added_at: new Date(),
    })
    .output("after");
  return projectRecord;
}

async function seedTask(
  surreal: Surreal,
  workspaceRecord: RecordId<"workspace", string>,
  projectRecord: RecordId<"project", string>,
  title: string,
): Promise<RecordId<"task", string>> {
  const taskRecord = new RecordId("task", randomUUID());
  await surreal.create(taskRecord).content({
    title,
    status: "open",
    priority: "medium",
    workspace: workspaceRecord,
    created_at: new Date(),
    updated_at: new Date(),
  });
  await surreal
    .relate(taskRecord, new RecordId("belongs_to", randomUUID()), projectRecord, {
      added_at: new Date(),
    })
    .output("after");
  return taskRecord;
}

function postContext(
  baseUrl: string,
  workspaceId: string,
  apiKey: string,
  body: { intent: string; cwd?: string; paths?: string[] },
): Promise<IntentContextResponse> {
  return fetchJson<IntentContextResponse>(`${baseUrl}/api/mcp/${workspaceId}/context`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("intent-context integration", () => {
  // ---- Auth ----

  it("rejects request without auth header", async () => {
    const { baseUrl, surreal } = getRuntime();
    const ws = await createWorkspaceWithApiKey(baseUrl, surreal);

    const response = await fetch(`${baseUrl}/api/mcp/${ws.workspaceId}/context`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intent: "anything" }),
    });

    expect(response.status).toBe(401);
  }, 30_000);

  it("rejects request with invalid api key", async () => {
    const { baseUrl, surreal } = getRuntime();
    const ws = await createWorkspaceWithApiKey(baseUrl, surreal);

    const response = await fetch(`${baseUrl}/api/mcp/${ws.workspaceId}/context`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer brain_invalid_key_000000000000000000000000000000",
      },
      body: JSON.stringify({ intent: "anything" }),
    });

    expect(response.status).toBe(401);
  }, 30_000);

  // ---- Validation ----

  it("returns 400 when intent is missing", async () => {
    const { baseUrl, surreal } = getRuntime();
    const ws = await createWorkspaceWithApiKey(baseUrl, surreal);

    const response = await fetch(`${baseUrl}/api/mcp/${ws.workspaceId}/context`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ws.apiKey}`,
      },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(400);
  }, 30_000);

  // ---- Step 1: Explicit entity references ----

  it("resolves explicit task:id to task-level context", async () => {
    const { baseUrl, surreal } = getRuntime();
    const ws = await createWorkspaceWithApiKey(baseUrl, surreal);
    const project = await seedProject(surreal, ws.workspaceRecord, "Platform");
    const task = await seedTask(surreal, ws.workspaceRecord, project, "Implement auth flow");
    const taskId = task.id as string;

    const result = await postContext(baseUrl, ws.workspaceId, ws.apiKey, {
      intent: `I need context for task:${taskId}`,
    });

    expect(result.level).toBe("task");
    expect(result.data).toBeDefined();
  }, 30_000);

  it("resolves explicit project:id to project-level context", async () => {
    const { baseUrl, surreal } = getRuntime();
    const ws = await createWorkspaceWithApiKey(baseUrl, surreal);
    const project = await seedProject(surreal, ws.workspaceRecord, "Platform");
    const projectId = project.id as string;

    const result = await postContext(baseUrl, ws.workspaceId, ws.apiKey, {
      intent: `Give me context for project:${projectId}`,
    });

    expect(result.level).toBe("project");
    expect(result.data).toBeDefined();
  }, 30_000);

  it("falls through when explicit task:id does not exist", async () => {
    const { baseUrl, surreal } = getRuntime();
    const ws = await createWorkspaceWithApiKey(baseUrl, surreal);

    const result = await postContext(baseUrl, ws.workspaceId, ws.apiKey, {
      intent: "Working on task:nonexistent-id-12345",
    });

    // No projects, no embeddings, no paths → workspace fallback
    expect(result.level).toBe("workspace");
  }, 30_000);

  // ---- Step 2: Single-project shortcut ----

  it("returns project context for single-project workspace", async () => {
    const { baseUrl, surreal } = getRuntime();
    const ws = await createWorkspaceWithApiKey(baseUrl, surreal);
    await seedProject(surreal, ws.workspaceRecord, "Only Project");

    const result = await postContext(baseUrl, ws.workspaceId, ws.apiKey, {
      intent: "What should I work on next?",
    });

    expect(result.level).toBe("project");
  }, 30_000);

  // ---- Step 4: Path matching ----

  it("matches cwd path segments to project name", async () => {
    const { baseUrl, surreal } = getRuntime();
    const ws = await createWorkspaceWithApiKey(baseUrl, surreal);
    await seedProject(surreal, ws.workspaceRecord, "Brain Platform");
    await seedProject(surreal, ws.workspaceRecord, "Mobile App");

    const result = await postContext(baseUrl, ws.workspaceId, ws.apiKey, {
      intent: "What should I do?",
      cwd: "/Users/dev/projects/brain-platform/src",
    });

    expect(result.level).toBe("project");
  }, 30_000);

  it("matches paths array to project name", async () => {
    const { baseUrl, surreal } = getRuntime();
    const ws = await createWorkspaceWithApiKey(baseUrl, surreal);
    await seedProject(surreal, ws.workspaceRecord, "Brain Platform");
    await seedProject(surreal, ws.workspaceRecord, "Mobile App");

    const result = await postContext(baseUrl, ws.workspaceId, ws.apiKey, {
      intent: "Help me with this file",
      paths: ["/workspace/mobile-app/components/Button.tsx"],
    });

    expect(result.level).toBe("project");
  }, 30_000);

  // ---- Step 5: Fallback ----

  it("returns workspace overview when nothing matches", async () => {
    const { baseUrl, surreal } = getRuntime();
    const ws = await createWorkspaceWithApiKey(baseUrl, surreal);

    const result = await postContext(baseUrl, ws.workspaceId, ws.apiKey, {
      intent: "Tell me something",
    });

    expect(result.level).toBe("workspace");
  }, 30_000);

  it("returns workspace overview for multi-project workspace with no signal", async () => {
    const { baseUrl, surreal } = getRuntime();
    const ws = await createWorkspaceWithApiKey(baseUrl, surreal);
    await seedProject(surreal, ws.workspaceRecord, "Alpha");
    await seedProject(surreal, ws.workspaceRecord, "Beta");

    const result = await postContext(baseUrl, ws.workspaceId, ws.apiKey, {
      intent: "What's the weather like?",
    });

    expect(result.level).toBe("workspace");
  }, 30_000);

  // ---- Response shape ----

  it("workspace response includes projects array", async () => {
    const { baseUrl, surreal } = getRuntime();
    const ws = await createWorkspaceWithApiKey(baseUrl, surreal);
    await seedProject(surreal, ws.workspaceRecord, "Alpha");
    await seedProject(surreal, ws.workspaceRecord, "Beta");

    const result = await postContext(baseUrl, ws.workspaceId, ws.apiKey, {
      intent: "Overview please",
    });

    expect(result.level).toBe("workspace");
    const data = result.data as Record<string, unknown>;
    expect(data.workspace).toBeDefined();
    expect(Array.isArray(data.projects)).toBe(true);
    expect((data.projects as unknown[]).length).toBe(2);
  }, 30_000);

  it("project response includes decisions and tasks sections", async () => {
    const { baseUrl, surreal } = getRuntime();
    const ws = await createWorkspaceWithApiKey(baseUrl, surreal);
    const project = await seedProject(surreal, ws.workspaceRecord, "Solo Project");
    await seedTask(surreal, ws.workspaceRecord, project, "Build login page");

    const result = await postContext(baseUrl, ws.workspaceId, ws.apiKey, {
      intent: "What am I working on?",
    });

    expect(result.level).toBe("project");
    const data = result.data as Record<string, unknown>;
    expect(data.workspace).toBeDefined();
    expect(data.project).toBeDefined();
    expect(data.decisions).toBeDefined();
    expect(data.active_tasks).toBeDefined();
  }, 30_000);

  it("task response includes task_scope section", async () => {
    const { baseUrl, surreal } = getRuntime();
    const ws = await createWorkspaceWithApiKey(baseUrl, surreal);
    const project = await seedProject(surreal, ws.workspaceRecord, "Platform");
    const task = await seedTask(surreal, ws.workspaceRecord, project, "Fix auth bug");
    const taskId = task.id as string;

    const result = await postContext(baseUrl, ws.workspaceId, ws.apiKey, {
      intent: `Working on task:${taskId}`,
    });

    expect(result.level).toBe("task");
    const data = result.data as Record<string, unknown>;
    expect(data.workspace).toBeDefined();
    expect(data.task_scope).toBeDefined();
  }, 30_000);
});
