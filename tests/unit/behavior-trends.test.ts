/**
 * Behavior Trends Unit Tests
 *
 * Pure function tests for trend analysis. No IO, no database,
 * just score arrays in -> trend classification out.
 *
 * trends.ts must have zero IO imports.
 */
import { describe, expect, it } from "bun:test";
import {
  analyzeTrend,
  detectDriftStreak,
  detectImprovement,
  detectFlatLine,
  type ScorePoint,
  type TrendResult,
  type TrendOptions,
} from "../../app/src/server/behavior/trends";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create ScorePoint array from scores (oldest first). */
function makePoints(...scores: number[]): ScorePoint[] {
  const baseTime = new Date("2026-01-01T00:00:00Z").getTime();
  return scores.map((score, i) => ({
    score,
    timestamp: new Date(baseTime + i * 3600_000).toISOString(),
  }));
}

// =============================================================================
// detectDriftStreak — consecutive below-threshold detection
// =============================================================================
describe("detectDriftStreak", () => {
  it("detects 3 consecutive below-threshold scores as drift", () => {
    const points = makePoints(0.62, 0.65, 0.60);
    const result = detectDriftStreak(points, 0.80, 3);
    expect(result.detected).toBe(true);
    expect(result.streakLength).toBe(3);
  });

  it("detects 5 consecutive below-threshold scores as drift", () => {
    const points = makePoints(0.40, 0.45, 0.42, 0.38, 0.44);
    const result = detectDriftStreak(points, 0.70, 3);
    expect(result.detected).toBe(true);
    expect(result.streakLength).toBe(5);
  });

  it("does not detect drift when streak is broken by above-threshold score", () => {
    const points = makePoints(0.60, 0.65, 0.85, 0.60, 0.65);
    const result = detectDriftStreak(points, 0.80, 3);
    // The trailing streak of 2 is below minStreakLength of 3
    expect(result.detected).toBe(false);
  });

  it("does not detect drift with fewer than minStreakLength points", () => {
    const points = makePoints(0.60, 0.65);
    const result = detectDriftStreak(points, 0.80, 3);
    expect(result.detected).toBe(false);
  });

  it("does not detect drift when all scores are above threshold", () => {
    const points = makePoints(0.85, 0.90, 0.82, 0.88);
    const result = detectDriftStreak(points, 0.80, 3);
    expect(result.detected).toBe(false);
  });

  it("uses trailing streak length from end of array", () => {
    // First 2 above, last 3 below -- trailing streak is 3
    const points = makePoints(0.85, 0.90, 0.60, 0.65, 0.62);
    const result = detectDriftStreak(points, 0.80, 3);
    expect(result.detected).toBe(true);
    expect(result.streakLength).toBe(3);
  });

  it("returns streakLength 0 for empty input", () => {
    const result = detectDriftStreak([], 0.80, 3);
    expect(result.detected).toBe(false);
    expect(result.streakLength).toBe(0);
  });
});

// =============================================================================
// detectImprovement — rising trend detection
// =============================================================================
describe("detectImprovement", () => {
  it("detects strictly improving scores", () => {
    const points = makePoints(0.70, 0.75, 0.82, 0.85, 0.88);
    const result = detectImprovement(points, 0.80);
    expect(result.detected).toBe(true);
  });

  it("detects improvement when latest crosses above threshold", () => {
    const points = makePoints(0.60, 0.65, 0.72, 0.81);
    const result = detectImprovement(points, 0.80);
    expect(result.detected).toBe(true);
  });

  it("does not detect improvement when scores are declining", () => {
    const points = makePoints(0.90, 0.85, 0.80, 0.75);
    const result = detectImprovement(points, 0.80);
    expect(result.detected).toBe(false);
  });

  it("does not detect improvement for flat scores", () => {
    const points = makePoints(0.45, 0.44, 0.46, 0.45);
    const result = detectImprovement(points, 0.80);
    expect(result.detected).toBe(false);
  });

  it("returns false for empty input", () => {
    const result = detectImprovement([], 0.80);
    expect(result.detected).toBe(false);
  });
});

