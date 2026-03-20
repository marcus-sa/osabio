/**
 * BM25-based collision detection for learnings.
 *
 * Pure functions for:
 *   - Building BM25 fulltext search queries for dismissed/active learning matching
 *   - Deciding whether search results constitute a collision (threshold logic)
 *
 * IO boundary (actual query execution) lives in detector.ts.
 */
import { escapeSearchQuery } from "../graph/bm25-search";
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
 * BM25 @N@ operator already filters to matching rows -- any row returned by the
 * fulltext match is considered relevant. We take the highest-scoring match.
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
 *
 * Any BM25 fulltext match indicates the pattern is already covered.
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
 * Uses the @N@ operator with string literal interpolation (NOT SDK bound params)
 * per SurrealDB limitation: https://github.com/surrealdb/surrealdb/issues/7013
 *
 * Requires bound parameters: $ws (workspace RecordId)
 */
export function buildDismissedSimilarityQuery(proposedText: string): string {
  const escaped = escapeSearchQuery(proposedText);
  return [
    `SELECT text, search::score(1) AS score`,
    `FROM learning`,
    `WHERE text @1@ '${escaped}'`,
    `AND workspace = $ws`,
    `AND status = "dismissed"`,
    `ORDER BY score DESC`,
    `LIMIT 5;`,
  ].join("\n");
}

/**
 * Builds a BM25 fulltext search query for learning coverage check.
 *
 * Requires bound parameters: $ws (workspace RecordId)
 */
export function buildCoverageQuery(
  clusterText: string,
  learningStatus: "active" | "dismissed" = "active",
): string {
  const escaped = escapeSearchQuery(clusterText);
  return [
    `SELECT text, search::score(1) AS score`,
    `FROM learning`,
    `WHERE text @1@ '${escaped}'`,
    `AND workspace = $ws`,
    `AND status = "${learningStatus}"`,
    `ORDER BY score DESC`,
    `LIMIT 5;`,
  ].join("\n");
}
