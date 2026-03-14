/**
 * Behavior Trend Analysis -- Pure Functions
 *
 * Detects behavioral patterns from score arrays: drift (consecutive
 * below-threshold), improvement (rising scores crossing threshold),
 * flat-line (stagnation), and stable (healthy above-threshold).
 *
 * This module has ZERO IO imports. It is pure data transformation only.
 * Threshold and streak length are parameters, not hardcoded.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ScorePoint = {
  score: number;
  timestamp: string;
};

export type TrendPattern =
  | "drift"
  | "improving"
  | "flat"
  | "stable"
  | "insufficient_data";

export type TrendResult = {
  pattern: TrendPattern;
  belowThreshold: boolean;
  streakLength: number;
};

export type TrendOptions = {
  threshold?: number;
  minStreakLength?: number;
  flatTolerance?: number;
};

export type DriftResult = {
  detected: boolean;
  streakLength: number;
};

export type ImprovementResult = {
  detected: boolean;
};

export type FlatLineResult = {
  detected: boolean;
  belowThreshold: boolean;
};

// ---------------------------------------------------------------------------
// Default Parameters
// ---------------------------------------------------------------------------

const DEFAULT_THRESHOLD = 0.70;
const DEFAULT_MIN_STREAK_LENGTH = 3;
const DEFAULT_FLAT_TOLERANCE = 0.10;

// ---------------------------------------------------------------------------
// Drift Detection
// ---------------------------------------------------------------------------

/**
 * Detects consecutive below-threshold scores from the end of the array.
 * Returns the trailing streak length. A streak of >= minStreakLength
 * indicates behavioral drift.
 */
export function detectDriftStreak(
  points: ScorePoint[],
  threshold: number,
  minStreakLength: number,
): DriftResult {
  if (points.length === 0) {
    return { detected: false, streakLength: 0 };
  }

  // Count trailing consecutive below-threshold scores (from end)
  let streakLength = 0;
  for (let i = points.length - 1; i >= 0; i--) {
    if (points[i].score < threshold) {
      streakLength++;
    } else {
      break;
    }
  }

  return {
    detected: streakLength >= minStreakLength,
    streakLength,
  };
}

// ---------------------------------------------------------------------------
// Improvement Detection
// ---------------------------------------------------------------------------

/**
 * Detects improving trend using simple linear slope. An improving trend
 * requires a positive slope AND the latest score at or above threshold.
 */
export function detectImprovement(
  points: ScorePoint[],
  threshold: number,
): ImprovementResult {
  if (points.length < 2) {
    return { detected: false };
  }

  const scores = points.map((p) => p.score);
  const slope = computeSlope(scores);
  const latestScore = scores[scores.length - 1];
  const firstScore = scores[0];

  // Improvement requires: positive slope, latest above threshold,
  // and started below threshold (otherwise it is just stable above).
  return {
    detected: slope > 0 && latestScore >= threshold && firstScore < threshold,
  };
}

// ---------------------------------------------------------------------------
// Flat-Line Detection
// ---------------------------------------------------------------------------

/**
 * Detects flat-line pattern where score variance stays within tolerance.
 * Indicates stagnation -- especially concerning when below threshold
 * (ineffective learning).
 */
export function detectFlatLine(
  points: ScorePoint[],
  threshold: number,
  flatTolerance: number,
): FlatLineResult {
  if (points.length < 2) {
    return { detected: false, belowThreshold: false };
  }

  const scores = points.map((p) => p.score);
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const range = max - min;
  const isFlat = range < flatTolerance;

  if (!isFlat) {
    return { detected: false, belowThreshold: false };
  }

  const average = scores.reduce((sum, s) => sum + s, 0) / scores.length;
  return {
    detected: true,
    belowThreshold: average < threshold,
  };
}

// ---------------------------------------------------------------------------
// Top-Level Trend Classifier
// ---------------------------------------------------------------------------

/**
 * Analyzes a time-ordered score array (oldest first) and classifies
 * the behavioral trend. Priority order:
 *   1. insufficient_data (fewer than minStreakLength points)
 *   2. improving (positive slope, latest above threshold)
 *   3. drift (trailing below-threshold streak >= minStreakLength)
 *   4. flat (low variance, may be below threshold)
 *   5. stable (above threshold, not flat)
 */
export function analyzeTrend(
  points: ScorePoint[],
  options?: TrendOptions,
): TrendResult {
  const threshold = options?.threshold ?? DEFAULT_THRESHOLD;
  const minStreakLength = options?.minStreakLength ?? DEFAULT_MIN_STREAK_LENGTH;
  const flatTolerance = options?.flatTolerance ?? DEFAULT_FLAT_TOLERANCE;

  // 1. Insufficient data
  if (points.length < minStreakLength) {
    return {
      pattern: "insufficient_data",
      belowThreshold: false,
      streakLength: 0,
    };
  }

  // 2. Check for improvement (positive slope, crossed threshold from below)
  const improvement = detectImprovement(points, threshold);
  if (improvement.detected) {
    return {
      pattern: "improving",
      belowThreshold: false,
      streakLength: 0,
    };
  }

  // 3. Check for drift vs flat-line (both involve below-threshold scores)
  const drift = detectDriftStreak(points, threshold, minStreakLength);
  const flatLine = detectFlatLine(points, threshold, flatTolerance);

  // When the history is flat, below threshold, and has more data points
  // than the minimum streak, classify as "flat" (established stagnation /
  // ineffective learning). With exactly minStreakLength points, prefer
  // "drift" (newly detected decline needing intervention).
  if (
    flatLine.detected &&
    flatLine.belowThreshold &&
    points.length > minStreakLength
  ) {
    return {
      pattern: "flat",
      belowThreshold: true,
      streakLength: 0,
    };
  }

  if (drift.detected) {
    return {
      pattern: "drift",
      belowThreshold: true,
      streakLength: drift.streakLength,
    };
  }

  if (flatLine.detected && flatLine.belowThreshold) {
    return {
      pattern: "flat",
      belowThreshold: true,
      streakLength: 0,
    };
  }

  // 5. Default: stable (above threshold, no concerning pattern)
  const latestScore = points[points.length - 1].score;
  return {
    pattern: "stable",
    belowThreshold: latestScore < threshold,
    streakLength: 0,
  };
}

// ---------------------------------------------------------------------------
// Internal Helpers
// ---------------------------------------------------------------------------

/**
 * Computes simple linear slope over score values using least-squares.
 * Positive = improving, negative = declining, near-zero = flat.
 */
function computeSlope(scores: number[]): number {
  const n = scores.length;
  if (n < 2) return 0;

  // x values are 0, 1, 2, ... (index-based)
  const sumX = (n * (n - 1)) / 2;
  const sumY = scores.reduce((sum, s) => sum + s, 0);
  const sumXY = scores.reduce((sum, s, i) => sum + i * s, 0);
  const sumXX = (n * (n - 1) * (2 * n - 1)) / 6;

  return (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
}
