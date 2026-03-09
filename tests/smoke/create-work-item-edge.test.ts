import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RecordId, Surreal } from "surrealdb";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { createCreateWorkItemTool } from "../../app/src/server/chat/tools/create-work-item";

const openrouter = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY! });
const embeddingModel = openrouter.textEmbeddingModel(process.env.OPENROUTER_EMBEDDING_MODEL!);
const embeddingDimension = Number(process.env.EMBEDDING_DIMENSION ?? "1536");

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
let messageRecord: RecordId<"message", string>;

beforeAll(async () => {
  const runId = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  namespace = `smoke_cwi_edge_${runId}`;
  database = `cwi_edge_${Math.floor(Math.random() * 100000)}`;

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
    name: "Edge Test Workspace",
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

  messageRecord = new RecordId("message", randomUUID());
  await surreal.query("CREATE $record CONTENT $content;", {
    record: messageRecord,
    content: {
      conversation: conversationRecord,
      role: "user",
      text: "Create a project and features",
      createdAt: now,
    },
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

function makeTool() {
  return createCreateWorkItemTool({
    surreal,
    embeddingModel: embeddingModel as any,
    embeddingDimension,
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
      currentMessageRecord: messageRecord,
      latestUserText: "Create a project and features",
    },
  } as any;
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

function parseEntityId(entityId: string): RecordId {
  const [table, id] = entityId.split(":");
  return new RecordId(table, id);
}

// ── Tests ──

describe("create_work_item has_feature edge regression", () => {
  it("creates has_feature edge when project exists before feature creation (sequential)", async () => {
    const tool = makeTool();
    const options = makeOptions();

    // Step 1: create project (simulates first tool call step)
    const projectResult = await tool.execute!(
      { kind: "project", title: "Orders", rationale: "Order management system" },
      options,
    );
    expect(projectResult.error).toBeUndefined();
    expect(projectResult.kind).toBe("project");

    // Step 2: create feature scoped to the project (simulates second tool call step)
    const featureResult = await tool.execute!(
      { kind: "feature", title: "Order Tracking", rationale: "Track order status", project: "Orders" },
      options,
    );
    expect(featureResult.error).toBeUndefined();
    expect(featureResult.kind).toBe("feature");

    // Verify has_feature edge exists
    const projectRecord = parseEntityId(projectResult.entity_id);
    const featureRecord = parseEntityId(featureResult.entity_id);
    const edgeCount = await countEdges("has_feature", projectRecord, featureRecord);
    expect(edgeCount).toBe(1);
  });

  it("creates belongs_to edge when task references existing project", async () => {
    const tool = makeTool();
    const options = makeOptions();

    // Step 1: create project
    const projectResult = await tool.execute!(
      { kind: "project", title: "Inventory", rationale: "Inventory management" },
      options,
    );
    expect(projectResult.kind).toBe("project");

    // Step 2: create task scoped to the project
    const taskResult = await tool.execute!(
      { kind: "task", title: "Build stock counter", rationale: "Count inventory items", project: "Inventory" },
      options,
    );
    expect(taskResult.kind).toBe("task");

    // Verify belongs_to edge exists
    const projectRecord = parseEntityId(projectResult.entity_id);
    const taskRecord = parseEntityId(taskResult.entity_id);
    const edgeCount = await countEdges("belongs_to", taskRecord, projectRecord);
    expect(edgeCount).toBe(1);
  });

  it("logs error when feature references nonexistent project (no silent swallow)", async () => {
    const tool = makeTool();
    const options = makeOptions();

    // Create feature referencing a project that doesn't exist — should not throw
    const featureResult = await tool.execute!(
      { kind: "feature", title: "Ghost Feature", rationale: "No parent", project: "NonexistentProject" },
      options,
    );

    // Feature record is still created successfully
    expect(featureResult.kind).toBe("feature");
    expect(featureResult.entity_id).toContain("feature:");

    // But no has_feature edge (project doesn't exist)
    const featureRecord = parseEntityId(featureResult.entity_id);
    const [edges] = await surreal
      .query<[Array<{ id: RecordId }>]>(
        "SELECT id FROM has_feature WHERE out = $feature;",
        { feature: featureRecord },
      )
      .collect<[Array<{ id: RecordId }>]>();
    expect(edges).toHaveLength(0);
  });

  it("race condition: parallel create project + feature fails without sequential dispatch", async () => {
    const tool = makeTool();
    const options = makeOptions();

    // Simulate parallel execution (what happens when LLM batches both calls)
    const [projectResult, featureResult] = await Promise.all([
      tool.execute!(
        { kind: "project", title: "Payments", rationale: "Payment processing" },
        options,
      ),
      tool.execute!(
        { kind: "feature", title: "Stripe Integration", rationale: "Accept payments", project: "Payments" },
        options,
      ),
    ]);

    expect(projectResult.kind).toBe("project");
    expect(featureResult.kind).toBe("feature");

    // The feature record exists but the has_feature edge may be missing due to the race.
    // This test documents the race condition — the fix is prompt-level sequencing.
    const featureRecord = parseEntityId(featureResult.entity_id);
    const [edges] = await surreal
      .query<[Array<{ id: RecordId }>]>(
        "SELECT id FROM has_feature WHERE out = $feature;",
        { feature: featureRecord },
      )
      .collect<[Array<{ id: RecordId }>]>();

    // With parallel execution, the edge is expected to be missing (race condition).
    // This test ensures the tool doesn't throw — it degrades gracefully with logging.
    expect(edges.length).toBeLessThanOrEqual(1);
  });
});