// =============================================================================
// detectFlatLine — stagnation detection
// =============================================================================
describe("detectFlatLine", () => {
  it("detects flat scores below threshold", () => {
    const points = makePoints(0.44, 0.45, 0.43, 0.46, 0.45);
    const result = detectFlatLine(points, 0.70, 0.10);
    expect(result.detected).toBe(true);
    expect(result.belowThreshold).toBe(true);
  });

  it("detects flat scores above threshold", () => {
    const points = makePoints(0.85, 0.86, 0.84, 0.85);
    const result = detectFlatLine(points, 0.80, 0.10);
    expect(result.detected).toBe(true);
    expect(result.belowThreshold).toBe(false);
  });

  it("does not detect flat line when variance exceeds tolerance", () => {
    const points = makePoints(0.40, 0.70, 0.45, 0.80);
    const result = detectFlatLine(points, 0.70, 0.10);
    expect(result.detected).toBe(false);
  });

  it("returns false for empty input", () => {
    const result = detectFlatLine([], 0.70, 0.10);
    expect(result.detected).toBe(false);
  });

  it("returns false for single point", () => {
    const result = detectFlatLine(makePoints(0.50), 0.70, 0.10);
    expect(result.detected).toBe(false);
  });
});

// =============================================================================
// analyzeTrend — top-level classifier
// =============================================================================
describe("analyzeTrend", () => {
  it("classifies 3+ consecutive below-threshold as drift (US-OB-07 #1)", () => {
    const points = makePoints(0.62, 0.65, 0.60);
    const trend = analyzeTrend(points, { threshold: 0.80, minStreakLength: 3 });
    expect(trend.pattern).toBe("drift");
    expect(trend.streakLength).toBeGreaterThanOrEqual(3);
    expect(trend.belowThreshold).toBe(true);
  });

  it("classifies improving scores as improving (US-OB-07 #2)", () => {
    const points = makePoints(0.70, 0.75, 0.82, 0.85, 0.88);
    const trend = analyzeTrend(points, { threshold: 0.80 });
    expect(trend.pattern).toBe("improving");
    expect(trend.belowThreshold).toBe(false);
  });

  it("classifies flat below-threshold scores as flat (US-OB-07 #4)", () => {
    const points = makePoints(0.44, 0.45, 0.43, 0.46, 0.45);
    const trend = analyzeTrend(points, { threshold: 0.70 });
    expect(trend.pattern).toBe("flat");
    expect(trend.belowThreshold).toBe(true);
  });

  it("classifies insufficient data when fewer than minStreakLength points (US-OB-07 #6)", () => {
    const points = makePoints(0.35);
    const trend = analyzeTrend(points, { threshold: 0.70, minStreakLength: 3 });
    expect(trend.pattern).toBe("insufficient_data");
    expect(trend.belowThreshold).toBe(false);
  });

  it("classifies 2 points as insufficient_data with default minStreakLength of 3", () => {
    const points = makePoints(0.50, 0.55);
    const trend = analyzeTrend(points, { threshold: 0.70 });
    expect(trend.pattern).toBe("insufficient_data");
  });

  it("classifies stable above-threshold scores as stable", () => {
    const points = makePoints(0.85, 0.90, 0.88, 0.87);
    const trend = analyzeTrend(points, { threshold: 0.80 });
    expect(trend.pattern).toBe("stable");
    expect(trend.belowThreshold).toBe(false);
  });

  it("uses default threshold of 0.70 and minStreakLength of 3", () => {
    const points = makePoints(0.50, 0.55, 0.52);
    const trend = analyzeTrend(points);
    expect(trend.pattern).toBe("drift");
    expect(trend.streakLength).toBe(3);
  });

  it("empty input returns insufficient_data", () => {
    const trend = analyzeTrend([]);
    expect(trend.pattern).toBe("insufficient_data");
  });
});
