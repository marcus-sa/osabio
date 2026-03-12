/**
 * Scorer: Is the confidence score well-calibrated for the scenario?
 *
 * - Clear cases (contradiction/match) should have high confidence (>= 0.6)
 * - Ambiguous cases should have lower confidence (< 0.7)
 * - Confidence must always be in [0, 1]
 */
import type { ObserverLlmEvalOutput, ObserverLlmTestCase } from "../types";

export function confidenceCalibrationScorer({
  output,
  expected,
}: {
  output: ObserverLlmEvalOutput;
  expected?: ObserverLlmTestCase;
}): number | { score: number; metadata: Record<string, unknown> } {
  if (!output.success || output.confidence === undefined) return 0;

  // Out of range is always wrong
  if (output.confidence < 0 || output.confidence > 1) {
    return { score: 0, metadata: { confidence: output.confidence, note: "Out of range [0,1]" } };
  }

  if (!expected?.expectedConfidenceRange) return 1;

  const [min, max] = expected.expectedConfidenceRange;

  if (output.confidence >= min && output.confidence <= max) return 1;

  // Partial credit for being close
  const distance = output.confidence < min
    ? min - output.confidence
    : output.confidence - max;

  const score = Math.max(0, 1 - distance * 2);
  return {
    score,
    metadata: {
      confidence: output.confidence,
      expectedRange: `[${min}, ${max}]`,
      distance: distance.toFixed(2),
    },
  };
}
