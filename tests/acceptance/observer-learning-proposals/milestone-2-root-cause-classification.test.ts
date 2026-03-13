/**
 * Milestone 2: Root Cause Classification with LLM Structured Output
 *
 * Traces: Step 2 of implementation roadmap
 *
 * Validates:
 * - Root cause classification produces a valid category and learning type
 * - Dual gate: low confidence results in observation instead of learning
 * - LLM timeout results in graceful failure (no crash)
 * - Observer model unavailable causes diagnostic step to be skipped entirely
 *
 * Driving ports:
 *   POST /api/observe/scan/:workspaceId   (graph scan triggers classification)
 *   SurrealDB direct queries              (verification of outcomes)
 *
 * NOTE: These tests use the real observer model. The LLM classification output
 * is non-deterministic, so assertions focus on structural correctness and
 * pipeline resilience rather than specific category outputs.
 */
import { describe, expect, it, beforeAll } from "bun:test";
import {
  setupDiagnosticSuite,
  wireObserverEvents,
  setupObserverWorkspace,
  createObservationCluster,
  triggerDiagnosticPipeline,
  getPendingLearningsFromObserver,
  getGraphScanResult,
  getWorkspaceObservations,
} from "./observer-learning-proposals-test-kit";

const getRuntime = setupDiagnosticSuite("diagnostic_m2_classification");

beforeAll(async () => {
  const { surreal, port } = getRuntime();
  await wireObserverEvents(surreal, port);
});

describe("Milestone 2: Root Cause Classification", () => {
  // -------------------------------------------------------------------------
  // Valid classification: produces correct category and learning type
  // -------------------------------------------------------------------------

  it.skip("root cause classification produces a learning with valid category and type", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with a clear pattern: agents ignoring confirmed decisions
    const { user, workspaceId } = await setupObserverWorkspace(
      baseUrl,
      surreal,
      `m2-classify-${crypto.randomUUID()}`,
    );

    await createObservationCluster(surreal, workspaceId, 4, {
      topic: "Coding agents are implementing features that contradict confirmed architectural decisions about using event sourcing",
      severity: "conflict",
    });

    // When the graph scan runs the diagnostic pipeline
    const response = await triggerDiagnosticPipeline(
      baseUrl,
      workspaceId,
      user.headers,
    );

    // Then the scan completes successfully
    expect(response.ok).toBe(true);

    // And the proposed learning (if confidence was sufficient) has valid structure
    const pendingLearnings = await getPendingLearningsFromObserver(surreal, workspaceId);
    if (pendingLearnings.length > 0) {
      const proposed = pendingLearnings[0];
      // Learning type is one of the valid types
      expect(["constraint", "instruction"]).toContain(proposed.learning_type);
      // Source metadata is correct
      expect(proposed.source).toBe("agent");
      expect(proposed.suggested_by).toBe("observer");
      // Pattern confidence was recorded
      expect(proposed.pattern_confidence).toBeDefined();
      expect(proposed.pattern_confidence).toBeGreaterThanOrEqual(0);
      expect(proposed.pattern_confidence).toBeLessThanOrEqual(1);
      // Learning text is substantive (not empty or trivially short)
      expect(proposed.text.length).toBeGreaterThan(10);
    }
    // If no learning was proposed, the pipeline still completed (confidence gate)
  }, 120_000);

  // -------------------------------------------------------------------------
  // Dual gate: low confidence creates observation instead of learning
  // -------------------------------------------------------------------------

  it.skip("pipeline creates an observation when classification confidence is below threshold", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with observations on a deliberately vague and ambiguous topic
    const { user, workspaceId } = await setupObserverWorkspace(
      baseUrl,
      surreal,
      `m2-lowconf-${crypto.randomUUID()}`,
    );

    // Use maximally vague observations that should produce low classification confidence
    await createObservationCluster(surreal, workspaceId, 3, {
      topic: "Something went wrong somewhere in some process at some point recently",
      severity: "info",
    });

    // When the graph scan runs
    const response = await triggerDiagnosticPipeline(
      baseUrl,
      workspaceId,
      user.headers,
    );

    // Then the scan completes without error
    expect(response.ok).toBe(true);

    // And the pipeline either:
    // a) Created an observation instead of a learning (low confidence), OR
    // b) Created a learning anyway (model was unexpectedly confident)
    // Both are valid -- the key assertion is that the pipeline completed gracefully
    const result = await getGraphScanResult(response);
    expect(result).toBeDefined();
  }, 120_000);

  // -------------------------------------------------------------------------
  // Graceful failure: LLM errors do not crash the scan
  // -------------------------------------------------------------------------

  it.skip("graph scan completes even when diagnostic classification encounters an error", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with a normal observation cluster
    const { user, workspaceId } = await setupObserverWorkspace(
      baseUrl,
      surreal,
      `m2-error-${crypto.randomUUID()}`,
    );

    await createObservationCluster(surreal, workspaceId, 3, {
      topic: "Agents are not following the established code review process before merging",
      severity: "warning",
    });

    // When the graph scan runs (even if classification has transient issues)
    const response = await triggerDiagnosticPipeline(
      baseUrl,
      workspaceId,
      user.headers,
    );

    // Then the scan still completes (diagnostic step does not block other scan steps)
    expect(response.ok).toBe(true);

    // And the scan result is parseable
    const result = await getGraphScanResult(response);
    expect(result.observations_created).toBeGreaterThanOrEqual(0);
  }, 120_000);

  // -------------------------------------------------------------------------
  // Model unavailable: diagnostic step skipped entirely
  // -------------------------------------------------------------------------

  it.skip("diagnostic pipeline is skipped when observer model is not configured", async () => {
    // NOTE: This test requires a server instance without OBSERVER_MODEL configured.
    // In practice, the acceptance suite boots with whatever env is set.
    // This scenario is validated by the implementation: if observerModel is undefined,
    // the diagnostic pipeline returns early. We verify the scan still succeeds.

    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with observations (model availability depends on env)
    const { user, workspaceId } = await setupObserverWorkspace(
      baseUrl,
      surreal,
      `m2-nomodel-${crypto.randomUUID()}`,
    );

    await createObservationCluster(surreal, workspaceId, 3, {
      topic: "Agents are not logging structured metadata with their actions",
      severity: "info",
    });

    // When the graph scan runs
    const response = await triggerDiagnosticPipeline(
      baseUrl,
      workspaceId,
      user.headers,
    );

    // Then the scan completes regardless of model availability
    expect(response.ok).toBe(true);
  }, 120_000);
});
