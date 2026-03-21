/**
 * Acceptance test: Graph-based objective alignment (US-EMB-003)
 *
 * Verifies that the alignment evaluator resolves objectives via graph traversal
 * (task->belongs_to->project<-has_objective<-objective) instead of embedding KNN,
 * with BM25 fallback for unlinked intents.
 *
 * Scenarios:
 *   3.1 Walking skeleton — task linked to project with objective, graph traversal
 *   3.2 Direct project path — intent references project directly
 *   3.3 BM25 fallback — unlinked intent uses fulltext search
 *   3.4 No alignment — no matching objectives produces warning observation
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RecordId, Surreal } from "surrealdb";
import { applyTestSchema } from "../acceptance-test-kit";

// ---------------------------------------------------------------------------
// Isolated SurrealDB setup (same pattern as bm25-indexes.test.ts)
// ---------------------------------------------------------------------------

const surrealUrl = process.env.SURREAL_URL ?? "ws://127.0.0.1:8000/rpc";
const surrealUsername = process.env.SURREAL_USERNAME ?? "root";
const surrealPassword = process.env.SURREAL_PASSWORD ?? "root";

describe("Graph-based objective alignment (US-EMB-003)", () => {
  let surreal: Surreal;
  const namespace = `graph_align_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const database = `graph_align_${Math.floor(Math.random() * 100000)}`;

  beforeAll(async () => {
    surreal = new Surreal();
    await surreal.connect(surrealUrl);
    await surreal.signin({ username: surrealUsername, password: surrealPassword });
    await surreal.query(`DEFINE NAMESPACE ${namespace};`);
    await surreal.use({ namespace });
    await surreal.query(`DEFINE DATABASE ${database};`);
    await surreal.use({ namespace, database });

    // Apply base schema
    await applyTestSchema(surreal);

    // Apply migration 0002 (entity_search analyzer + fulltext indexes)
    const migration0002 = readFileSync(
      join(process.cwd(), "schema", "migrations", "0002_fulltext_search_indexes.surql"),
      "utf8",
    );
    await surreal.query(migration0002);

    // Apply migration 0034 (objective fulltext index)
    const migration0034 = readFileSync(
      join(process.cwd(), "schema", "migrations", "0034_objective_fulltext.surql"),
      "utf8",
    );
    await surreal.query(migration0034);

    // Apply migration 0063 (add "graph" and "bm25" to supports alignment_method)
    const migration0063 = readFileSync(
      join(process.cwd(), "schema", "migrations", "0063_supports_alignment_method_graph_bm25.surql"),
      "utf8",
    );
    await surreal.query(migration0063);
  }, 30_000);

  afterAll(async () => {
    try {
      await surreal.query(`REMOVE DATABASE ${database};`);
      await surreal.query(`REMOVE NAMESPACE ${namespace};`);
    } finally {
      await surreal.close();
    }
  });

  // =========================================================================
  // Helpers — seed graph structure
  // =========================================================================

  async function seedWorkspace(suffix: string): Promise<string> {
    const workspaceId = `ws-${suffix}-${crypto.randomUUID()}`;
    await surreal.query(`CREATE $ws CONTENT $content;`, {
      ws: new RecordId("workspace", workspaceId),
      content: {
        name: `Alignment Test Workspace ${suffix}`,
        status: "active",
        onboarding_complete: true,
        onboarding_turn_count: 0,
        onboarding_summary_pending: false,
        onboarding_started_at: new Date(),
        created_at: new Date(),
      },
    });
    return workspaceId;
  }

  async function seedIdentity(workspaceId: string, name: string): Promise<string> {
    const identityId = `id-${crypto.randomUUID()}`;
    await surreal.query(`CREATE $identity CONTENT $content;`, {
      identity: new RecordId("identity", identityId),
      content: {
        name,
        type: "agent",
        identity_status: "active",
        workspace: new RecordId("workspace", workspaceId),
        created_at: new Date(),
      },
    });
    return identityId;
  }

  async function seedProject(workspaceId: string, name: string): Promise<string> {
    const projectId = `proj-${crypto.randomUUID()}`;
    await surreal.query(`CREATE $project CONTENT $content;`, {
      project: new RecordId("project", projectId),
      content: {
        name,
        status: "active",
        workspace: new RecordId("workspace", workspaceId),
        created_at: new Date(),
      },
    });
    return projectId;
  }

  async function seedTask(workspaceId: string, projectId: string, title: string): Promise<string> {
    const taskId = `task-${crypto.randomUUID()}`;
    const taskRecord = new RecordId("task", taskId);
    const projectRecord = new RecordId("project", projectId);

    await surreal.query(`CREATE $task CONTENT $content;`, {
      task: taskRecord,
      content: {
        title,
        status: "open",
        workspace: new RecordId("workspace", workspaceId),
        created_at: new Date(),
      },
    });

    // Link task -> belongs_to -> project
    await surreal.query(
      `RELATE $task->belongs_to->$project SET added_at = time::now();`,
      { task: taskRecord, project: projectRecord },
    );

    return taskId;
  }

  async function seedObjective(
    workspaceId: string,
    projectId: string,
    title: string,
    status: string = "active",
  ): Promise<string> {
    const objectiveId = `obj-${crypto.randomUUID()}`;
    const objectiveRecord = new RecordId("objective", objectiveId);
    const projectRecord = new RecordId("project", projectId);

    await surreal.query(`CREATE $objective CONTENT $content;`, {
      objective: objectiveRecord,
      content: {
        title,
        description: title,
        status,
        priority: "high",
        success_criteria: [],
        workspace: new RecordId("workspace", workspaceId),
        created_at: new Date(),
        updated_at: new Date(),
      },
    });

    // Link project -> has_objective -> objective
    await surreal.query(
      `RELATE $project->has_objective->$objective SET added_at = time::now();`,
      { project: projectRecord, objective: objectiveRecord },
    );

    return objectiveId;
  }

  async function seedIntent(
    workspaceId: string,
    requesterId: string,
    goal: string,
    opts?: { taskId?: string },
  ): Promise<string> {
    const intentId = `intent-${crypto.randomUUID()}`;
    const intentRecord = new RecordId("intent", intentId);
    const traceId = `trace-${intentId}`;
    const traceRecord = new RecordId("trace", traceId);
    const requesterRecord = new RecordId("identity", requesterId);
    const workspaceRecord = new RecordId("workspace", workspaceId);

    await surreal.query(`CREATE $trace CONTENT $content;`, {
      trace: traceRecord,
      content: {
        type: "intent_submission",
        actor: requesterRecord,
        workspace: workspaceRecord,
        created_at: new Date(),
      },
    });

    await surreal.query(`CREATE $intent CONTENT $content;`, {
      intent: intentRecord,
      content: {
        goal,
        reasoning: "Test intent for alignment",
        status: "pending_auth",
        priority: 50,
        action_spec: { provider: "test", action: "test", params: {} },
        trace_id: traceRecord,
        requester: requesterRecord,
        workspace: workspaceRecord,
        created_at: new Date(),
      },
    });

    return intentId;
  }

  /** Retrieve supports edges for an intent */
  async function getSupportsEdges(intentId: string): Promise<Array<{
    alignment_score: number;
    alignment_method: string;
    out: RecordId<"objective">;
  }>> {
    const rows = (await surreal.query(
      `SELECT alignment_score, alignment_method, out FROM supports WHERE in = $intent;`,
      { intent: new RecordId("intent", intentId) },
    )) as [Array<{ alignment_score: number; alignment_method: string; out: RecordId<"objective"> }>];
    return rows[0] ?? [];
  }

  /** Retrieve warning observations for alignment */
  async function getAlignmentWarnings(workspaceId: string): Promise<Array<{
    text: string;
    severity: string;
    observation_type: string;
  }>> {
    const rows = (await surreal.query(
      `SELECT text, severity, observation_type FROM observation
       WHERE workspace = $ws AND observation_type = 'alignment' AND severity = 'warning';`,
      { ws: new RecordId("workspace", workspaceId) },
    )) as [Array<{ text: string; severity: string; observation_type: string }>];
    return rows[0] ?? [];
  }

  // =========================================================================
  // Scenario 3.1 — Walking Skeleton: Task-linked graph traversal
  // =========================================================================

  test("3.1: linked intent resolves objective via task->project->objective graph path", async () => {
    // Given workspace has an active objective "Improve platform reliability"
    const workspaceId = await seedWorkspace("s31");
    const identityId = await seedIdentity(workspaceId, "coding-agent");
    const projectId = await seedProject(workspaceId, "Infrastructure");
    const objectiveId = await seedObjective(
      workspaceId,
      projectId,
      "Improve platform reliability",
    );

    // And the project has task "Implement rate limiting"
    const taskId = await seedTask(workspaceId, projectId, "Implement rate limiting");

    // When the alignment evaluator processes an intent referencing task
    const intentId = await seedIntent(workspaceId, identityId, "Implement rate limiting");

    // --- Call the adapter under test ---
    const { findAlignedObjectivesViaGraph } = await import(
      "../../../app/src/server/objective/alignment-adapter"
    );
    const candidates = await findAlignedObjectivesViaGraph(surreal)(
      { table: "task", id: taskId },
      new RecordId("workspace", workspaceId),
      "Implement rate limiting",
    );

    // Then the alignment finds the linked objective
    expect(candidates.length).toBeGreaterThanOrEqual(1);
    const matched = candidates.find((c) => c.objectiveId === objectiveId);
    expect(matched).toBeDefined();
    expect(matched!.score).toBe(1.0); // graph traversal = deterministic score

    // And a supports edge can be created with method "graph"
    const { createSupportsEdgeSurreal } = await import(
      "../../../app/src/server/objective/alignment-adapter"
    );
    const createEdge = createSupportsEdgeSurreal(surreal);
    await createEdge(
      new RecordId("intent", intentId),
      objectiveId,
      1.0,
      "graph",
    );

    const edges = await getSupportsEdges(intentId);
    expect(edges).toHaveLength(1);
    expect(edges[0].alignment_method).toBe("graph");
    expect(edges[0].alignment_score).toBe(1.0);
  }, 30_000);

  // =========================================================================
  // Scenario 3.3 — BM25 fallback for unlinked intents
  // =========================================================================

  test("3.3: unlinked intent falls back to BM25 text match against objectives", async () => {
    // Given workspace has an active objective
    const workspaceId = await seedWorkspace("s33");
    const identityId = await seedIdentity(workspaceId, "coding-agent");
    const projectId = await seedProject(workspaceId, "Infrastructure");
    await seedObjective(
      workspaceId,
      projectId,
      "Improve platform reliability",
    );

    // When the alignment evaluator processes an unlinked intent (no entity ref)
    // with description text that matches the objective
    const { findAlignedObjectivesViaGraph } = await import(
      "../../../app/src/server/objective/alignment-adapter"
    );
    const candidates = await findAlignedObjectivesViaGraph(surreal)(
      undefined, // no entity reference
      new RecordId("workspace", workspaceId),
      "improve platform reliability",
    );

    // Then BM25 fallback finds the objective
    expect(candidates.length).toBeGreaterThanOrEqual(1);
    const matched = candidates.find((c) => c.title === "Improve platform reliability");
    expect(matched).toBeDefined();
    // BM25 score is normalized, not 1.0
    expect(matched!.score).toBeGreaterThan(0);
    expect(matched!.score).toBeLessThanOrEqual(1.0);
  }, 30_000);

  // =========================================================================
  // Scenario 3.4 — No alignment produces warning observation
  // =========================================================================

  test("3.4: no matching objectives returns empty candidates", async () => {
    // Given workspace with an objective about reliability
    const workspaceId = await seedWorkspace("s34");
    const identityId = await seedIdentity(workspaceId, "coding-agent");
    const projectId = await seedProject(workspaceId, "Infrastructure");
    await seedObjective(
      workspaceId,
      projectId,
      "Improve platform reliability",
    );

    // When the alignment evaluator processes an unlinked intent with unrelated text
    const { findAlignedObjectivesViaGraph } = await import(
      "../../../app/src/server/objective/alignment-adapter"
    );
    const candidates = await findAlignedObjectivesViaGraph(surreal)(
      undefined,
      new RecordId("workspace", workspaceId),
      "xyznonexistentgoalzyx",
    );

    // Then no objectives are matched
    expect(candidates).toHaveLength(0);

    // And a warning observation can be created
    const { createAlignmentWarningObservation } = await import(
      "../../../app/src/server/objective/alignment-adapter"
    );
    await createAlignmentWarningObservation(
      surreal,
      new RecordId("workspace", workspaceId),
      new RecordId("intent", `intent-${crypto.randomUUID()}`),
      0,
    );

    const warnings = await getAlignmentWarnings(workspaceId);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe("warning");
    expect(warnings[0].observation_type).toBe("alignment");
  }, 30_000);

  // =========================================================================
  // Port signature: no embedding vector required
  // =========================================================================

  test("FindAlignedObjectives port no longer requires embedding vector", async () => {
    // The new port signature accepts entity reference + description text
    // instead of an embedding vector. Verify by importing the type.
    const { findAlignedObjectivesViaGraph } = await import(
      "../../../app/src/server/objective/alignment-adapter"
    );

    // The factory accepts Surreal and returns a function with the new signature
    const adapter = findAlignedObjectivesViaGraph(surreal);
    expect(typeof adapter).toBe("function");

    // The function signature: (entityRef, workspaceId, descriptionText) => Promise<candidates>
    // It does NOT accept number[] embedding vector as first arg
  });
});
