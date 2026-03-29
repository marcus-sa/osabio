/**
 * Milestone 3: Observer Agent Core and Periodic Graph Scan
 *
 * Traces: Story 5 (Observer Agent Core), Story 7 (Periodic Graph Scan)
 *
 * Validates:
 * - Observer Agent uses ToolLoopAgent pattern with correct tools
 * - Observer Agent returns structured output (observations_created, verdict, evidence)
 * - Graph scan detects decision-implementation contradictions
 * - Graph scan detects stale blocked tasks
 * - Graph scan deduplicates against existing open observations
 *
 * Driving ports:
 *   POST /api/observe/:table/:id          (EVENT target)
 *   POST /api/observe/scan/:workspaceId   (periodic scan trigger)
 */
import { describe, expect, it, beforeAll } from "bun:test";
import { RecordId } from "surrealdb";
import {
  setupObserverSuite,
  wireObserverEvents,
  setupObserverWorkspace,
  createTaskWithCommit,
  createConfirmedDecision,
  createObservationByAgent,
  triggerTaskCompletion,
  triggerGraphScan,
  waitForObservation,
  getWorkspaceObservations,
  createTestUser,
  createTestWorkspace,
  createReadyTask,
} from "./observer-test-kit";

const getRuntime = setupObserverSuite("observer_m3_agent_scan");

beforeAll(async () => {
  const { surreal, port } = getRuntime();
  await wireObserverEvents(surreal, port);
});

// =============================================================================
// Story 5: Observer Agent Core
// =============================================================================

describe("Milestone 3: Observer Agent Core (Story 5)", () => {
  // ---------------------------------------------------------------------------
  // S5-1: Observer Agent returns structured output
  // ---------------------------------------------------------------------------
  it("observer agent produces structured verification output for task completion", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with a task linked to a source commit
    const { workspaceId } = await setupObserverWorkspace(baseUrl, surreal, "agent-output");
    const { taskId } = await createTaskWithCommit(surreal, workspaceId, {
      title: "Implement user session expiry",
      status: "in_progress",
      repository: "org/osabio",
    });

    // When the task is completed and the observer agent processes it
    await triggerTaskCompletion(surreal, taskId);

    // Then the observer creates observations with structured metadata
    const observations = await waitForObservation(surreal, "task", taskId, 30_000);
    expect(observations.length).toBeGreaterThanOrEqual(1);

    const obs = observations[0];
    // And the observation carries the observer's structured fields
    expect(obs.source_agent).toBe("observer_agent");
    expect(obs.text).toBeTruthy();
    expect(obs.severity).toBeDefined();
    // And the observation is linked to the task
    const edges = (await surreal.query(
      `SELECT ->observes->task AS targets FROM $obs;`,
      { obs: obs.id },
    )) as Array<Array<{ targets: RecordId[] }>>;
    expect(edges[0]?.[0]?.targets).toHaveLength(1);
  }, 120_000);

  // ---------------------------------------------------------------------------
  // S5-2: Observer Agent uses workspace context
  // ---------------------------------------------------------------------------
  it("observer agent considers existing workspace observations in its analysis", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with a pre-existing warning observation about stability
    const { workspaceId } = await setupObserverWorkspace(baseUrl, surreal, "agent-context");

    await createObservationByAgent(surreal, workspaceId, "pm_agent", {
      text: "Multiple tasks in this project have been completed without review",
      severity: "warning",
      observationType: "pattern",
    });

    const { taskId } = await createTaskWithCommit(surreal, workspaceId, {
      title: "Remove deprecated API endpoints",
      status: "in_progress",
      repository: "org/osabio",
    });

    // When another task is completed in this workspace
    await triggerTaskCompletion(surreal, taskId);

    // Then the observer creates an observation (it has access to workspace context)
    const observations = await waitForObservation(surreal, "task", taskId, 30_000);
    expect(observations.length).toBeGreaterThanOrEqual(1);
    expect(observations[0].source_agent).toBe("observer_agent");
  }, 120_000);
});

// =============================================================================
// Story 7: Periodic Graph Scan
// =============================================================================

