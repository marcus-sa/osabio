import { createScorer } from "evalite";
import type { GoldenCase, ExtractionEvalOutput } from "../types";

function normalizeTool(value: string): string {
  return value.trim().toLowerCase();
}

export const toolFilteringScorer = createScorer<GoldenCase, ExtractionEvalOutput, GoldenCase>({
  name: "tool-filtering",
  description: "Score 1 when expected tools are present and forbidden tools are absent.",
  scorer: ({ output, expected }) => {
    const expectedTools = expected.expectedTools ?? [];
    const forbiddenTools = expected.forbiddenTools ?? [];
    const extractedTools = new Set(output.extractedTools.map((tool) => normalizeTool(tool)));

    const missingExpected = expectedTools.filter((tool) => !extractedTools.has(normalizeTool(tool)));
    const presentForbidden = forbiddenTools.filter((tool) => extractedTools.has(normalizeTool(tool)));

    return {
      score: missingExpected.length === 0 && presentForbidden.length === 0 ? 1 : 0,
      metadata:
        missingExpected.length === 0 && presentForbidden.length === 0
          ? undefined
          : {
              missingExpected,
              presentForbidden,
              extractedTools: [...extractedTools],
            },
    };
  },
});
