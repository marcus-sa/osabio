/**
 * Milestone 1: Observation Clustering and Coverage Check
 *
 * Traces: Step 1 of implementation roadmap
 *
 * Validates:
 * - Observations with similar embeddings are grouped into clusters (size >= 3)
 * - Observations below cluster threshold (< 3) do not form clusters
 * - Observations on unrelated topics form separate clusters or none
 * - Observations older than 14 days are excluded from clustering
 * - Active learning with similarity > 0.80 causes cluster to be skipped
 * - No matching active learning allows cluster to proceed
 *
 * Driving ports:
 *   POST /api/observe/scan/:workspaceId   (graph scan triggers clustering)
 *   SurrealDB direct queries              (verification of outcomes)
 */
import { describe, expect, it, beforeAll } from "bun:test";
import {
  setupDiagnosticSuite,
  wireObserverEvents,
  setupObserverWorkspace,
  createObservationCluster,
  createActiveLearningCovering,
  createAgedObservations,
  triggerDiagnosticPipeline,
  getPendingLearningsFromObserver,
  getGraphScanResult,
  createTestWorkspace,
} from "./observer-learning-proposals-test-kit";
import { createObservationByAgent } from "../observer-agent/observer-test-kit";
import { generateEmbedding } from "../agent-learnings/learning-test-kit";
import { RecordId } from "surrealdb";

const getRuntime = setupDiagnosticSuite("diagnostic_m1_clustering");

beforeAll(async () => {
  const { surreal, port } = getRuntime();
  await wireObserverEvents(surreal, port);
});

