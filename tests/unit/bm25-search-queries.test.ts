/**
 * Unit tests for BM25 search query builder pure functions.
 *
 * Tests buildBm25SearchSQL — the pure core of the BM25 entity search pipeline.
 * SurrealDB 3.0.4+: @N@ works with bound $query parameters.
 */
import { describe, test, expect } from "bun:test";
import { buildBm25SearchSQL } from "../../app/src/server/graph/bm25-search";

describe("buildBm25SearchSQL", () => {
  test("generates SQL for all default entity kinds", () => {
    const sql = buildBm25SearchSQL();

    // Should contain queries for all searchable tables
    expect(sql).toContain("FROM task");
    expect(sql).toContain("FROM decision");
    expect(sql).toContain("FROM question");
    expect(sql).toContain("FROM feature");
    expect(sql).toContain("FROM project");
    expect(sql).toContain("FROM suggestion");

    // Should use BM25 match operator with bound parameter
    expect(sql).toContain("@1@");
    expect(sql).toContain("@1@ $query");

    // Should filter by workspace
    expect(sql).toContain("workspace = $workspace");

    // Should use search::score
    expect(sql).toContain("search::score(1)");
  });

  test("filters by specified kinds only", () => {
    const sql = buildBm25SearchSQL(["task", "decision"]);

    expect(sql).toContain("FROM task");
    expect(sql).toContain("FROM decision");
    expect(sql).not.toContain("FROM question");
    expect(sql).not.toContain("FROM feature");
    expect(sql).not.toContain("FROM project");
    expect(sql).not.toContain("FROM suggestion");
  });

  test("uses bound $query parameter not string literal", () => {
    const sql = buildBm25SearchSQL(["task"]);

    // Should NOT contain any string literal patterns like @1@ '...'
    expect(sql).not.toMatch(/@1@ '/);
    // Should use bound param
    expect(sql).toContain("@1@ $query");
  });

  test("includes ORDER BY score DESC and LIMIT", () => {
    const sql = buildBm25SearchSQL();
    expect(sql).toContain("ORDER BY score DESC");
    expect(sql).toContain("LIMIT $limit");
  });
});
