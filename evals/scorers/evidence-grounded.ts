import { createScorer } from "evalite";
import type { GoldenCase, ExtractionEvalOutput } from "../types";
import { normalizeForSubstring } from "./shared";

export const evidenceGroundedScorer = createScorer<GoldenCase, ExtractionEvalOutput, GoldenCase>({
  name: "evidence-grounded",
  description: "Percent of extraction edges with evidence grounded in the source input.",
  scorer: ({ input, output }) => {
    if (output.evidenceRows.length === 0) {
      return { score: output.extractedEntities.length === 0 ? 1 : 0 };
    }

    const normalizedInput = normalizeForSubstring(input.input);
    const grounded = output.evidenceRows.filter((row) => {
      const evidence = normalizeForSubstring(row.evidence ?? "");
      return evidence.length > 0 && normalizedInput.includes(evidence);
    }).length;

    return { score: grounded / output.evidenceRows.length };
  },
});
