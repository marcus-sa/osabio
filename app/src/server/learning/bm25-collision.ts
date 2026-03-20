/**
 * BM25-based collision detection for learnings.
 *
 * Pure functions for:
 *   - Building BM25 fulltext search queries for dismissed/active learning matching
 *   - Deciding whether search results constitute a collision (threshold logic)
 *
 * IO boundary (actual query execution) lives in detector.ts.
 */
import type { DismissedSimilarityResult, CoverageCheckResult } from "./collision-types";

// ---------------------------------------------------------------------------
// BM25 search result row (from SurrealDB query)
// ---------------------------------------------------------------------------

export type Bm25LearningMatch = {
  text: string;
  score: number;
};

// Re-export types used by detector
export type { DismissedSimilarityResult, CoverageCheckResult };

// ---------------------------------------------------------------------------
// Threshold decision: dismissed similarity
// ---------------------------------------------------------------------------

/**
 * Determines whether any BM25 search result constitutes a dismissed similarity match.
 *
 * Takes the highest-scoring BM25 match. Any returned row is considered relevant.
 *
 * Pure function -- no IO.
 */
export function isDismissedSimilarityMatch(
  matches: Bm25LearningMatch[],
): DismissedSimilarityResult {
  if (matches.length === 0) {
    return { blocked: false };
  }

  // BM25 results are pre-sorted by score DESC from the query, but
  // ensure we pick the highest in case of unsorted input
  const best = matches.reduce((a, b) => (b.score > a.score ? b : a));
  return { blocked: true, matchedText: best.text };
}

// ---------------------------------------------------------------------------
// Threshold decision: coverage check (active or dismissed learnings)
// ---------------------------------------------------------------------------

/**
 * Determines whether any BM25 search result constitutes a coverage match.
 * Results are ranked by BM25 score -- higher scores indicate stronger matches.
 *
 * Pure function -- no IO.
 */
export function isCoverageMatch(
  matches: Bm25LearningMatch[],
): CoverageCheckResult {
  if (matches.length === 0) {
    return { covered: false };
  }

  const best = matches.reduce((a, b) => (b.score > a.score ? b : a));
  return { covered: true, matchedLearningText: best.text, score: best.score };
}

// ---------------------------------------------------------------------------
// Query builders (pure SQL construction)
// ---------------------------------------------------------------------------

/**
 * Builds a BM25 fulltext search query for dismissed learning similarity.
 *
 * Requires bound parameters: $ws (workspace RecordId), $query (search text)
 */
export function buildDismissedSimilarityQuery(): string {
  return [
    `SELECT text, search::score(1) AS score`,
    `FROM learning`,
    `WHERE text @1@ $query`,
    `AND workspace = $ws`,
    `AND status = "dismissed"`,
    `ORDER BY score DESC`,
    `LIMIT 5;`,
  ].join("\n");
}

/**
 * Builds a BM25 fulltext search query for learning coverage check.
 *
 * Requires bound parameters: $ws (workspace RecordId), $query (search text)
 */
export function buildCoverageQuery(
  learningStatus: "active" | "dismissed" = "active",
): string {
  return [
    `SELECT text, search::score(1) AS score`,
    `FROM learning`,
    `WHERE text @1@ $query`,
    `AND workspace = $ws`,
    `AND status = "${learningStatus}"`,
    `ORDER BY score DESC`,
    `LIMIT 5;`,
  ].join("\n");
}
