/**
 * Acceptance test: BM25-based observation clustering for learning diagnosis.
 *
 * Verifies that observation clustering in learning-diagnosis uses BM25 fulltext
 * search instead of embedding cosine similarity for grouping similar observations.
 *
 * Scenarios:
 *   5.1 - Walking skeleton: 3 similar observations grouped by BM25 text similarity
 *   5.2 - Dissimilar observations are NOT clustered together
 *   5.3 - Clustering feeds into learning suggestion pipeline (coverage check)
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RecordId, Surreal } from "surrealdb";
import { applyTestSchema } from "../acceptance-test-kit";

// ---------------------------------------------------------------------------
// Direct SurrealDB setup (no full server needed -- tests clustering directly)
// ---------------------------------------------------------------------------

const surrealUrl = process.env.SURREAL_URL ?? "ws://127.0.0.1:8000/rpc";
const surrealUsername = process.env.SURREAL_USERNAME ?? "root";
const surrealPassword = process.env.SURREAL_PASSWORD ?? "root";

describe("BM25 observation clustering for learning diagnosis", () => {
  let surreal: Surreal;
  const namespace = `obs_cluster_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const database = `cluster_test_${Math.floor(Math.random() * 100000)}`;
  const workspaceId = `ws-cluster-${randomUUID()}`;
  const workspaceRecord = new RecordId("workspace", workspaceId);

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

    // Apply fulltext search migrations (observation BM25 index)
    const migration0002 = readFileSync(
      join(process.cwd(), "schema", "migrations", "0002_fulltext_search_indexes.surql"),
      "utf8",
    );
    await surreal.query(migration0002);

    const migration0062 = readFileSync(
      join(process.cwd(), "schema", "migrations", "0062_bm25_indexes_for_embedding_replacement.surql"),
      "utf8",
    );
    await surreal.query(migration0062);

    // Create workspace
    await surreal.query(`
      CREATE $ws CONTENT {
        name: 'Clustering Test Workspace',
        status: 'active',
        onboarding_complete: true,
        onboarding_turn_count: 0,
        onboarding_summary_pending: false,
        onboarding_started_at: time::now(),
        created_at: time::now()
      };
    `, { ws: workspaceRecord });
  }, 60_000);

  afterAll(async () => {
    try {
      await surreal.query(`REMOVE DATABASE ${database};`);
      await surreal.query(`REMOVE NAMESPACE ${namespace};`);
    } catch {
      // Best-effort cleanup
    } finally {
      await surreal.close();
    }
  });

  /**
   * Helper: seed an observation into the workspace (no embedding).
   */
  async function seedObservation(text: string, severity: string = "warning"): Promise<string> {
    const id = randomUUID();
    await surreal.query(`
      CREATE $record CONTENT {
        text: $text,
        severity: $severity,
        status: 'open',
        source_agent: 'observer_agent',
        workspace: $ws,
        created_at: time::now(),
        updated_at: time::now()
      };
    `, {
      record: new RecordId("observation", id),
      text,
      severity,
      ws: workspaceRecord,
    });
    return id;
  }

  // -------------------------------------------------------------------------
  // Scenario 5.1: Walking skeleton -- 3 similar observations grouped by BM25
  // -------------------------------------------------------------------------
  test("similar observations grouped by BM25 text relevance without embeddings", async () => {
    // Given: 3 observations with similar text about "deployment failures"
    await seedObservation("Deployment failure detected in production environment during release pipeline");
    await seedObservation("Deployment failure in the production release pipeline caused service downtime");
    await seedObservation("Production deployment failure during automated release pipeline execution");

    // When: querying observations and clustering via BM25
    const {
      queryRecentObservations,
      clusterObservationsByBm25,
    } = await import("../../../app/src/server/observer/learning-diagnosis");

    const observations = await queryRecentObservations(surreal, workspaceRecord);
    expect(observations.length).toBeGreaterThanOrEqual(3);

    // Observations should NOT have embeddings (BM25 path does not require them)
    for (const obs of observations) {
      // The new query function should not require/return embeddings
      expect(obs).toHaveProperty("text");
      expect(obs).toHaveProperty("id");
    }

    const clusters = await clusterObservationsByBm25(surreal, workspaceRecord, observations);

    // Then: observations are grouped into at least one cluster
    expect(clusters.length).toBeGreaterThanOrEqual(1);

    // The cluster containing deployment failure observations should have >= 3 members
    const deploymentCluster = clusters.find(
      (c) => c.representativeText.toLowerCase().includes("deployment"),
    );
    expect(deploymentCluster).toBeDefined();
    expect(deploymentCluster!.clusterSize).toBeGreaterThanOrEqual(3);
  }, 30_000);

  // -------------------------------------------------------------------------
  // Scenario 5.2: Dissimilar observations are NOT clustered together
  // -------------------------------------------------------------------------
  test("dissimilar observations are not grouped in the same cluster", async () => {
    // Given: observations about completely different topics
    await seedObservation("Memory leak detected in the payment processing microservice heap");
    await seedObservation("Authentication token expiry misconfigured for OAuth2 provider");
    await seedObservation("CSS styling regression in the dashboard navigation sidebar");

    const {
      queryRecentObservations,
      clusterObservationsByBm25,
    } = await import("../../../app/src/server/observer/learning-diagnosis");

    const observations = await queryRecentObservations(surreal, workspaceRecord);

    // When: clustering via BM25
    const clusters = await clusterObservationsByBm25(surreal, workspaceRecord, observations);

    // Then: dissimilar observations should NOT be grouped together in a single cluster
    // (they may form no cluster at all since they share no text overlap)
    for (const cluster of clusters) {
      const hasMemoryLeak = cluster.observations.some((o) =>
        o.text.toLowerCase().includes("memory leak"),
      );
      const hasAuth = cluster.observations.some((o) =>
        o.text.toLowerCase().includes("authentication token"),
      );
      const hasCss = cluster.observations.some((o) =>
        o.text.toLowerCase().includes("css styling"),
      );

      // No single cluster should contain all three unrelated topics
      const topicCount = [hasMemoryLeak, hasAuth, hasCss].filter(Boolean).length;
      expect(topicCount).toBeLessThanOrEqual(1);
    }
  }, 30_000);

  // -------------------------------------------------------------------------
  // Scenario 5.3: Clustering feeds into coverage check pipeline
  // -------------------------------------------------------------------------
  test("BM25 clusters feed into learning coverage check pipeline", async () => {
    // Given: an active learning that covers deployment failures
    const learningId = randomUUID();
    await surreal.query(`
      CREATE $record CONTENT {
        text: 'Always verify deployment pipeline health before production releases',
        learning_type: 'instruction',
        status: 'active',
        source: 'agent',
        priority: 'medium',
        target_agents: ['coding'],
        workspace: $ws,
        created_at: time::now(),
        updated_at: time::now()
      };
    `, {
      record: new RecordId("learning", learningId),
      ws: workspaceRecord,
    });

    const {
      queryRecentObservations,
      clusterObservationsByBm25,
      checkCoverageAgainstActiveLearnings,
    } = await import("../../../app/src/server/observer/learning-diagnosis");

    const observations = await queryRecentObservations(surreal, workspaceRecord);
    const clusters = await clusterObservationsByBm25(surreal, workspaceRecord, observations);

    // When: checking coverage for a deployment cluster
    const deploymentCluster = clusters.find(
      (c) => c.representativeText.toLowerCase().includes("deployment"),
    );

    if (deploymentCluster) {
      const coverage = await checkCoverageAgainstActiveLearnings(
        surreal,
        workspaceRecord,
        deploymentCluster.representativeText,
      );

      // Then: the active learning about deployment pipeline should cover this cluster
      expect(coverage.covered).toBe(true);
    }
  }, 30_000);
});
