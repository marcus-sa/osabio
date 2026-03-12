/**
 * Scorer: Does the reasoning text reference the relevant entities?
 *
 * A good LLM verdict should reference both the task and the decision
 * in its reasoning, not produce generic text. We check that expected
 * anchors (substrings from the decision/task text) appear in the reasoning.
 */
import type { ObserverLlmEvalOutput, ObserverLlmTestCase } from "../types";

export function reasoningQualityScorer({
  output,
  expected,
}: {
  output: ObserverLlmEvalOutput;
  expected?: ObserverLlmTestCase;
}): number | { score: number; metadata: Record<string, unknown> } {
  if (!output.success || !output.reasoning) return 0;

  // Reasoning must be substantive (not just a sentence fragment)
  if (output.reasoning.length < 30) {
    return { score: 0.1, metadata: { note: "Reasoning too short", length: output.reasoning.length } };
  }

  if (!expected?.expectedReasoningAnchors || expected.expectedReasoningAnchors.length === 0) {
    // No anchors to check — pass if reasoning is non-trivial
    return output.reasoning.length >= 50 ? 1 : 0.5;
  }

  const lowerReasoning = output.reasoning.toLowerCase();
  const matched = expected.expectedReasoningAnchors.filter(
    (anchor) => lowerReasoning.includes(anchor.toLowerCase()),
  );

  const score = matched.length / expected.expectedReasoningAnchors.length;
  return {
    score,
    metadata: {
      matched: matched.length,
      total: expected.expectedReasoningAnchors.length,
      missing: expected.expectedReasoningAnchors.filter(
        (a) => !lowerReasoning.includes(a.toLowerCase()),
      ),
    },
  };
}
