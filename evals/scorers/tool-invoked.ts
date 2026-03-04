import type { ChatAgentTestCase, ChatAgentEvalOutput } from "../types";

/**
 * Binary scorer: agent used tools when `expectsToolUse=true`, abstained when false.
 */
export function scoreToolInvoked(output: ChatAgentEvalOutput, expected: ChatAgentTestCase): number {
  const usedTools = output.toolNames.length > 0;
  if (expected.expectsToolUse) {
    return usedTools ? 1 : 0;
  }
  return usedTools ? 0 : 1;
}
