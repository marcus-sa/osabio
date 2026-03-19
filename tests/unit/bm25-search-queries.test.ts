/**
 * Unit tests for BM25 search query builder pure functions.
 *
 * Tests escapeSearchQuery and buildBm25SearchSQL — the pure core
 * of the BM25 entity search pipeline.
 */
import { describe, test, expect } from "bun:test";
import { escapeSearchQuery, buildBm25SearchSQL } from "../../app/src/server/graph/bm25-search";

describe("escapeSearchQuery", () => {
  test("passes through alphanumeric text unchanged", () => {
    expect(escapeSearchQuery("tRPC migration")).toBe("tRPC migration");
  });

  test("escapes single quotes", () => {
    expect(escapeSearchQuery("it's a test")).toBe("it\\'s a test");
  });

  test("escapes backslashes", () => {
    expect(escapeSearchQuery("path\\to\\file")).toBe("path\\\\to\\\\file");
  });

  test("escapes both backslashes and single quotes", () => {
    expect(escapeSearchQuery("it's a path\\here")).toBe("it\\'s a path\\\\here");
  });

  test("handles empty string", () => {
    expect(escapeSearchQuery("")).toBe("");
  });

  test("handles double quotes without escaping them", () => {
    expect(escapeSearchQuery('say "hello"')).toBe('say "hello"');
  });

  test("handles SQL injection attempt", () => {
    const input = "'; DROP TABLE task;--";
    const escaped = escapeSearchQuery(input);
    // Single quote is escaped to \' which is safe inside a SurrealQL string literal
    expect(escaped).toBe("\\'; DROP TABLE task;--");
  });
});

describe("buildBm25SearchSQL", () => {
  test("generates SQL for all default entity kinds", () => {
    const sql = buildBm25SearchSQL("tRPC migration");

    // Should contain queries for all searchable tables
    expect(sql).toContain("FROM task");
    expect(sql).toContain("FROM decision");
    expect(sql).toContain("FROM question");
    expect(sql).toContain("FROM feature");
    expect(sql).toContain("FROM project");
    expect(sql).toContain("FROM suggestion");

    // Should use BM25 match operator with escaped query as string literal
    expect(sql).toContain("@1@");
    expect(sql).toContain("'tRPC migration'");

    // Should filter by workspace
    expect(sql).toContain("workspace = $workspace");

    // Should use search::score
    expect(sql).toContain("search::score(1)");
  });

  test("filters by specified kinds only", () => {
    const sql = buildBm25SearchSQL("test query", ["task", "decision"]);

    expect(sql).toContain("FROM task");
    expect(sql).toContain("FROM decision");
    expect(sql).not.toContain("FROM question");
    expect(sql).not.toContain("FROM feature");
    expect(sql).not.toContain("FROM project");
    expect(sql).not.toContain("FROM suggestion");
  });

  test("escapes special characters in query", () => {
    const sql = buildBm25SearchSQL("it's a test");

    // Should contain the escaped version
    expect(sql).toContain("'it\\'s a test'");
  });

  test("includes ORDER BY score DESC and LIMIT", () => {
    const sql = buildBm25SearchSQL("test");
    expect(sql).toContain("ORDER BY score DESC");
    expect(sql).toContain("LIMIT $limit");
  });
});
