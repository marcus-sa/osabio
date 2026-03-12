/**
 * Walking Skeleton: Observer Agent Reality Verification E2E
 *
 * Traces: Story 1, Story 3, Story 4, Story 6
 *
 * These are the minimum viable E2E paths through the observer verification system.
 * Skeleton 1: Task completed -> Observer verifies -> observation created with verdict
 * Skeleton 2: External signal unavailable -> Observer degrades gracefully
 *
 * Together they prove:
 * - A completed task triggers the Observer to create a verification observation
 * - The observation links back to the triggering entity via the observes edge
 * - When external verification signals are unavailable, the system degrades gracefully
 * - The Observer never blocks the original workflow
 *
 * Driving ports:
 *   POST /api/observe/task/:id         (SurrealQL EVENT target)
 *   SurrealDB direct queries           (verification of outcomes)
 */
import { describe, expect, it, beforeAll } from "bun:test";
import {
  setupObserverSuite,
  wireObserverEvents,
  createTaskWithCommit,
  triggerTaskCompletion,
  waitForObservation,
  getWorkspaceObservations,
  setupObserverWorkspace,
} from "./observer-test-kit";

const getRuntime = setupObserverSuite("observer_walking_skeleton");

// Wire the SurrealQL EVENTs so they fire http::post to the real test server
beforeAll(async () => {
  const { surreal, port } = getRuntime();
  await wireObserverEvents(surreal, port);
});

describe("Walking Skeleton: Task completion triggers observer verification", () => {
  // ---------------------------------------------------------------------------
  // Walking Skeleton 1: Task completed -> observation created with verification
  // Story 1 + Story 4 + Story 6 happy path
  // ---------------------------------------------------------------------------
  it("observer creates a verification observation when a task is marked completed", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with a task linked to a source commit
    const { workspaceId } = await setupObserverWorkspace(baseUrl, surreal, "skeleton-verify");

    const { taskId, sha } = await createTaskWithCommit(
      surreal,
      workspaceId,
      {
        title: "Add input validation to signup form",
        description: "Validate email format and password strength on the signup page",
        status: "in_progress",
        repository: "org/brain",
      },
    );

    // When the task is marked as completed
    await triggerTaskCompletion(surreal, taskId);

    // Then the Observer receives the task completion event
    // And creates an observation linked to the task via the observes edge
    const observations = await waitForObservation(surreal, "task", taskId, 30_000);

    expect(observations.length).toBeGreaterThanOrEqual(1);

    const obs = observations[0];
    // And the observation records the observer as its source
    expect(obs.source_agent).toBe("observer_agent");
    // And the observation has a verification-related type
    expect(obs.severity).toBeDefined();
    expect(["info", "warning", "conflict"]).toContain(obs.severity);
    // And the observation text describes the verification outcome
    expect(obs.text).toBeTruthy();
  }, 120_000);

  // ---------------------------------------------------------------------------
  // Walking Skeleton 2: External signal unavailable -> graceful degradation
  // Story 3 happy path
  // ---------------------------------------------------------------------------
  it("observer creates an inconclusive observation when external signals are unavailable", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with a task that has no linked PR or external integration
    const { workspaceId } = await setupObserverWorkspace(baseUrl, surreal, "skeleton-degrade");

    // And a task with no external verification signals (no PR URL, no CI link)
    const taskId = `task-${crypto.randomUUID()}`;
    const taskRecord = await import("surrealdb").then(({ RecordId }) => new RecordId("task", taskId));
    const workspaceRecord = await import("surrealdb").then(({ RecordId }) => new RecordId("workspace", workspaceId));

    await surreal.query(`CREATE $task CONTENT $content;`, {
      task: taskRecord,
      content: {
        title: "Update documentation for API endpoints",
        description: "Refresh the API docs to match current implementation",
        status: "in_progress",
        workspace: workspaceRecord,
        created_at: new Date(),
        updated_at: new Date(),
      },
    });

    // When the task is marked as completed
    await triggerTaskCompletion(surreal, taskId);

    // Then the Observer still creates an observation (does not block or crash)
    const observations = await waitForObservation(surreal, "task", taskId, 30_000);

    expect(observations.length).toBeGreaterThanOrEqual(1);

    const obs = observations[0];
    // And the observation is informational (not a conflict, since nothing could be verified)
    expect(obs.source_agent).toBe("observer_agent");
    expect(obs.severity).toBe("info");
    // And the task status remains completed (observer did not revert it)
    const taskRows = (await surreal.query(
      `SELECT status FROM $task;`,
      { task: taskRecord },
    )) as Array<Array<{ status: string }>>;
    expect(taskRows[0]?.[0]?.status).toBe("completed");
  }, 120_000);
});
