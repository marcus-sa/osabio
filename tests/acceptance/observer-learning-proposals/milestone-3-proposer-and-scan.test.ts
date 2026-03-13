/**
 * Milestone 3: Learning Proposer and Graph Scan Integration
 *
 * Traces: Step 3 of implementation roadmap
 *
 * Validates:
 * - End-to-end: 3+ observations -> cluster -> diagnosis -> learning record created
 * - Evidence edges link the learning back to source observation records
 * - GraphScanResult includes learning_proposals_created count
 * - Rate limit: 6th suggestion in 7 days is rejected
 * - Dismissed similarity: similar dismissed learning blocks re-suggestion
 *
 * Driving ports:
 *   POST /api/observe/scan/:workspaceId   (graph scan with full diagnostic pipeline)
 *   SurrealDB direct queries              (verification of outcomes)
 */
import { describe, expect, it, beforeAll } from "bun:test";
import {
  setupDiagnosticSuite,
  wireObserverEvents,
  setupObserverWorkspace,
  createObservationCluster,
  createDismissedLearning,
  seedRecentObserverLearnings,
  triggerDiagnosticPipeline,
  getPendingLearningsFromObserver,
  getGraphScanResult,
  verifyLearningEvidenceLinks,
} from "./observer-learning-proposals-test-kit";

const getRuntime = setupDiagnosticSuite("diagnostic_m3_proposer");

beforeAll(async () => {
  const { surreal, port } = getRuntime();
  await wireObserverEvents(surreal, port);
});

