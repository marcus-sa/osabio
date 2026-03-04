import type { ChatAgentTestCase, ChatAgentEvalOutput } from "../types";

const HEDGING_PATTERNS = [
  "would you like me to",
  "would you like to",
  "shall i",
  "do you want me to",
  "let me know if you'd like",
  "should i go ahead",
  "i can help you with that. would you",
  "here are your options",
  "which would you prefer",
];

/**
 * When expectsToolUse=true, the response must not contain hedging/clarification patterns.
 * Also checks case-specific forbiddenResponsePatterns.
 */
export function scoreNoClarificationWhenClear(output: ChatAgentEvalOutput, expected: ChatAgentTestCase): number {
  if (!expected.expectsToolUse) return 1;
  const patterns = [...HEDGING_PATTERNS, ...(expected.forbiddenResponsePatterns ?? [])];
  const lowerResponse = output.responseText.toLowerCase();
  const violations = patterns.filter((p) => lowerResponse.includes(p.toLowerCase()));
  return violations.length === 0 ? 1 : 0;
}
