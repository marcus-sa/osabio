/**
 * Acceptance test: Chat agent BM25 search (US-EMB-001, Step 01-02)
 *
 * Verifies that entity search in chat tools uses BM25 fulltext search
 * instead of embedding-based vector search.
 *
 * Scenarios:
 *   1.1 — Walking skeleton: BM25 search returns ranked results for matching entities
 *   1.2 — Stemmer: morphological variants match (e.g. "migrating" matches "migration")
 *   1.5 — Empty results: non-matching query returns empty array
 *   1.6 — Special characters: queries with special chars are handled safely
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RecordId, Surreal } from "surrealdb";
import { applyTestSchema } from "../acceptance-test-kit";
import { searchEntitiesByBm25 } from "../../../app/src/server/graph/queries";

const surrealUrl = process.env.SURREAL_URL ?? "ws://127.0.0.1:8000/rpc";
const surrealUsername = process.env.SURREAL_USERNAME ?? "root";
const surrealPassword = process.env.SURREAL_PASSWORD ?? "root";

describe("Chat agent BM25 search (US-EMB-001)", () => {
  let surreal: Surreal;
  const namespace = `chat_bm25_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const database = `chat_bm25_${Math.floor(Math.random() * 100000)}`;
  const workspaceRecord = new RecordId("workspace", "ws-bm25-chat");

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

    // Apply fulltext search indexes migration
    const migration0002 = readFileSync(
      join(process.cwd(), "schema", "migrations", "0002_fulltext_search_indexes.surql"),
      "utf8",
    );
    await surreal.query(migration0002);

    // Seed workspace
    await surreal.query(`
      CREATE $workspace SET
        name = 'BM25 Chat Test',
        status = 'active',
        onboarding_complete = true,
        onboarding_turn_count = 0,
        onboarding_summary_pending = false,
        onboarding_started_at = time::now(),
        created_at = time::now();
    `, { workspace: workspaceRecord });

    // Seed entities for scenario 1.1
    await surreal.query(`
      CREATE decision:trpc_decision SET
        summary = 'Standardize all APIs on tRPC',
        status = 'confirmed',
        workspace = $workspace,
        created_at = time::now();

      CREATE task:trpc_migration SET
        title = 'Migrate billing API to tRPC',
        status = 'open',
        workspace = $workspace,
        created_at = time::now();

      CREATE task:unrelated_task SET
        title = 'Update CI pipeline for faster builds',
        status = 'open',
        workspace = $workspace,
        created_at = time::now();
    `, { workspace: workspaceRecord });
  });

  afterAll(async () => {
    try {
      await surreal.query(`REMOVE DATABASE ${database};`);
      await surreal.query(`REMOVE NAMESPACE ${namespace};`);
    } finally {
      await surreal.close();
    }
  });

  test("1.1 — BM25 search returns ranked results for 'tRPC APIs'", async () => {
    // BM25 uses AND semantics: both tokens must appear in the matched field.
    // "tRPC APIs" matches decision ("Standardize all APIs on tRPC") and
    // task ("Migrate billing API to tRPC") since stemmer reduces "APIs"/"API" to same stem.
    const results = await searchEntitiesByBm25({
      surreal,
      workspaceRecord,
      query: "tRPC APIs",
      limit: 10,
    });

    // Should find at least the decision and the task
    expect(results.length).toBeGreaterThanOrEqual(2);

    const ids = results.map((r) => `${r.kind}:${r.id}`);
    expect(ids).toContain("decision:trpc_decision");
    expect(ids).toContain("task:trpc_migration");

    // Unrelated task should NOT appear
    expect(ids).not.toContain("task:unrelated_task");

    // Results should have non-negative BM25 scores and be sorted descending
    for (const result of results) {
      expect(result.score).toBeGreaterThanOrEqual(0);
    }
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });

  test("1.2 — Stemmer matches morphological variants", async () => {
    // "migrating" should match "Migrate" via snowball stemmer
    const results = await searchEntitiesByBm25({
      surreal,
      workspaceRecord,
      query: "migrating billing",
      limit: 10,
    });

    const ids = results.map((r) => `${r.kind}:${r.id}`);
    expect(ids).toContain("task:trpc_migration");
  });

  test("1.5 — Non-matching query returns empty array", async () => {
    const results = await searchEntitiesByBm25({
      surreal,
      workspaceRecord,
      query: "xyznonexistent qwertyuiop",
      limit: 10,
    });

    expect(results).toEqual([]);
  });

  test("1.6 — Special characters in query are handled safely", async () => {
    // Queries with SQL injection attempts and special chars should not throw
    const results = await searchEntitiesByBm25({
      surreal,
      workspaceRecord,
      query: "tRPC's \"migration\" OR 1=1; DROP TABLE task;--",
      limit: 10,
    });

    // Should not throw, may or may not return results depending on tokenization
    expect(Array.isArray(results)).toBe(true);
  });

  test("1.6b — Query with backslashes handled safely", async () => {
    const results = await searchEntitiesByBm25({
      surreal,
      workspaceRecord,
      query: "path\\to\\file migration",
      limit: 10,
    });

    expect(Array.isArray(results)).toBe(true);
  });

  test("1.1b — Kind filtering narrows results", async () => {
    const results = await searchEntitiesByBm25({
      surreal,
      workspaceRecord,
      query: "tRPC",
      kinds: ["task"],
      limit: 10,
    });

    // Only tasks should appear
    for (const result of results) {
      expect(result.kind).toBe("task");
    }
    const ids = results.map((r) => `${r.kind}:${r.id}`);
    expect(ids).toContain("task:trpc_migration");
    // Decision should NOT appear since we filtered to tasks only
    expect(ids).not.toContain("decision:trpc_decision");
  });
});