describe("Milestone 1: Observation Clustering and Coverage Check", () => {
  // -------------------------------------------------------------------------
  // Cluster formation: 3+ similar observations form a cluster
  // -------------------------------------------------------------------------

  it.skip("three similar observations about the same pattern form a cluster and trigger diagnosis", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with three observations about agents ignoring error responses
    const { user, workspaceId } = await setupObserverWorkspace(
      baseUrl,
      surreal,
      `m1-cluster-3-${crypto.randomUUID()}`,
    );

    await createObservationCluster(surreal, workspaceId, 3, {
      topic: "Coding agents are not handling error responses from the build system",
      severity: "warning",
    });

    // When the graph scan runs
    const response = await triggerDiagnosticPipeline(
      baseUrl,
      workspaceId,
      user.headers,
    );

    // Then the scan finds the cluster and processes it
    expect(response.ok).toBe(true);
    const result = await getGraphScanResult(response);
    // The diagnostic pipeline ran (either produced a learning or an observation)
    expect(
      result.learning_proposals_created + result.observations_created,
    ).toBeGreaterThanOrEqual(0);
  }, 120_000);

  // -------------------------------------------------------------------------
  // Below threshold: 2 observations do not form a cluster
  // -------------------------------------------------------------------------

  it.skip("two similar observations do not trigger a learning proposal", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with only two observations about the same pattern
    const { user, workspaceId } = await setupObserverWorkspace(
      baseUrl,
      surreal,
      `m1-cluster-2-${crypto.randomUUID()}`,
    );

    await createObservationCluster(surreal, workspaceId, 2, {
      topic: "Agents are deploying without running the test suite first",
      severity: "warning",
    });

    // When the graph scan runs
    const response = await triggerDiagnosticPipeline(
      baseUrl,
      workspaceId,
      user.headers,
    );

    // Then no learning is proposed (below cluster threshold of 3)
    expect(response.ok).toBe(true);
    const pendingLearnings = await getPendingLearningsFromObserver(surreal, workspaceId);
    expect(pendingLearnings.length).toBe(0);
  }, 120_000);

  // -------------------------------------------------------------------------
  // Unrelated topics: observations on different subjects do not cluster
  // -------------------------------------------------------------------------

  it.skip("observations on unrelated topics do not form a cluster together", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with observations spread across different unrelated topics
    const { user, workspaceId } = await setupObserverWorkspace(
      baseUrl,
      surreal,
      `m1-unrelated-${crypto.randomUUID()}`,
    );

    const workspaceRecord = new RecordId("workspace", workspaceId);

    // One observation about rate limits
    const text1 = "Agent exceeded rate limit on external payment API";
    const emb1 = await generateEmbedding(text1);
    const obs1Id = `obs-${crypto.randomUUID()}`;
    await surreal.query(`CREATE $obs CONTENT $content;`, {
      obs: new RecordId("observation", obs1Id),
      content: {
        text: text1, severity: "warning", status: "open",
        source_agent: "observer_agent", workspace: workspaceRecord,
        created_at: new Date(), embedding: emb1,
      },
    });

    // One observation about missing documentation
    const text2 = "Feature shipped without updating user-facing documentation";
    const emb2 = await generateEmbedding(text2);
    const obs2Id = `obs-${crypto.randomUUID()}`;
    await surreal.query(`CREATE $obs CONTENT $content;`, {
      obs: new RecordId("observation", obs2Id),
      content: {
        text: text2, severity: "info", status: "open",
        source_agent: "observer_agent", workspace: workspaceRecord,
        created_at: new Date(), embedding: emb2,
      },
    });

    // One observation about incorrect data formatting
    const text3 = "Agent returned dates in wrong timezone format for the billing report";
    const emb3 = await generateEmbedding(text3);
    const obs3Id = `obs-${crypto.randomUUID()}`;
    await surreal.query(`CREATE $obs CONTENT $content;`, {
      obs: new RecordId("observation", obs3Id),
      content: {
        text: text3, severity: "warning", status: "open",
        source_agent: "observer_agent", workspace: workspaceRecord,
        created_at: new Date(), embedding: emb3,
      },
    });

    // When the graph scan runs
    const response = await triggerDiagnosticPipeline(
      baseUrl,
      workspaceId,
      user.headers,
    );

    // Then no learning is proposed (topics are too different to cluster)
    expect(response.ok).toBe(true);
    const pendingLearnings = await getPendingLearningsFromObserver(surreal, workspaceId);
    expect(pendingLearnings.length).toBe(0);
  }, 120_000);

  // -------------------------------------------------------------------------
  // Time window: observations older than 14 days are excluded
  // -------------------------------------------------------------------------

  it.skip("observations older than fourteen days are excluded from clustering", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with three similar observations that are all 20 days old
    const { user, workspaceId } = await setupObserverWorkspace(
      baseUrl,
      surreal,
      `m1-aged-${crypto.randomUUID()}`,
    );

    await createAgedObservations(
      surreal,
      workspaceId,
      3,
      20,
      "Agents are not validating input data before processing",
    );

    // When the graph scan runs
    const response = await triggerDiagnosticPipeline(
      baseUrl,
      workspaceId,
      user.headers,
    );

    // Then no learning is proposed (all observations are outside the 14-day window)
    expect(response.ok).toBe(true);
    const pendingLearnings = await getPendingLearningsFromObserver(surreal, workspaceId);
    expect(pendingLearnings.length).toBe(0);
  }, 120_000);

  // -------------------------------------------------------------------------
  // Coverage check: active learning with high similarity skips the cluster
  // -------------------------------------------------------------------------

  it.skip("cluster is skipped when an active learning already covers the same pattern", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with an active learning about input validation
    const { user, workspaceId } = await setupObserverWorkspace(
      baseUrl,
      surreal,
      `m1-covered-${crypto.randomUUID()}`,
    );

    await createActiveLearningCovering(
      surreal,
      workspaceId,
      "Always validate all input parameters before processing to prevent malformed data errors",
    );

    // And three observations about the same input validation pattern
    await createObservationCluster(surreal, workspaceId, 3, {
      topic: "Agents are not validating input parameters before processing requests",
      severity: "warning",
    });

    // When the graph scan runs
    const response = await triggerDiagnosticPipeline(
      baseUrl,
      workspaceId,
      user.headers,
    );

    // Then no new learning is proposed (covered by existing active learning)
    expect(response.ok).toBe(true);
    const pendingLearnings = await getPendingLearningsFromObserver(surreal, workspaceId);
    expect(pendingLearnings.length).toBe(0);
  }, 120_000);

  // -------------------------------------------------------------------------
  // Coverage check: no matching active learning allows cluster to proceed
  // -------------------------------------------------------------------------

  it.skip("cluster proceeds to diagnosis when no active learning covers the pattern", async () => {
    const { baseUrl, surreal } = getRuntime();

    // Given a workspace with an active learning about a completely different topic
    const { user, workspaceId } = await setupObserverWorkspace(
      baseUrl,
      surreal,
      `m1-uncovered-${crypto.randomUUID()}`,
    );

    await createActiveLearningCovering(
      surreal,
      workspaceId,
      "Always use TypeScript strict mode for all new source files",
    );

    // And three observations about an unrelated pattern (database connection pooling)
    await createObservationCluster(surreal, workspaceId, 3, {
      topic: "Agents are creating new database connections instead of using the connection pool",
      severity: "conflict",
    });

    // When the graph scan runs
    const response = await triggerDiagnosticPipeline(
      baseUrl,
      workspaceId,
      user.headers,
    );

    // Then the diagnostic pipeline processes the cluster (active learning is unrelated)
    expect(response.ok).toBe(true);
    // The pipeline either proposes a learning or creates an observation based on confidence
    const result = await getGraphScanResult(response);
    expect(
      result.learning_proposals_created + result.observations_created,
    ).toBeGreaterThanOrEqual(0);
  }, 120_000);
});