describe("Milestone 3: Learning Proposer and Graph Scan Integration", () => {
  // -------------------------------------------------------------------------
  // End-to-end: observations -> cluster -> diagnosis -> learning created
  // -------------------------------------------------------------------------

  it.skip("observation cluster is diagnosed and produces a learning record with pending approval", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with four observations about agents skipping test verification
    const { user, workspaceId } = await setupObserverWorkspace(
      baseUrl,
      surreal,
      `m3-e2e-${crypto.randomUUID()}`,
    );

    const { observationIds } = await createObservationCluster(
      surreal,
      workspaceId,
      4,
      {
        topic: "Coding agents are pushing changes without verifying that all acceptance tests pass",
        severity: "warning",
      },
    );

    // When the graph scan runs with the diagnostic pipeline
    const response = await triggerDiagnosticPipeline(
      baseUrl,
      workspaceId,
      user.headers,
    );

    // Then the scan completes and reports learning proposals
    expect(response.ok).toBe(true);
    const result = await getGraphScanResult(response);
    expect(result.learning_proposals_created).toBeGreaterThanOrEqual(1);

    // And a learning record exists with correct structure
    const pendingLearnings = await getPendingLearningsFromObserver(surreal, workspaceId);
    expect(pendingLearnings.length).toBeGreaterThanOrEqual(1);

    const proposed = pendingLearnings[0];
    expect(proposed.status).toBe("pending_approval");
    expect(proposed.source).toBe("agent");
    expect(proposed.suggested_by).toBe("observer");
    expect(proposed.text.length).toBeGreaterThan(10);
  }, 120_000);

  // -------------------------------------------------------------------------
  // Evidence edges: learning traces back to source observations
  // -------------------------------------------------------------------------

  it.skip("proposed learning has evidence edges linking to the source observations", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with a clear observation cluster
    const { user, workspaceId } = await setupObserverWorkspace(
      baseUrl,
      surreal,
      `m3-evidence-${crypto.randomUUID()}`,
    );

    const { observationIds } = await createObservationCluster(
      surreal,
      workspaceId,
      3,
      {
        topic: "Agents are creating database connections without using the shared connection pool",
        severity: "conflict",
      },
    );

    // When the graph scan runs
    const response = await triggerDiagnosticPipeline(
      baseUrl,
      workspaceId,
      user.headers,
    );
    expect(response.ok).toBe(true);

    // Then the proposed learning has evidence edges to the source observations
    const pendingLearnings = await getPendingLearningsFromObserver(surreal, workspaceId);
    if (pendingLearnings.length > 0) {
      const learningId = (pendingLearnings[0].id as unknown as { id: string }).id
        ?? (pendingLearnings[0].id.id as string);
      const evidence = await verifyLearningEvidenceLinks(
        surreal,
        learningId,
        observationIds,
      );
      // At least some of the source observations should be linked as evidence
      expect(evidence.foundIds.length).toBeGreaterThanOrEqual(1);
    }
  }, 120_000);

  // -------------------------------------------------------------------------
  // GraphScanResult: includes learning_proposals_created count
  // -------------------------------------------------------------------------

  it.skip("graph scan result reports the count of learning proposals created", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with an observation cluster
    const { user, workspaceId } = await setupObserverWorkspace(
      baseUrl,
      surreal,
      `m3-count-${crypto.randomUUID()}`,
    );

    await createObservationCluster(surreal, workspaceId, 3, {
      topic: "Agents are not following the principle of least privilege when requesting permissions",
      severity: "warning",
    });

    // When the graph scan runs
    const response = await triggerDiagnosticPipeline(
      baseUrl,
      workspaceId,
      user.headers,
    );

    // Then the response includes the learning_proposals_created field
    expect(response.ok).toBe(true);
    const result = await getGraphScanResult(response);
    expect(typeof result.learning_proposals_created).toBe("number");
    expect(result.learning_proposals_created).toBeGreaterThanOrEqual(0);
  }, 120_000);

  // -------------------------------------------------------------------------
  // Rate limit: 6th suggestion in 7 days is rejected
  // -------------------------------------------------------------------------

  it.skip("observer is rate-limited after five learning suggestions in one week", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace where the observer has already suggested 5 learnings this week
    const { user, workspaceId } = await setupObserverWorkspace(
      baseUrl,
      surreal,
      `m3-ratelimit-${crypto.randomUUID()}`,
    );

    await seedRecentObserverLearnings(surreal, workspaceId, 5);

    // And there is a new observation cluster that would normally trigger a proposal
    await createObservationCluster(surreal, workspaceId, 3, {
      topic: "Agents are not sanitizing user input before passing it to shell commands",
      severity: "conflict",
    });

    // When the graph scan runs
    const response = await triggerDiagnosticPipeline(
      baseUrl,
      workspaceId,
      user.headers,
    );

    // Then no additional learning is proposed (rate limit exceeded)
    expect(response.ok).toBe(true);
    const pendingLearnings = await getPendingLearningsFromObserver(surreal, workspaceId);
    // Only the 5 we seeded, no new ones
    expect(pendingLearnings.length).toBe(5);
  }, 120_000);

  // -------------------------------------------------------------------------
  // Dismissed similarity: similar dismissed learning blocks re-suggestion
  // -------------------------------------------------------------------------

  it.skip("observer does not re-suggest a learning that was previously dismissed", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace where a similar learning was previously dismissed
    const { user, workspaceId } = await setupObserverWorkspace(
      baseUrl,
      surreal,
      `m3-dismissed-${crypto.randomUUID()}`,
    );

    await createDismissedLearning(
      surreal,
      workspaceId,
      "Always sanitize user input before executing shell commands to prevent injection attacks",
    );

    // And observations about the same pattern recur
    await createObservationCluster(surreal, workspaceId, 3, {
      topic: "Agents are not sanitizing user input before passing it to shell commands",
      severity: "conflict",
    });

    // When the graph scan runs
    const response = await triggerDiagnosticPipeline(
      baseUrl,
      workspaceId,
      user.headers,
    );

    // Then no learning is proposed (blocked by dismissed similarity gate)
    expect(response.ok).toBe(true);
    const pendingLearnings = await getPendingLearningsFromObserver(surreal, workspaceId);
    expect(pendingLearnings.length).toBe(0);
  }, 120_000);
});
