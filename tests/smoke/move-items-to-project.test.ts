import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RecordId, Surreal } from "surrealdb";
import { createMoveItemsToProjectTool } from "../../app/src/server/chat/tools/move-items-to-project";

const surrealUrl = process.env.SURREAL_URL ?? "ws://127.0.0.1:8000/rpc";
const surrealUsername = process.env.SURREAL_USERNAME ?? "root";
const surrealPassword = process.env.SURREAL_PASSWORD ?? "root";

let surreal: Surreal;
let namespace: string;
let database: string;
let workspaceRecord: RecordId<"workspace", string>;
let conversationRecord: RecordId<"conversation", string>;
let personRecord: RecordId<"person", string>;
let identityRecord: RecordId<"identity", string>;

beforeAll(async () => {
  const runId = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  namespace = `smoke_move_${runId}`;
  database = `move_items_${Math.floor(Math.random() * 100000)}`;

  surreal = new Surreal();
  await surreal.connect(surrealUrl);
  await surreal.signin({ username: surrealUsername, password: surrealPassword });
  await surreal.query(`DEFINE NAMESPACE ${namespace};`);
  await surreal.use({ namespace });
  await surreal.query(`DEFINE DATABASE ${database};`);
  await surreal.use({ namespace, database });

  const schemaSql = readFileSync(join(process.cwd(), "schema", "surreal-schema.surql"), "utf8");
  await surreal.query(schemaSql);

  const now = new Date();

  workspaceRecord = new RecordId("workspace", randomUUID());
  await surreal.create(workspaceRecord).content({
    name: "Move Items Test Workspace",
    status: "active",
    onboarding_complete: true,
    onboarding_turn_count: 0,
    onboarding_summary_pending: false,
    onboarding_started_at: now,
    created_at: now,
  });

  conversationRecord = new RecordId("conversation", randomUUID());
  await surreal.create(conversationRecord).content({
    workspace: workspaceRecord,
    createdAt: now,
    updatedAt: now,
  });

  personRecord = new RecordId("person", randomUUID());
  await surreal.query("CREATE $record CONTENT $content;", {
    record: personRecord,
    content: { name: "Test User", contact_email: "test@test.local", created_at: now, updated_at: now },
  });
  identityRecord = new RecordId("identity", randomUUID());
  await surreal.query("CREATE $record CONTENT $content;", {
    record: identityRecord,
    content: { name: "Test User", type: "human", workspace: workspaceRecord, created_at: now },
  });
  await surreal.query("RELATE $identity->identity_person->$person SET added_at = time::now();", {
    identity: identityRecord,
    person: personRecord,
  });
  await surreal.query("RELATE $identity->member_of->$workspace SET added_at = time::now();", {
    identity: identityRecord,
    workspace: workspaceRecord,
  });
}, 30_000);

afterAll(async () => {
  if (!surreal) return;
  try {
    await surreal.query(`REMOVE DATABASE ${database};`);
    await surreal.query(`REMOVE NAMESPACE ${namespace};`);
  } catch {}
  await surreal.close().catch(() => {});
}, 10_000);

// ── Helpers ──

async function createProject(name: string): Promise<RecordId<"project", string>> {
  const record = new RecordId("project", randomUUID());
  await surreal.query("CREATE $record CONTENT $content;", {
    record,
    content: { name, status: "active", workspace: workspaceRecord, created_at: new Date() },
  });
  await surreal.query("RELATE $workspace->has_project->$project SET added_at = time::now();", {
    workspace: workspaceRecord,
    project: record,
  });
  return record;
}

async function createFeature(name: string): Promise<RecordId<"feature", string>> {
  const record = new RecordId("feature", randomUUID());
  await surreal.query("CREATE $record CONTENT $content;", {
    record,
    content: { name, status: "open", workspace: workspaceRecord, created_at: new Date() },
  });
  return record;
}

async function createTask(title: string): Promise<RecordId<"task", string>> {
  const record = new RecordId("task", randomUUID());
  await surreal.query("CREATE $record CONTENT $content;", {
    record,
    content: { title, status: "open", workspace: workspaceRecord, created_at: new Date() },
  });
  return record;
}

async function linkHasFeature(project: RecordId, feature: RecordId): Promise<void> {
  await surreal.query("RELATE $project->has_feature->$feature SET added_at = time::now();", {
    project,
    feature,
  });
}

async function linkBelongsTo(child: RecordId, parent: RecordId): Promise<void> {
  await surreal.query("RELATE $child->belongs_to->$parent SET added_at = time::now();", {
    child,
    parent,
  });
}

async function countEdges(table: string, from: RecordId, to: RecordId): Promise<number> {
  const [rows] = await surreal
    .query<[Array<{ count: number }>]>(
      `SELECT count() AS count FROM ${table} WHERE \`in\` = $from AND out = $to GROUP ALL;`,
      { from, to },
    )
    .collect<[Array<{ count: number }>]>();
  return rows.length > 0 ? rows[0].count : 0;
}

