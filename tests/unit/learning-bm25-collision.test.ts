/**
 * Unit tests: BM25-based collision detection threshold logic.
 *
 * Tests pure functions that decide whether a BM25 search result constitutes
 * a collision (dismissed similarity block or active coverage match).
 * No IO -- these functions take search results and return decisions.
 */
import { describe, test, expect } from "bun:test";

import {
  isDismissedSimilarityMatch,
  isCoverageMatch,
  buildDismissedSimilarityQuery,
  buildCoverageQuery,
} from "../../app/src/server/learning/bm25-collision";

// ---------------------------------------------------------------------------
// isDismissedSimilarityMatch: decides if BM25 result blocks a proposal
// ---------------------------------------------------------------------------

describe("isDismissedSimilarityMatch", () => {
  test("empty results produce no match", () => {
    const result = isDismissedSimilarityMatch([]);
    expect(result.blocked).toBe(false);
  });

  test("result with score above threshold produces match", () => {
    const result = isDismissedSimilarityMatch([
      { text: "Always run tests before merging", score: 2.5 },
    ]);
    expect(result.blocked).toBe(true);
    if (result.blocked) {
      expect(result.matchedText).toBe("Always run tests before merging");
    }
  });

  test("multiple results returns highest-scoring match", () => {
    const result = isDismissedSimilarityMatch([
      { text: "First match", score: 1.0 },
      { text: "Best match", score: 3.0 },
      { text: "Second match", score: 2.0 },
    ]);
    expect(result.blocked).toBe(true);
    if (result.blocked) {
      expect(result.matchedText).toBe("Best match");
    }
  });
});

// ---------------------------------------------------------------------------
// isCoverageMatch: decides if active learning covers a cluster pattern
// ---------------------------------------------------------------------------

describe("isCoverageMatch", () => {
  test("empty results produce no coverage", () => {
    const result = isCoverageMatch([]);
    expect(result.covered).toBe(false);
  });

  test("result with score above threshold produces coverage", () => {
    const result = isCoverageMatch([
      { text: "Active learning about testing", score: 1.5 },
    ]);
    expect(result.covered).toBe(true);
    if (result.covered) {
      expect(result.matchedLearningText).toBe("Active learning about testing");
    }
  });
});

// ---------------------------------------------------------------------------
// Query builders: pure SQL construction (no IO)
// ---------------------------------------------------------------------------

describe("buildDismissedSimilarityQuery", () => {
  test("builds query with bound $query param and workspace filter", () => {
    const sql = buildDismissedSimilarityQuery();
    expect(sql).toContain("@1@ $query");
    expect(sql).toContain('status = "dismissed"');
    expect(sql).toContain("workspace = $ws");
    expect(sql).toContain("search::score(1)");
  });

  test("does not use string literal interpolation", () => {
    const sql = buildDismissedSimilarityQuery();
    expect(sql).not.toMatch(/@1@ '/);
  });
});

describe("buildCoverageQuery", () => {
  test("builds query filtering by active status", () => {
    const sql = buildCoverageQuery();
    expect(sql).toContain("@1@ $query");
    expect(sql).toContain('status = "active"');
    expect(sql).toContain("workspace = $ws");
  });

  test("builds query filtering by dismissed status", () => {
    const sql = buildCoverageQuery("dismissed");
    expect(sql).toContain('status = "dismissed"');
  });
});
