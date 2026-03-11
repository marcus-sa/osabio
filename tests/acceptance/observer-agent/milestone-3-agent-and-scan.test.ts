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
      repository: "org/brain",
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
      repository: "org/brain",
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
  // S7-1: Graph scan detects decision-implementation contradiction
  // ---------------------------------------------------------------------------
  it("graph scan detects a contradiction between a confirmed decision and completed task", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with a confirmed decision to use tRPC for all endpoints
    const user = await createTestUser(baseUrl, "scan-contradiction");
    const workspace = await createTestWorkspace(baseUrl, user);

    const { decisionId } = await createConfirmedDecision(surreal, workspace.workspaceId, {
      summary: "Use tRPC for all new API endpoints",
      rationale: "Type safety and consistency across the codebase",
    });

    // And a completed task that implemented a REST endpoint instead
    const task = await createReadyTask(surreal, workspace.workspaceId, {
      title: "Add billing API endpoint using Express REST",
      description: "Implemented billing API as REST endpoint with Express router",
      status: "completed",
    });

    // Link the task to the same project as the decision
    // (both belong to the workspace, creating a detectable contradiction)

    // When the periodic graph scan runs
    const scanResponse = await triggerGraphScan(baseUrl, workspace.workspaceId, user.headers);

    // Then the scan detects the contradiction
    expect(scanResponse.ok).toBe(true);

    // And creates a conflict observation linking the decision and the task
    await Bun.sleep(5_000); // Allow async observation creation
    const observations = await getWorkspaceObservations(surreal, workspace.workspaceId, "observer_agent");
    const contradictions = observations.filter((o) => o.severity === "conflict");
    expect(contradictions.length).toBeGreaterThanOrEqual(1);
  }, 120_000);

  // ---------------------------------------------------------------------------
  // S7-2: Graph scan detects stale blocked task
  // ---------------------------------------------------------------------------
  it("graph scan detects a task blocked longer than the threshold", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with a task that has been blocked for over 14 days
    const user = await createTestUser(baseUrl, "scan-stale");
    const workspace = await createTestWorkspace(baseUrl, user);

    const taskId = `task-${crypto.randomUUID()}`;
    const taskRecord = new RecordId("task", taskId);
    const wsRecord = new RecordId("workspace", workspace.workspaceId);

    // Create a task blocked 15 days ago
    const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);
    await surreal.query(`CREATE $task CONTENT $content;`, {
      task: taskRecord,
      content: {
        title: "Waiting on third-party API access credentials",
        description: "Blocked by external vendor",
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

    // And creates a warning observation about the stale blocked task
    await Bun.sleep(5_000);
    const observations = await getWorkspaceObservations(surreal, workspace.workspaceId, "observer_agent");
    const staleWarnings = observations.filter(
      (o) => o.severity === "warning" && o.text.toLowerCase().includes("block"),
    );
    expect(staleWarnings.length).toBeGreaterThanOrEqual(1);
  }, 120_000);

  // ---------------------------------------------------------------------------
  // S7-3: Graph scan deduplicates existing observations
  // ---------------------------------------------------------------------------
  it.skip("graph scan does not create duplicate observations for known issues", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with a stale blocked task
    const user = await createTestUser(baseUrl, "scan-dedup");
    const workspace = await createTestWorkspace(baseUrl, user);

    const taskId = `task-${crypto.randomUUID()}`;
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
  it.skip("graph scan detects task status that contradicts its dependencies", async () => {
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
      `RELATE $child->depends_on->$parent SET added_at = time::now();`,
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
