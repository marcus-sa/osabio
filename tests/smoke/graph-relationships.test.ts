import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RecordId, Surreal } from "surrealdb";
import {
  getEntityDetail,
  getProjectGraphView,
  getWorkspaceGraphOverview,
  getFocusedGraphView,
  listEntityNeighbors,
  type GraphEntityRecord,
} from "../../app/src/server/graph/queries";

/**
 * Regression tests for three root causes:
 * RC1: listEntityNeighbors / entity detail ignores structural relation tables (belongs_to, has_feature, etc.)
 * RC2: getWorkspaceGraphOverview omits tasks, decisions, questions, persons
 * RC3: collectEntityRelationEdges ignores structural edges in graph views
 */

const surrealUrl = process.env.SURREAL_URL ?? "ws://127.0.0.1:8000/rpc";
const surrealUsername = process.env.SURREAL_USERNAME ?? "root";
const surrealPassword = process.env.SURREAL_PASSWORD ?? "root";

let surreal: Surreal;
let namespace: string;
let database: string;

let workspaceRecord: RecordId<"workspace", string>;
let projectRecord: RecordId<"project", string>;
let featureRecord: RecordId<"feature", string>;
let taskRecord: RecordId<"task", string>;
let decisionRecord: RecordId<"decision", string>;
let questionRecord: RecordId<"question", string>;
let personRecord: RecordId<"person", string>;
let identityRecord: RecordId<"identity", string>;

