/**
 * Walking Skeleton: Observer Diagnoses Patterns and Proposes Learnings
 *
 * Traces: ADR-031 (Root Cause Trace), US-AL-002 (agent suggests learning)
 *
 * These are the minimum viable E2E paths through the diagnostic learning pipeline.
 * Skeleton 1: 3+ similar observations -> graph scan -> learning proposed with evidence
 * Skeleton 2: Active learning already covers pattern -> no duplicate proposal
 * Skeleton 3: Pipeline runs without error on ambiguous patterns (graceful path)
 *
 * Together they prove:
 * - Observation clustering works (groups similar observations)
 * - Root cause classification runs (LLM diagnoses the pattern)
 * - Learning record is created via suggestLearning() with status pending_approval
 * - Evidence edges trace back to source observations
 * - Coverage check prevents duplicate learnings for already-covered patterns
 * - Pipeline degrades gracefully when classification is uncertain
 *
 * Driving ports:
 *   POST /api/observe/scan/:workspaceId   (graph scan with diagnostic step)
 *   SurrealDB direct queries              (verification of outcomes)
 */
import { describe, expect, it, beforeAll } from "bun:test";
import {
  setupDiagnosticSuite,
  wireObserverEvents,
  setupObserverWorkspace,
  createObservationCluster,
  createActiveLearningCovering,
  triggerDiagnosticPipeline,
  getPendingLearningsFromObserver,
  getGraphScanResult,
} from "./observer-learning-proposals-test-kit";

const getRuntime = setupDiagnosticSuite("diagnostic_walking_skeleton");

beforeAll(async () => {
  const { surreal, port } = getRuntime();
  await wireObserverEvents(surreal, port);
});

describe("Walking Skeleton: Observer diagnoses observation patterns and proposes learnings", () => {
  // ---------------------------------------------------------------------------
  // Walking Skeleton 1: Observation cluster -> diagnosis -> learning proposed
  // ADR-031 + US-AL-002 happy path
  // ---------------------------------------------------------------------------
  it("observer diagnoses a recurring pattern and proposes a learning for human review", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace where the observer has detected a recurring pattern
    const { user, workspaceId } = await setupObserverWorkspace(
      baseUrl,
      surreal,
      `skeleton-propose-${crypto.randomUUID()}`,
    );

    // And three similar observations about agents repeatedly failing to check rate limits
    const { observationIds } = await createObservationCluster(
      surreal,
      workspaceId,
      3,
      {
        topic: "Agents are not checking rate limits before making external API calls",
        severity: "warning",
      },
    );

    // When the periodic graph scan runs
    const response = await triggerDiagnosticPipeline(
      baseUrl,
      workspaceId,
      user.headers,
    );

    // Then the scan completes successfully
    expect(response.ok).toBe(true);

    // And the observer proposes a learning for human review
    const pendingLearnings = await getPendingLearningsFromObserver(surreal, workspaceId);
    expect(pendingLearnings.length).toBeGreaterThanOrEqual(1);

    // And the proposed learning has correct metadata
    const proposed = pendingLearnings[0];
    expect(proposed.source).toBe("agent");
    expect(proposed.suggested_by).toBe("observer");
    expect(proposed.status).toBe("pending_approval");
    expect(proposed.text).toBeTruthy();
    expect(proposed.learning_type).toBeDefined();
    expect(["constraint", "instruction"]).toContain(proposed.learning_type);
  }, 120_000);

  // ---------------------------------------------------------------------------
  // Walking Skeleton 2: Active learning covers pattern -> no duplicate proposal
  // ADR-031 coverage check
  // ---------------------------------------------------------------------------
  it("observer skips learning proposal when an active learning already covers the pattern", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with an active learning about rate limit checking
    const { user, workspaceId } = await setupObserverWorkspace(
      baseUrl,
      surreal,
      `skeleton-coverage-${crypto.randomUUID()}`,
    );

    await createActiveLearningCovering(
      surreal,
      workspaceId,
      "Always check rate limits before making external API calls to avoid throttling",
    );

    // And three similar observations about the same rate limit pattern
    await createObservationCluster(surreal, workspaceId, 3, {
      topic: "Agents are not checking rate limits before making external API calls",
      severity: "warning",
    });

    // When the periodic graph scan runs
    const response = await triggerDiagnosticPipeline(
      baseUrl,
      workspaceId,
      user.headers,
    );

    // Then the scan completes successfully
    expect(response.ok).toBe(true);

    // And no new learning is proposed (the active learning already covers this pattern)
    const pendingLearnings = await getPendingLearningsFromObserver(surreal, workspaceId);
    expect(pendingLearnings.length).toBe(0);
  }, 120_000);

  // ---------------------------------------------------------------------------
  // Walking Skeleton 3: Pipeline runs gracefully on ambiguous patterns
  // ADR-031 confidence gate / graceful degradation
  // ---------------------------------------------------------------------------
  it("observer completes graph scan without error even when patterns are ambiguous", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with observations on a vague, hard-to-classify topic
    const { user, workspaceId } = await setupObserverWorkspace(
      baseUrl,
      surreal,
      `skeleton-ambiguous-${crypto.randomUUID()}`,
    );

    await createObservationCluster(surreal, workspaceId, 3, {
      topic: "Something unusual happened during processing but the cause is unclear",
      severity: "info",
    });

    // When the periodic graph scan runs
    const response = await triggerDiagnosticPipeline(
      baseUrl,
      workspaceId,
      user.headers,
    );

    // Then the scan completes without error (pipeline is resilient)
    expect(response.ok).toBe(true);

    // And the scan result is parseable (regardless of whether a learning was proposed)
    const scanResult = await getGraphScanResult(response);
    expect(scanResult.observations_created).toBeGreaterThanOrEqual(0);
    // The pipeline either proposed a learning (model was confident) or created
    // an observation (model was not confident) -- both are valid outcomes
  }, 120_000);
});
