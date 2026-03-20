/**
 * Acceptance test: BM25-based collision detection for learnings.
 *
 * Verifies that learning collision detection (dismissed similarity check
 * and active coverage check) uses BM25 fulltext search instead of
 * embedding-based KNN search.
 *
 * Scenarios:
 *   2.1 - Dismissed learning blocks near-duplicate proposal (walking skeleton)
 *   2.3 - Different learning text passes collision check
 *   2.4 - Workspace boundary isolation
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RecordId, Surreal } from "surrealdb";

// ---------------------------------------------------------------------------
// Direct SurrealDB setup (no full server needed -- tests detector directly)
// ---------------------------------------------------------------------------

const surrealUrl = process.env.SURREAL_URL ?? "ws://127.0.0.1:8000/rpc";
const surrealUsername = process.env.SURREAL_USERNAME ?? "root";
const surrealPassword = process.env.SURREAL_PASSWORD ?? "root";

describe("BM25 collision detection for learnings", () => {
  let surreal: Surreal;
  const namespace = `bm25_collision_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const database = `collision_test_${Math.floor(Math.random() * 100000)}`;
  const workspaceId = `ws-collision-${randomUUID()}`;
  const workspaceRecord = new RecordId("workspace", workspaceId);
  const otherWorkspaceId = `ws-other-${randomUUID()}`;
  const otherWorkspaceRecord = new RecordId("workspace", otherWorkspaceId);

  beforeAll(async () => {
    surreal = new Surreal();
    await surreal.connect(surrealUrl);
    await surreal.signin({ username: surrealUsername, password: surrealPassword });
    await surreal.query(`DEFINE NAMESPACE ${namespace};`);
    await surreal.use({ namespace });
    await surreal.query(`DEFINE DATABASE ${database};`);
    await surreal.use({ namespace, database });

    // Apply base schema
    const schemaSql = readFileSync(
      join(process.cwd(), "schema", "surreal-schema.surql"),
      "utf8",
    );
    await surreal.query(schemaSql);

    // Apply fulltext search migrations
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

    // Create workspaces
    await surreal.query(`
      CREATE $ws CONTENT {
        name: 'Collision Test Workspace',
        status: 'active',
        onboarding_complete: true,
        onboarding_turn_count: 0,
        onboarding_summary_pending: false,
        onboarding_started_at: time::now(),
        created_at: time::now()
      };
      CREATE $otherWs CONTENT {
        name: 'Other Workspace',
        status: 'active',
        onboarding_complete: true,
        onboarding_turn_count: 0,
        onboarding_summary_pending: false,
        onboarding_started_at: time::now(),
        created_at: time::now()
      };
    `, { ws: workspaceRecord, otherWs: otherWorkspaceRecord });
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

  // -------------------------------------------------------------------------
  // Scenario 2.1: Walking skeleton -- dismissed learning blocks near-duplicate
  // -------------------------------------------------------------------------
  test("dismissed learning blocks near-duplicate proposal via BM25", async () => {
    // Given: workspace has a dismissed learning
    const dismissedId = randomUUID();
    await surreal.query(`
      CREATE $record CONTENT {
        text: 'Always run integration tests before merging changes into the main branch',
        learning_type: 'instruction',
        status: 'dismissed',
        source: 'agent',
        priority: 'medium',
        target_agents: ['coding'],
        workspace: $ws,
        dismissed_at: time::now(),
        created_at: time::now(),
        updated_at: time::now()
      };
    `, {
      record: new RecordId("learning", dismissedId),
      ws: workspaceRecord,
    });

    // When: checking dismissed similarity with near-duplicate text
    // (same core tokens: "integration tests", "merging", "main branch")
    const { checkDismissedSimilarity } = await import(
      "../../../app/src/server/learning/detector"
    );

    const result = await checkDismissedSimilarity({
      surreal,
      workspaceRecord,
      proposedText: "Run integration tests before merging into the main branch",
    });

    // Then: proposal is blocked (BM25 matches on shared stems)
    expect(result.blocked).toBe(true);
    expect(result.matchedText).toContain("integration tests");
  }, 15_000);

  // -------------------------------------------------------------------------
  // Scenario 2.3: Different learning text passes collision check
  // -------------------------------------------------------------------------
  test("unrelated learning text passes dismissed similarity check", async () => {
    const { checkDismissedSimilarity } = await import(
      "../../../app/src/server/learning/detector"
    );

    const result = await checkDismissedSimilarity({
      surreal,
      workspaceRecord,
      proposedText: "Use dependency injection for all database access layers",
    });

    // Then: no collision found
    expect(result.blocked).toBe(false);
  }, 15_000);

  // -------------------------------------------------------------------------
  // Scenario 2.4: Workspace boundary isolation
  // -------------------------------------------------------------------------
  test("dismissed learning in another workspace does not block proposal", async () => {
    // Given: a dismissed learning in OTHER workspace only
    const otherId = randomUUID();
    await surreal.query(`
      CREATE $record CONTENT {
        text: 'Always use TypeScript strict mode in all projects',
        learning_type: 'constraint',
        status: 'dismissed',
        source: 'agent',
        priority: 'high',
        target_agents: ['coding'],
        workspace: $otherWs,
        dismissed_at: time::now(),
        created_at: time::now(),
        updated_at: time::now()
      };
    `, {
      record: new RecordId("learning", otherId),
      otherWs: otherWorkspaceRecord,
    });

    const { checkDismissedSimilarity } = await import(
      "../../../app/src/server/learning/detector"
    );

    // When: checking from the primary workspace with matching text
    const result = await checkDismissedSimilarity({
      surreal,
      workspaceRecord, // primary workspace -- NOT otherWorkspaceRecord
      proposedText: "Always use TypeScript strict mode in all projects",
    });

    // Then: not blocked (different workspace)
    expect(result.blocked).toBe(false);
  }, 15_000);

  // -------------------------------------------------------------------------
  // Scenario 2.5: suggestLearning no longer requires embedding parameter
  // -------------------------------------------------------------------------
  test("suggestLearning works without embedding parameter", async () => {
    const { suggestLearning } = await import(
      "../../../app/src/server/learning/detector"
    );

    // Seed a dismissed learning to ensure collision check runs
    const dismissedId2 = randomUUID();
    await surreal.query(`
      CREATE $record CONTENT {
        text: 'Never use var declarations in JavaScript code',
        learning_type: 'constraint',
        status: 'dismissed',
        source: 'agent',
        priority: 'medium',
        target_agents: ['coding'],
        workspace: $ws,
        dismissed_at: time::now(),
        created_at: time::now(),
        updated_at: time::now()
      };
    `, {
      record: new RecordId("learning", dismissedId2),
      ws: workspaceRecord,
    });

    // When: proposing a learning WITHOUT embedding parameter
    const result = await suggestLearning({
      surreal,
      workspaceRecord,
      learning: {
        text: "Never use var declarations in JavaScript code",
        learningType: "constraint",
        source: "agent",
        suggestedBy: "test_agent",
      },
      // NOTE: no embedding parameter -- BM25 replaces KNN
      now: new Date(),
    });

    // Then: blocked by dismissed similarity (proving BM25 ran without embedding)
    expect(result.created).toBe(false);
    if (!result.created) {
      expect(result.reason).toBe("dismissed_similarity");
    }
  }, 15_000);
});