beforeAll(async () => {
  const runId = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  namespace = `smoke_graph_rel_${runId}`;
  database = `graph_rel_${Math.floor(Math.random() * 100000)}`;

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

  // Create workspace
  workspaceRecord = new RecordId("workspace", randomUUID());
  await surreal.create(workspaceRecord).content({
    name: "Graph Relationships Test Workspace",
    status: "active",
    onboarding_complete: true,
    onboarding_turn_count: 0,
    onboarding_summary_pending: false,
    onboarding_started_at: now,
    created_at: now,
  });

  // Create project linked to workspace
  projectRecord = new RecordId("project", randomUUID());
  await surreal.query("CREATE $record CONTENT $content;", {
    record: projectRecord,
    content: { name: "Test Project", status: "active", workspace: workspaceRecord, created_at: now, updated_at: now },
  });
  await surreal.query("RELATE $workspace->has_project->$project SET added_at = $now;", {
    workspace: workspaceRecord,
    project: projectRecord,
    now,
  });

  // Create feature linked to project
  featureRecord = new RecordId("feature", randomUUID());
  await surreal.query("CREATE $record CONTENT $content;", {
    record: featureRecord,
    content: { name: "Test Feature", status: "active", workspace: workspaceRecord, created_at: now, updated_at: now },
  });
  await surreal.query("RELATE $project->has_feature->$feature SET added_at = $now;", {
    project: projectRecord,
    feature: featureRecord,
    now,
  });

  // Create task belonging to project (via belongs_to)
  taskRecord = new RecordId("task", randomUUID());
  await surreal.query("CREATE $record CONTENT $content;", {
    record: taskRecord,
    content: { title: "Test Task", status: "open", workspace: workspaceRecord, created_at: now, updated_at: now },
  });
  await surreal.query("RELATE $task->belongs_to->$project SET added_at = $now;", {
    task: taskRecord,
    project: projectRecord,
    now,
  });

  // Create decision belonging to project
  decisionRecord = new RecordId("decision", randomUUID());
  await surreal.query("CREATE $record CONTENT $content;", {
    record: decisionRecord,
    content: { summary: "Test Decision", status: "proposed", workspace: workspaceRecord, created_at: now, updated_at: now },
  });
  await surreal.query("RELATE $decision->belongs_to->$project SET added_at = $now;", {
    decision: decisionRecord,
    project: projectRecord,
    now,
  });

  // Create question belonging to project
  questionRecord = new RecordId("question", randomUUID());
  await surreal.query("CREATE $record CONTENT $content;", {
    record: questionRecord,
    content: { text: "Test Question?", status: "open", workspace: workspaceRecord, created_at: now, updated_at: now },
  });
  await surreal.query("RELATE $question->belongs_to->$project SET added_at = $now;", {
    question: questionRecord,
    project: projectRecord,
    now,
  });

  // Create person and identity linked to workspace
  personRecord = new RecordId("person", randomUUID());
  await surreal.query("CREATE $record CONTENT $content;", {
    record: personRecord,
    content: { name: "Test Person", contact_email: "test@test.local", created_at: now, updated_at: now },
  });
  identityRecord = new RecordId("identity", randomUUID());
  await surreal.query("CREATE $record CONTENT $content;", {
    record: identityRecord,
    content: { name: "Test Person", type: "human", workspace: workspaceRecord, created_at: now },
  });
  await surreal.query("RELATE $identity->identity_person->$person SET added_at = $now;", {
    identity: identityRecord,
    person: personRecord,
    now,
  });
  await surreal.query("RELATE $identity->member_of->$workspace SET added_at = $now;", {
    identity: identityRecord,
    workspace: workspaceRecord,
    now,
  });

  // Create an owns edge (identity -> task)
  await surreal.query("RELATE $identity->owns->$task SET assigned_at = $now;", {
    identity: identityRecord,
    task: taskRecord,
    now,
  });

  // Create a depends_on edge (task -> feature)
  await surreal.query("RELATE $task->depends_on->$feature SET type = 'needs', added_at = $now;", {
    task: taskRecord,
    feature: featureRecord,
    now,
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

describe("RC1: entity detail shows structural relationships", () => {
  it("task detail includes belongs_to relationship to project", async () => {
    const detail = await getEntityDetail({
      surreal,
      workspaceRecord,
      entityRecord: taskRecord as GraphEntityRecord,
    });

    const projectRel = detail.relationships.find(
      (r) => r.kind === "project" && r.name === "Test Project",
    );
    expect(projectRel).toBeDefined();
    expect(projectRel!.relationKind).toBe("belongs_to");
    expect(projectRel!.direction).toBe("outgoing");
  });

  it("project detail includes belongs_to relationships from task, decision, question", async () => {
    const detail = await getEntityDetail({
      surreal,
      workspaceRecord,
      entityRecord: projectRecord as GraphEntityRecord,
    });

    const taskRel = detail.relationships.find((r) => r.kind === "task" && r.name === "Test Task");
    const decisionRel = detail.relationships.find((r) => r.kind === "decision" && r.name === "Test Decision");
    const questionRel = detail.relationships.find((r) => r.kind === "question" && r.name === "Test Question?");

    expect(taskRel).toBeDefined();
    expect(taskRel!.relationKind).toBe("belongs_to");
    expect(taskRel!.direction).toBe("incoming");

    expect(decisionRel).toBeDefined();
    expect(questionRel).toBeDefined();
  });

  it("project detail includes has_feature relationship", async () => {
    const detail = await getEntityDetail({
      surreal,
      workspaceRecord,
      entityRecord: projectRecord as GraphEntityRecord,
    });

    const featureRel = detail.relationships.find(
      (r) => r.kind === "feature" && r.name === "Test Feature",
    );
    expect(featureRel).toBeDefined();
    expect(featureRel!.relationKind).toBe("has_feature");
    expect(featureRel!.direction).toBe("outgoing");
  });

  it("task detail includes owns relationship from identity", async () => {
    const detail = await getEntityDetail({
      surreal,
      workspaceRecord,
      entityRecord: taskRecord as GraphEntityRecord,
    });

    const ownerRel = detail.relationships.find(
      (r) => r.kind === "identity" && r.name === "Test Person",
    );
    expect(ownerRel).toBeDefined();
    expect(ownerRel!.relationKind).toBe("owns");
    expect(ownerRel!.direction).toBe("incoming");
  });

  it("task detail includes depends_on relationship to feature", async () => {
    const detail = await getEntityDetail({
      surreal,
      workspaceRecord,
      entityRecord: taskRecord as GraphEntityRecord,
    });

    const depRel = detail.relationships.find(
      (r) => r.kind === "feature" && r.name === "Test Feature" && r.relationKind === "depends_on",
    );
    expect(depRel).toBeDefined();
    expect(depRel!.direction).toBe("outgoing");
  });

  it("listEntityNeighbors returns structural neighbors", async () => {
    const neighbors = await listEntityNeighbors({
      surreal,
      workspaceRecord,
      entityRecord: taskRecord as GraphEntityRecord,
      limit: 40,
    });

    const kinds = neighbors.map((n) => n.relationKind);
    expect(kinds).toContain("belongs_to");
    expect(kinds).toContain("owns");
    expect(kinds).toContain("depends_on");
  });
});

describe("RC2: workspace graph overview includes all entity types", () => {
  it("workspace graph overview includes tasks", async () => {
    const graph = await getWorkspaceGraphOverview({
      surreal,
      workspaceRecord,
    });

    const taskEntity = graph.entities.find((e) => e.kind === "task");
    expect(taskEntity).toBeDefined();
    expect(taskEntity!.name).toBe("Test Task");
  });

  it("workspace graph overview includes decisions", async () => {
    const graph = await getWorkspaceGraphOverview({
      surreal,
      workspaceRecord,
    });

    const decisionEntity = graph.entities.find((e) => e.kind === "decision");
    expect(decisionEntity).toBeDefined();
    expect(decisionEntity!.name).toBe("Test Decision");
  });

  it("workspace graph overview includes questions", async () => {
    const graph = await getWorkspaceGraphOverview({
      surreal,
      workspaceRecord,
    });

    const questionEntity = graph.entities.find((e) => e.kind === "question");
    expect(questionEntity).toBeDefined();
    expect(questionEntity!.name).toBe("Test Question?");
  });

  it("workspace graph overview includes identities", async () => {
    const graph = await getWorkspaceGraphOverview({
      surreal,
      workspaceRecord,
    });

    // The graph may show identity or person depending on traversal; check for identity (hub-spoke model)
    const identityEntity = graph.entities.find((e) => e.kind === "identity");
    const personEntity = graph.entities.find((e) => e.kind === "person");
    const found = identityEntity ?? personEntity;
    expect(found).toBeDefined();
    expect(found!.name).toBe("Test Person");
  });
});

describe("RC3: graph edges include structural relationships", () => {
  it("workspace graph overview includes belongs_to edges", async () => {
    const graph = await getWorkspaceGraphOverview({
      surreal,
      workspaceRecord,
    });

    const belongsToEdge = graph.edges.find((e) => e.kind === "belongs_to");
    expect(belongsToEdge).toBeDefined();
  });

  it("workspace graph overview includes has_feature edges", async () => {
    const graph = await getWorkspaceGraphOverview({
      surreal,
      workspaceRecord,
    });

    const hasFeatureEdge = graph.edges.find((e) => e.kind === "has_feature");
    expect(hasFeatureEdge).toBeDefined();
  });

  it("project graph view includes structural edges between entities", async () => {
    const graph = await getProjectGraphView({
      surreal,
      workspaceRecord,
      projectRecord,
    });

    const edgeKinds = graph.edges.map((e) => e.kind);
    expect(edgeKinds).toContain("belongs_to");
    expect(edgeKinds).toContain("has_feature");
  });

  it("project graph view includes owns edges", async () => {
    const graph = await getProjectGraphView({
      surreal,
      workspaceRecord,
      projectRecord,
    });

    const ownsEdge = graph.edges.find((e) => e.kind === "owns");
    expect(ownsEdge).toBeDefined();
  });

  it("project graph view includes depends_on edges", async () => {
    const graph = await getProjectGraphView({
      surreal,
      workspaceRecord,
      projectRecord,
    });

    const depsEdge = graph.edges.find((e) => e.kind === "depends_on");
    expect(depsEdge).toBeDefined();
  });

  it("focused graph view traverses structural edges", async () => {
    const graph = await getFocusedGraphView({
      surreal,
      workspaceRecord,
      centerEntityRecord: taskRecord as GraphEntityRecord,
      depth: 2,
    });

    // Starting from task, should reach project via belongs_to
    const projectEntity = graph.entities.find((e) => e.kind === "project");
    expect(projectEntity).toBeDefined();

    // Should also reach feature via depends_on
    const featureEntity = graph.entities.find((e) => e.kind === "feature");
    expect(featureEntity).toBeDefined();

    // Should also reach identity via owns
    const identityEntity = graph.entities.find((e) => e.kind === "identity");
    const personEntity = graph.entities.find((e) => e.kind === "person");
    expect(identityEntity ?? personEntity).toBeDefined();
  });
});
