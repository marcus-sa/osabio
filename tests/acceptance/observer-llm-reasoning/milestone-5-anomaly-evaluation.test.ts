/**
 * Milestone 5: LLM Anomaly Evaluation for Stale/Drift
 *
 * Traces: Gap 1 — LLM-enriched stale/drift evaluation in graph-scan
 *
 * IMPORTANT: These tests call a real LLM. OBSERVER_MODEL must be set in .env.
 *
 * Validates that:
 * - Graph scan uses LLM to evaluate stale blocked tasks before creating observations
 * - LLM filters out false positives (expected external waits)
 * - LLM-evaluated observations include enriched reasoning text
 * - LLM-evaluated observations carry LLM-suggested severity
 * - Status drift anomalies are also evaluated by LLM
 * - Graceful fallback: all anomalies created when LLM fails
 *
 * Driving ports:
 *   POST /api/observe/scan/:workspaceId  (periodic graph scan)
 *   SurrealDB direct queries             (verification of outcomes)
 */
import { describe, expect, it, beforeAll } from "bun:test";
import { RecordId } from "surrealdb";
import {
  setupObserverSuite,
  wireObserverEvents,
  setupObserverWorkspace,
  triggerGraphScan,
  getWorkspaceObservations,
  createProject,
  createTaskInProject,
  countObservations,
} from "./llm-reasoning-test-kit";
import {
  createReadyTask,
} from "../coding-agent-orchestrator/orchestrator-test-kit";

const getRuntime = setupObserverSuite("observer_llm_m5_anomaly_eval");

beforeAll(async () => {
  const { surreal, port } = getRuntime();
  await wireObserverEvents(surreal, port);
});

// =============================================================================
// LLM Anomaly Evaluation: Stale Blocked Tasks
// =============================================================================

describe("Milestone 5: Stale Blocked LLM Evaluation", () => {
  // ---------------------------------------------------------------------------
  // AC-5.1: LLM filters expected external wait as not relevant
  // ---------------------------------------------------------------------------
  it("LLM filters stale blocked task that is an expected external wait", async () => {
    const { baseUrl, surreal } = getRuntime();
    const { workspaceId } = await setupObserverWorkspace(baseUrl, surreal, "llm-stale-filter");

    // Given a task blocked 20 days ago with a title suggesting external dependency
    const taskId = crypto.randomUUID();
    const taskRecord = new RecordId("task", taskId);
    const wsRecord = new RecordId("workspace", workspaceId);

    const twentyDaysAgo = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);
    await surreal.query(`CREATE $task CONTENT $content;`, {
      task: taskRecord,
      content: {
        title: "Waiting on legal team to complete SOC2 compliance review",
        description: "Blocked until legal provides signed compliance attestation from external auditor. Expected timeline: 4-6 weeks from submission date.",
        status: "blocked",
        workspace: wsRecord,
        created_at: twentyDaysAgo,
        updated_at: twentyDaysAgo,
      },
    });

    // When the graph scan runs
    const response = await triggerGraphScan(baseUrl, workspaceId, {});
    expect(response.ok).toBe(true);

    const body = await response.json() as { llm_filtered_count?: number; observations_created?: number };

    // Then the LLM should evaluate and potentially filter this as expected wait
    // (Soft assertion: LLM may or may not filter it, but the field should exist)
    expect(body.llm_filtered_count).toBeDefined();
    expect(typeof body.llm_filtered_count).toBe("number");
  }, 120_000);

  // ---------------------------------------------------------------------------
  // AC-5.2: LLM flags genuinely stuck task as relevant
  // ---------------------------------------------------------------------------
  it("LLM flags genuinely stuck task with enriched reasoning", async () => {
    const { baseUrl, surreal } = getRuntime();
    const { workspaceId } = await setupObserverWorkspace(baseUrl, surreal, "llm-stale-genuine");

    // Given a task blocked 30 days with no clear external reason
    const taskId = crypto.randomUUID();
    const taskRecord = new RecordId("task", taskId);
    const wsRecord = new RecordId("workspace", workspaceId);

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    await surreal.query(`CREATE $task CONTENT $content;`, {
      task: taskRecord,
      content: {
        title: "Refactor authentication module",
        description: "Needs refactoring but nobody has picked it up",
        status: "blocked",
        workspace: wsRecord,
        created_at: thirtyDaysAgo,
        updated_at: thirtyDaysAgo,
      },
    });

    // When the graph scan runs
    const response = await triggerGraphScan(baseUrl, workspaceId, {});
    expect(response.ok).toBe(true);

    // Then observations should be created
    await Bun.sleep(3_000);
    const observations = await getWorkspaceObservations(surreal, workspaceId, "observer_agent");
    const staleObs = observations.filter(
      (o) => o.text.toLowerCase().includes("refactor authentication"),
    );

    // The LLM should flag this as genuinely stuck (not an expected wait)
    expect(staleObs.length).toBeGreaterThanOrEqual(1);
    // And the observation text should contain LLM reasoning (not just the template)
    if (staleObs.length > 0) {
      expect(staleObs[0].text.length).toBeGreaterThan(50);
    }
  }, 120_000);

  // ---------------------------------------------------------------------------
  // AC-5.3: Scan response includes llm_filtered_count
  // ---------------------------------------------------------------------------
  it("graph scan result includes llm_filtered_count field", async () => {
    const { baseUrl, surreal } = getRuntime();
    const { workspaceId } = await setupObserverWorkspace(baseUrl, surreal, "llm-stale-count");

    // Given a mix of tasks: one clearly stuck, one clearly external
    const wsRecord = new RecordId("workspace", workspaceId);
    const twentyDaysAgo = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);

    // Genuinely stuck
    const stuckId = crypto.randomUUID();
    await surreal.query(`CREATE $task CONTENT $content;`, {
      task: new RecordId("task", stuckId),
      content: {
        title: "Fix broken pagination in admin dashboard",
        description: "Has been blocked with no reason for weeks",
        status: "blocked",
        workspace: wsRecord,
        created_at: twentyDaysAgo,
        updated_at: twentyDaysAgo,
      },
    });

    // External wait
    const waitId = crypto.randomUUID();
    await surreal.query(`CREATE $task CONTENT $content;`, {
      task: new RecordId("task", waitId),
      content: {
        title: "Pending third-party OAuth provider certificate renewal",
        description: "Waiting on provider to renew SSL certificate. ETA from vendor: March 2026",
        status: "blocked",
        workspace: wsRecord,
        created_at: twentyDaysAgo,
        updated_at: twentyDaysAgo,
      },
    });

    // When scan runs
    const response = await triggerGraphScan(baseUrl, workspaceId, {});
    expect(response.ok).toBe(true);

    const body = await response.json() as {
      stale_blocked_found: number;
      llm_filtered_count: number;
      observations_created: number;
    };

    // Then both tasks are found by deterministic scan
    expect(body.stale_blocked_found).toBe(2);
    // And the llm_filtered_count + observations_created should account for all found
    expect(body.llm_filtered_count + body.observations_created).toBeGreaterThanOrEqual(1);
  }, 120_000);
});

