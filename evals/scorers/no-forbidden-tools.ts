import type { ChatAgentTestCase, ChatAgentEvalOutput } from "../types";

/**
 * Checks that none of the forbiddenTools were called.
 * Returns 1 if no forbiddenTools specified.
 */
export function scoreNoForbiddenTools(output: ChatAgentEvalOutput, expected: ChatAgentTestCase): number {
  if (!expected.forbiddenTools || expected.forbiddenTools.length === 0) return 1;
  const calledTools = new Set(output.toolNames);
  const violations = expected.forbiddenTools.filter((t) => calledTools.has(t));
  return violations.length === 0 ? 1 : 0;
}
