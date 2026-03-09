import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RecordId, Surreal } from "surrealdb";
import { getDescriptionEntries } from "../../app/src/server/descriptions/queries";
import { seedDescriptionEntry } from "../../app/src/server/descriptions/persist";
import { fireDescriptionUpdates } from "../../app/src/server/descriptions/triggers";

const surrealUrl = process.env.SURREAL_URL ?? "ws://127.0.0.1:8000/rpc";
const surrealUsername = process.env.SURREAL_USERNAME ?? "root";
const surrealPassword = process.env.SURREAL_PASSWORD ?? "root";

let surreal: Surreal;
let namespace: string;
let database: string;
let workspaceRecord: RecordId<"workspace", string>;
let conversationRecord: RecordId<"conversation", string>;

beforeAll(async () => {
  const runId = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  namespace = `desc_test_${runId}`;
  database = `desc_${Math.floor(Math.random() * 100000)}`;

  surreal = new Surreal();
  await surreal.connect(surrealUrl);
  await surreal.signin({ username: surrealUsername, password: surrealPassword });
  await surreal.query(`DEFINE NAMESPACE ${namespace};`);
  await surreal.use({ namespace });
  await surreal.query(`DEFINE DATABASE ${database};`);
  await surreal.use({ namespace, database });

  const schema = readFileSync(join(process.cwd(), "schema", "surreal-schema.surql"), "utf8");
  await surreal.query(schema);

  // Shared workspace and conversation for all test entities
  workspaceRecord = new RecordId("workspace", randomUUID());
  const now = new Date();
  await surreal.create(workspaceRecord).content({
    name: "Description Test Workspace",
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
}, 30_000);

afterAll(async () => {
  try { await surreal.query(`REMOVE DATABASE ${database};`); } catch {}
  try { await surreal.query(`REMOVE NAMESPACE ${namespace};`); } catch {}
  await surreal.close().catch(() => {});
}, 10_000);

// ── Helpers ──

async function createProject(name: string): Promise<RecordId> {
  const id = randomUUID();
  const record = new RecordId("project", id);
  await surreal.query("CREATE $record CONTENT $content;", {
    record,
    content: { name, status: "active", workspace: workspaceRecord, created_at: new Date() },
  });
  return record;
}

async function createFeature(name: string): Promise<RecordId> {
  const id = randomUUID();
  const record = new RecordId("feature", id);
  await surreal.query("CREATE $record CONTENT $content;", {
    record,
    content: { name, status: "open", workspace: workspaceRecord, created_at: new Date() },
  });
  return record;
}

async function createTask(title: string): Promise<RecordId> {
  const id = randomUUID();
  const record = new RecordId("task", id);
  await surreal.query("CREATE $record CONTENT $content;", {
    record,
    content: { title, status: "open", workspace: workspaceRecord, created_at: new Date() },
  });
  return record;
}

async function createDecision(summary: string): Promise<RecordId> {
  const id = randomUUID();
  const record = new RecordId("decision", id);
  await surreal.query("CREATE $record CONTENT $content;", {
    record,
    content: { summary, status: "extracted", workspace: workspaceRecord, created_at: new Date() },
  });
  return record;
}

async function createMessage(text: string): Promise<RecordId> {
  const id = randomUUID();
  const record = new RecordId("message", id);
  await surreal.query("CREATE $record CONTENT $content;", {
    record,
    content: { text, role: "user", conversation: conversationRecord, createdAt: new Date() },
  });
  return record;
}

async function linkBelongsTo(child: RecordId, parent: RecordId): Promise<void> {
  await surreal.query(
    "RELATE $child->belongs_to->$parent SET added_at = time::now();",
    { child, parent },
  );
}

async function linkHasFeature(project: RecordId, feature: RecordId): Promise<void> {
  await surreal.query(
    "RELATE $project->has_feature->$feature SET added_at = time::now();",
    { project, feature },
  );
}

type EntityRow = {
  id: RecordId;
  description?: string;
  description_entries?: Array<{
    text: string;
    source?: RecordId;
    created_at: string;
  }>;
};

async function fetchEntity(record: RecordId, table: string): Promise<EntityRow> {
  const [rows] = await surreal
    .query<[EntityRow[]]>(
      `SELECT id, description, description_entries FROM ${table} WHERE id = $record LIMIT 1;`,
      { record },
    )
    .collect<[EntityRow[]]>();
  if (rows.length === 0) throw new Error(`Entity not found: ${table}:${record.id}`);
  return rows[0]!;
}

// ── Tests ──

describe("description entries", () => {
  it("seedDescriptionEntry sets description and creates a single entry", async () => {
    const taskRecord = await createTask("Implement login endpoint");
    const messageRecord = await createMessage("We need a login endpoint");

    await seedDescriptionEntry({
      surreal,
      targetRecord: taskRecord,
      text: "JWT-based authentication endpoint",
      source: messageRecord,
    });

    const task = await fetchEntity(taskRecord, "task");

    expect(task.description).toBe("JWT-based authentication endpoint");
    expect(task.description_entries).toHaveLength(1);

    const entry = task.description_entries![0]!;
    expect(entry.text).toBe("JWT-based authentication endpoint");
    expect((entry.source as RecordId).table.name).toBe("message");
    expect((entry.source as RecordId).id).toBe(messageRecord.id);
  });

  it("seedDescriptionEntry works without source", async () => {
    const taskRecord = await createTask("No source task");

    await seedDescriptionEntry({
      surreal,
      targetRecord: taskRecord,
      text: "A task without source",
    });

    const task = await fetchEntity(taskRecord, "task");

    expect(task.description).toBe("A task without source");
    expect(task.description_entries).toHaveLength(1);
    expect(task.description_entries![0]!.source).toBeUndefined();
  });

  it("getDescriptionEntries returns seeded entries", async () => {
    const featureRecord = await createFeature("User authentication");
    const messageRecord = await createMessage("Login and registration");

    await seedDescriptionEntry({
      surreal,
      targetRecord: featureRecord,
      text: "Login and registration flows",
      source: messageRecord,
    });

    const entries = await getDescriptionEntries(surreal, featureRecord);

    expect(entries).toHaveLength(1);
    expect(entries[0]!.text).toBe("Login and registration flows");
  });

  it("getDescriptionEntries returns empty array for entity with no entries", async () => {
    const projectRecord = await createProject("Empty project");
    const entries = await getDescriptionEntries(surreal, projectRecord);
    expect(entries).toEqual([]);
  });

  it("fireDescriptionUpdates propagates decision_confirmed to related project and feature", async () => {
    const projectRecord = await createProject("Billing system");
    const featureRecord = await createFeature("Payment processing");
    const decisionRecord = await createDecision("Use Stripe for payments");

    await linkHasFeature(projectRecord, featureRecord);
    await linkBelongsTo(decisionRecord, projectRecord);
    await linkBelongsTo(decisionRecord, featureRecord);

    // Target entities have no prior entries, so append writes entry #1 → raw text, no LLM needed
    await fireDescriptionUpdates({
      surreal,
      extractionModel: undefined as any, // not needed when appending first entry
      trigger: {
        kind: "decision_confirmed",
        entity: decisionRecord,
        summary: "Decision confirmed: Use Stripe for payments",
      },
    });

    const project = await fetchEntity(projectRecord, "project");
    expect(project.description_entries).toHaveLength(1);
    expect(project.description_entries![0]!.text).toBe("Decision confirmed: Use Stripe for payments");
    expect((project.description_entries![0]!.source as RecordId).table.name).toBe("decision");
    expect(project.description).toBe("Decision confirmed: Use Stripe for payments");

    const feature = await fetchEntity(featureRecord, "feature");
    expect(feature.description_entries).toHaveLength(1);
    expect(feature.description_entries![0]!.text).toBe("Decision confirmed: Use Stripe for payments");
    expect(feature.description).toBe("Decision confirmed: Use Stripe for payments");
  });

  it("fireDescriptionUpdates propagates decision_confirmed to tasks belonging to related project", async () => {
    const projectRecord = await createProject("Auth system");
    const taskRecord = await createTask("Implement OAuth flow");
    const decisionRecord = await createDecision("Use OAuth2 with PKCE");

    await linkBelongsTo(decisionRecord, projectRecord);
    await linkBelongsTo(taskRecord, projectRecord);

    await fireDescriptionUpdates({
      surreal,
      extractionModel: undefined as any,
      trigger: {
        kind: "decision_confirmed",
        entity: decisionRecord,
        summary: "Decision confirmed: Use OAuth2 with PKCE",
      },
    });

    // Project gets the entry
    const project = await fetchEntity(projectRecord, "project");
    expect(project.description_entries).toHaveLength(1);

    // Task also gets the entry (belongs_to same project)
    const task = await fetchEntity(taskRecord, "task");
    expect(task.description_entries).toHaveLength(1);
    expect(task.description_entries![0]!.text).toBe("Decision confirmed: Use OAuth2 with PKCE");
    expect((task.description_entries![0]!.source as RecordId).table.name).toBe("decision");
  });

  it("fireDescriptionUpdates propagates task_completed to parent feature and project", async () => {
    const projectRecord = await createProject("Platform project");
    const featureRecord = await createFeature("API endpoints");
    const taskRecord = await createTask("Build REST routes");

    await linkHasFeature(projectRecord, featureRecord);
    await linkBelongsTo(taskRecord, featureRecord);
    await linkBelongsTo(taskRecord, projectRecord);

    await fireDescriptionUpdates({
      surreal,
      extractionModel: undefined as any,
      trigger: {
        kind: "task_completed",
        entity: taskRecord,
        summary: "Task completed: Build REST routes",
      },
    });

    const feature = await fetchEntity(featureRecord, "feature");
    expect(feature.description_entries).toHaveLength(1);
    expect(feature.description_entries![0]!.text).toBe("Task completed: Build REST routes");

    const project = await fetchEntity(projectRecord, "project");
    expect(project.description_entries).toHaveLength(1);
    expect(project.description_entries![0]!.text).toBe("Task completed: Build REST routes");
  });

  it("fireDescriptionUpdates propagates feature_created to parent project", async () => {
    const projectRecord = await createProject("Main project");
    const featureRecord = await createFeature("Notifications");

    await linkHasFeature(projectRecord, featureRecord);

    await fireDescriptionUpdates({
      surreal,
      extractionModel: undefined as any,
      trigger: {
        kind: "feature_created",
        entity: featureRecord,
        summary: "New feature added: Notifications",
      },
    });

    const project = await fetchEntity(projectRecord, "project");
    expect(project.description_entries).toHaveLength(1);
    expect(project.description_entries![0]!.text).toBe("New feature added: Notifications");
    expect((project.description_entries![0]!.source as RecordId).table.name).toBe("feature");
    expect(project.description).toBe("New feature added: Notifications");
  });

  it("source contains the trigger entity reference", async () => {
    const projectRecord = await createProject("Trigger ref project");
    const decisionRecord = await createDecision("Pick PostgreSQL");

    await linkBelongsTo(decisionRecord, projectRecord);

    await fireDescriptionUpdates({
      surreal,
      extractionModel: undefined as any,
      trigger: {
        kind: "decision_confirmed",
        entity: decisionRecord,
        summary: "Decision confirmed: Pick PostgreSQL",
      },
    });

    const project = await fetchEntity(projectRecord, "project");
    const entry = project.description_entries![0]!;
    const source = entry.source as RecordId;
    expect(source.table.name).toBe("decision");
    expect(source.id).toBe(decisionRecord.id);
  });
});
