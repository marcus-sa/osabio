import type { ChatAgentTestCase, ChatAgentEvalOutput } from "../types";

/**
 * Ratio of expectedTools found in actual tool calls.
 * Returns 1 if no expectedTools specified.
 */
export function scoreCorrectToolSelection(output: ChatAgentEvalOutput, expected: ChatAgentTestCase): number {
  if (!expected.expectedTools || expected.expectedTools.length === 0) return 1;
  const calledTools = new Set(output.toolNames);
  const matches = expected.expectedTools.filter((t) => calledTools.has(t));
  return matches.length / expected.expectedTools.length;
}