describe("Milestone 3: Periodic Graph Scan (Story 7)", () => {
  // ---------------------------------------------------------------------------
  // S7-1: Graph scan requires OBSERVER_MODEL
  // ---------------------------------------------------------------------------
  it("graph scan returns 503 when OBSERVER_MODEL is not configured", async () => {
    // Note: contradiction detection is now LLM-based. When no model is configured,
    // the scan endpoint returns 503. Full contradiction tests are in
    // observer-llm-reasoning/milestone-3-decision-and-synthesis.test.ts
    const hasModel = !!process.env.OBSERVER_MODEL?.trim();
    if (hasModel) {
      // Skip this test when model IS configured (CI LLM matrix)
      return;
    }

    const { baseUrl } = getRuntime();
    const user = await createTestUser(baseUrl, "scan-no-model");
    const workspace = await createTestWorkspace(baseUrl, user);

    const scanResponse = await triggerGraphScan(baseUrl, workspace.workspaceId, user.headers);
    expect(scanResponse.status).toBe(503);
  }, 30_000);

  // ---------------------------------------------------------------------------
  // S7-2: Graph scan detects stale blocked task
  // ---------------------------------------------------------------------------
  it("graph scan detects a task blocked longer than the threshold", async () => {

    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with a task that has been blocked for over 14 days
    // (use a title that indicates genuine internal blockage, not external wait)
    const user = await createTestUser(baseUrl, "scan-stale");
    const workspace = await createTestWorkspace(baseUrl, user);

    const taskId = crypto.randomUUID();
    const taskRecord = new RecordId("task", taskId);
    const wsRecord = new RecordId("workspace", workspace.workspaceId);

    // Create a task blocked 15 days ago
    const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);
    await surreal.query(`CREATE $task CONTENT $content;`, {
      task: taskRecord,
      content: {
        title: "Refactor user settings module to support multi-tenant configuration",
        description: "Blocked but nobody has investigated why. Might be a forgotten task.",
        status: "blocked",
        workspace: wsRecord,
        created_at: fifteenDaysAgo,
        updated_at: fifteenDaysAgo,
      },
    });

    // When the periodic graph scan runs
    const scanResponse = await triggerGraphScan(baseUrl, workspace.workspaceId, user.headers);

    // Then the scan detects the stale blocker
    expect(scanResponse.ok).toBe(true);
    const scanBody = await scanResponse.json() as { stale_blocked_found: number; llm_filtered_count: number; observations_created: number };
    expect(scanBody.stale_blocked_found).toBe(1);

    // And creates a warning observation (LLM should flag this as genuinely stuck)
    // or the LLM filters it — either way stale_blocked_found confirms detection
    await Bun.sleep(5_000);
    const observations = await getWorkspaceObservations(surreal, workspace.workspaceId, "observer_agent");
    // When LLM is available, it evaluates the anomaly. If filtered, llm_filtered_count > 0.
    // If not filtered, an observation is created.
    expect(scanBody.observations_created + scanBody.llm_filtered_count).toBeGreaterThanOrEqual(1);
  }, 120_000);

  // ---------------------------------------------------------------------------
  // S7-3: Graph scan deduplicates existing observations
  // ---------------------------------------------------------------------------
  it("graph scan does not create duplicate observations for known issues", async () => {

    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with a stale blocked task
    const user = await createTestUser(baseUrl, "scan-dedup");
    const workspace = await createTestWorkspace(baseUrl, user);

    const taskId = crypto.randomUUID();
    const taskRecord = new RecordId("task", taskId);
    const wsRecord = new RecordId("workspace", workspace.workspaceId);

    const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);
    await surreal.query(`CREATE $task CONTENT $content;`, {
      task: taskRecord,
      content: {
        title: "Waiting on security audit results",
        status: "blocked",
        workspace: wsRecord,
        created_at: fifteenDaysAgo,
        updated_at: fifteenDaysAgo,
      },
    });

    // And the observer has already flagged this issue in a previous scan
    await createObservationByAgent(surreal, workspace.workspaceId, "observer_agent", {
      text: "Task blocked for over 14 days: Waiting on security audit results",
      severity: "warning",
      observationType: "anomaly",
      targetTable: "task",
      targetId: taskId,
    });

    const beforeCount = (await getWorkspaceObservations(surreal, workspace.workspaceId, "observer_agent")).length;

    // When the graph scan runs again
    await triggerGraphScan(baseUrl, workspace.workspaceId, user.headers);

    // Then no duplicate observation is created
    await Bun.sleep(5_000);
    const afterCount = (await getWorkspaceObservations(surreal, workspace.workspaceId, "observer_agent")).length;
    expect(afterCount).toBe(beforeCount);
  }, 120_000);

  // ---------------------------------------------------------------------------
  // S7-4: Graph scan detects status drift
  // ---------------------------------------------------------------------------
  it("graph scan detects task status that contradicts its dependencies", async () => {

    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with two tasks where one depends on the other
    const user = await createTestUser(baseUrl, "scan-drift");
    const workspace = await createTestWorkspace(baseUrl, user);

    // Parent task still in progress
    const parentTask = await createReadyTask(surreal, workspace.workspaceId, {
      title: "Design database schema",
      status: "in_progress",
    });

    // Dependent task marked as completed (drift: completed before dependency)
    const childTask = await createReadyTask(surreal, workspace.workspaceId, {
      title: "Implement data access layer",
      status: "completed",
    });

    // Link dependency: child depends on parent
    await surreal.query(
      `RELATE $child->depends_on->$parent SET type = "needs", added_at = time::now();`,
      { child: childTask.taskRecord, parent: parentTask.taskRecord },
    );

    // When the periodic graph scan runs
    const scanResponse = await triggerGraphScan(baseUrl, workspace.workspaceId, user.headers);

    // Then the scan detects the status drift
    expect(scanResponse.ok).toBe(true);

    await Bun.sleep(5_000);
    const observations = await getWorkspaceObservations(surreal, workspace.workspaceId, "observer_agent");
    const driftObs = observations.filter(
      (o) => o.severity === "warning" || o.severity === "conflict",
    );
    expect(driftObs.length).toBeGreaterThanOrEqual(1);
  }, 120_000);
});