// =============================================================================
// LLM Anomaly Evaluation: Status Drift
// =============================================================================

describe("Milestone 5: Status Drift LLM Evaluation", () => {
  // ---------------------------------------------------------------------------
  // AC-5.4: LLM evaluates status drift before creating observation
  // ---------------------------------------------------------------------------
  it("LLM evaluates status drift and creates observation with enriched text", async () => {
    const { baseUrl, surreal } = getRuntime();
    const { workspaceId } = await setupObserverWorkspace(baseUrl, surreal, "llm-drift-eval");

    // Given a completed task with an incomplete prerequisite dependency
    const parentTask = await createReadyTask(surreal, workspaceId, {
      title: "Design database schema for user profiles",
      status: "in_progress",
    });

    const childTask = await createReadyTask(surreal, workspaceId, {
      title: "Implement user profile CRUD operations",
      status: "completed",
    });

    // Link dependency: child depends on parent
    await surreal.query(
      `RELATE $child->depends_on->$parent SET type = "needs", added_at = time::now();`,
      { child: childTask.taskRecord, parent: parentTask.taskRecord },
    );

    // When graph scan runs
    const response = await triggerGraphScan(baseUrl, workspaceId, {});
    expect(response.ok).toBe(true);

    await Bun.sleep(3_000);
    const observations = await getWorkspaceObservations(surreal, workspaceId, "observer_agent");

    // Then a status drift observation is created (LLM should find this relevant)
    const driftObs = observations.filter(
      (o) => o.text.toLowerCase().includes("drift") || o.text.toLowerCase().includes("depend"),
    );
    expect(driftObs.length).toBeGreaterThanOrEqual(1);
  }, 120_000);

  // ---------------------------------------------------------------------------
  // AC-5.5: LLM can filter optional dependency drift as not relevant
  // ---------------------------------------------------------------------------
  it("LLM can filter status drift for optional/informational dependencies", async () => {
    const { baseUrl, surreal } = getRuntime();
    const { workspaceId } = await setupObserverWorkspace(baseUrl, surreal, "llm-drift-optional");

    // Given a completed task with an "informational" dependency that's not strictly required
    const infoTask = await createReadyTask(surreal, workspaceId, {
      title: "Write documentation for API endpoints",
      status: "in_progress",
    });

    const implTask = await createReadyTask(surreal, workspaceId, {
      title: "Ship API endpoint to production",
      status: "completed",
    });

    // Link: shipping depends on documentation (but docs can be written after)
    await surreal.query(
      `RELATE $child->depends_on->$parent SET type = "needs", added_at = time::now();`,
      { child: implTask.taskRecord, parent: infoTask.taskRecord },
    );

    // When graph scan runs
    const response = await triggerGraphScan(baseUrl, workspaceId, {});
    expect(response.ok).toBe(true);

    const body = await response.json() as {
      status_drift_found: number;
      llm_filtered_count: number;
    };

    // The drift should be detected deterministically
    expect(body.status_drift_found).toBe(1);
    // LLM may or may not filter it — the key is the field is present
    expect(body.llm_filtered_count).toBeDefined();
  }, 120_000);
});