function makeTool() {
  return createMoveItemsToProjectTool({
    surreal,
    embeddingModel: {} as any,
    embeddingDimension: 1536,
    extractionModelId: "test",
    extractionModel: {} as any,
    extractionStoreThreshold: 0.5,
  });
}

function makeOptions() {
  return {
    toolCallId: "call-1",
    messages: [],
    experimental_context: {
      actor: "pm_agent" as const,
      humanPresent: true,
      identityRecord,
      workspaceRecord,
      conversationRecord,
      currentMessageRecord: new RecordId("message", randomUUID()),
      latestUserText: "move these to the new project",
    },
  } as any;
}

// ── Tests ──

describe("move_items_to_project smoke", () => {
  it("moves a feature from project A to project B", async () => {
    const projectA = await createProject("Dashboard");
    const projectB = await createProject("Orders");
    const feature = await createFeature("Filterable order table");
    await linkHasFeature(projectA, feature);

    // Verify initial state
    expect(await countEdges("has_feature", projectA, feature)).toBe(1);
    expect(await countEdges("has_feature", projectB, feature)).toBe(0);

    const tool = makeTool();
    const result = await tool.execute!(
      { entity_ids: [`feature:${feature.id}`], target_project: "Orders" },
      makeOptions(),
    );

    expect(result.moved).toHaveLength(1);
    expect(result.moved[0].title).toBe("Filterable order table");
    expect(result.failed).toHaveLength(0);

    // Old edge removed, new edge created
    expect(await countEdges("has_feature", projectA, feature)).toBe(0);
    expect(await countEdges("has_feature", projectB, feature)).toBe(1);
  });

  it("moves a task from project A to project B, preserving feature edge", async () => {
    const projectA = await createProject("Dashboard Tasks");
    const projectB = await createProject("Orders Tasks");
    const feature = await createFeature("Order management");
    await linkHasFeature(projectA, feature);

    const task = await createTask("Implement order filter");
    await linkBelongsTo(task, projectA);
    await linkBelongsTo(task, feature);

    // Verify initial state
    expect(await countEdges("belongs_to", task, projectA)).toBe(1);
    expect(await countEdges("belongs_to", task, feature)).toBe(1);

    const tool = makeTool();
    const result = await tool.execute!(
      { entity_ids: [`task:${task.id}`], target_project: "Orders Tasks" },
      makeOptions(),
    );

    expect(result.moved).toHaveLength(1);
    expect(result.moved[0].title).toBe("Implement order filter");
    expect(result.failed).toHaveLength(0);

    // Project edge swapped
    expect(await countEdges("belongs_to", task, projectA)).toBe(0);
    expect(await countEdges("belongs_to", task, projectB)).toBe(1);

    // Feature edge preserved
    expect(await countEdges("belongs_to", task, feature)).toBe(1);
  });

  it("moves multiple entities in one call", async () => {
    const projectA = await createProject("Source Project");
    const projectB = await createProject("Target Project");
    const f1 = await createFeature("Feature one");
    const f2 = await createFeature("Feature two");
    await linkHasFeature(projectA, f1);
    await linkHasFeature(projectA, f2);

    const tool = makeTool();
    const result = await tool.execute!(
      {
        entity_ids: [`feature:${f1.id}`, `feature:${f2.id}`],
        target_project: "Target Project",
      },
      makeOptions(),
    );

    expect(result.moved).toHaveLength(2);
    expect(result.failed).toHaveLength(0);

    expect(await countEdges("has_feature", projectA, f1)).toBe(0);
    expect(await countEdges("has_feature", projectA, f2)).toBe(0);
    expect(await countEdges("has_feature", projectB, f1)).toBe(1);
    expect(await countEdges("has_feature", projectB, f2)).toBe(1);
  });

  it("fails gracefully for nonexistent target project", async () => {
    const projectA = await createProject("Existing");
    const feature = await createFeature("Some feature");
    await linkHasFeature(projectA, feature);

    const tool = makeTool();
    const result = await tool.execute!(
      { entity_ids: [`feature:${feature.id}`], target_project: "Nonexistent Project" },
      makeOptions(),
    );

    expect(result.error).toBeDefined();
    expect(result.moved).toHaveLength(0);
    expect(result.failed).toHaveLength(1);

    // Original edge untouched
    expect(await countEdges("has_feature", projectA, feature)).toBe(1);
  });

  it("rejects unsupported entity types", async () => {
    await createProject("Some Project");

    const tool = makeTool();
    const result = await tool.execute!(
      { entity_ids: ["decision:fake-id"], target_project: "Some Project" },
      makeOptions(),
    );

    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].reason).toContain("must be one of");
  });
});
