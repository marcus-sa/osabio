/**
 * Shared result types for learning collision detection.
 *
 * Extracted to avoid circular dependencies between detector.ts and bm25-collision.ts.
 */

export type DismissedSimilarityResult =
  | { blocked: false }
  | { blocked: true; matchedText: string };

export type CoverageCheckResult =
  | { covered: false }
  | { covered: true; matchedLearningText: string; score: number };
