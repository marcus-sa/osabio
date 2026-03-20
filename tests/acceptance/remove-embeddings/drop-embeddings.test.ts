/**
 * Acceptance test: Drop all HNSW indexes and embedding fields (Step 03-01).
 *
 * Verifies that after applying the base schema (which no longer defines
 * embedding fields or HNSW indexes), INFO FOR TABLE confirms:
 *   - No embedding or description_embedding fields on any table
 *   - No HNSW indexes on any table
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Surreal } from "surrealdb";

const surrealUrl = process.env.SURREAL_URL ?? "ws://127.0.0.1:8000/rpc";
const surrealUsername = process.env.SURREAL_USERNAME ?? "root";
const surrealPassword = process.env.SURREAL_PASSWORD ?? "root";

/** All tables that previously had embedding fields or HNSW indexes. */
const tablesWithEmbedding = [
  "conversation",
  "message",
  "project",
  "feature",
  "task",
  "decision",
  "question",
  "observation",
  "suggestion",
  "person",
  "document_chunk",
  "git_commit",
  "intent",
  "policy",
  "learning",
  "objective",
] as const;

/** Tables that had description_embedding fields. */
const tablesWithDescriptionEmbedding = [
  "agent_session",
  "agent",
] as const;

describe("Drop HNSW indexes and embedding fields (migration 0064)", () => {
  let surreal: Surreal;
  const namespace = `drop_emb_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const database = `drop_emb_test_${Math.floor(Math.random() * 100000)}`;

  beforeAll(async () => {
    surreal = new Surreal();
    await surreal.connect(surrealUrl);
    await surreal.signin({ username: surrealUsername, password: surrealPassword });
    await surreal.query(`DEFINE NAMESPACE ${namespace};`);
    await surreal.use({ namespace });
    await surreal.query(`DEFINE DATABASE ${database};`);
    await surreal.use({ namespace, database });

    // Apply base schema (should already have embedding fields removed)
    const schemaSql = readFileSync(
      join(process.cwd(), "schema", "surreal-schema.surql"),
      "utf8",
    );
    await surreal.query(schemaSql);
  });

  afterAll(async () => {
    try {
      await surreal.query(`REMOVE DATABASE ${database};`);
      await surreal.query(`REMOVE NAMESPACE ${namespace};`);
    } finally {
      await surreal.close();
    }
  });

  for (const table of tablesWithEmbedding) {
    test(`${table} has no embedding field`, async () => {
      const [info] = await surreal.query<[Record<string, unknown>]>(
        `INFO FOR TABLE ${table};`,
      );
      const fields = info.fields as Record<string, string>;
      expect(fields.embedding).toBeUndefined();
    });

    test(`${table} has no HNSW index on embedding`, async () => {
      const [info] = await surreal.query<[Record<string, unknown>]>(
        `INFO FOR TABLE ${table};`,
      );
      const indexes = info.indexes as Record<string, string>;
      const hnswIndexes = Object.entries(indexes).filter(
        ([_, def]) => typeof def === "string" && def.includes("HNSW"),
      );
      expect(hnswIndexes).toEqual([]);
    });
  }

  for (const table of tablesWithDescriptionEmbedding) {
    test(`${table} has no description_embedding field`, async () => {
      const [info] = await surreal.query<[Record<string, unknown>]>(
        `INFO FOR TABLE ${table};`,
      );
      const fields = info.fields as Record<string, string>;
      expect(fields.description_embedding).toBeUndefined();
    });

    test(`${table} has no HNSW index on description_embedding`, async () => {
      const [info] = await surreal.query<[Record<string, unknown>]>(
        `INFO FOR TABLE ${table};`,
      );
      const indexes = info.indexes as Record<string, string>;
      const hnswIndexes = Object.entries(indexes).filter(
        ([_, def]) => typeof def === "string" && def.includes("HNSW"),
      );
      expect(hnswIndexes).toEqual([]);
    });
  }
});
