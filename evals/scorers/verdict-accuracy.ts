/**
 * Scorer: Does the LLM verdict match the expected verdict for the scenario?
 *
 * Used by the observer-llm-reasoning eval to measure whether the LLM
 * correctly identifies contradictions, matches, and ambiguous cases.
 */
import type { ObserverLlmEvalOutput, ObserverLlmTestCase } from "../types";

export function verdictAccuracyScorer({
  output,
  expected,
}: {
  output: ObserverLlmEvalOutput;
  expected?: ObserverLlmTestCase;
}): number | { score: number; metadata: Record<string, unknown> } {
  if (!expected?.expectedVerdict || !output.success) return 0;

  if (output.verdict === expected.expectedVerdict) return 1;

  // Partial credit: "inconclusive" when we expected a specific verdict
  // is better than the wrong specific verdict
  if (output.verdict === "inconclusive") {
    return {
      score: 0.3,
      metadata: {
        expected: expected.expectedVerdict,
        actual: output.verdict,
        note: "Inconclusive is cautious but missed the signal",
      },
    };
  }

  // Wrong specific verdict (e.g., match when mismatch expected) is the worst
  return {
    score: 0,
    metadata: {
      expected: expected.expectedVerdict,
      actual: output.verdict,
      note: "Wrong verdict direction",
    },
  };
}
