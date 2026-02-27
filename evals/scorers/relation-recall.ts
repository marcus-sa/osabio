import { createScorer } from "evalite";
import type { GoldenCase, ExtractionEvalOutput } from "../types";
import { normalizeForSubstring } from "./shared";

export const relationRecallScorer = createScorer<GoldenCase, ExtractionEvalOutput, GoldenCase>({
  name: "relation-recall",
  description: "Percent of expected relations present in extraction output by from_kind, to_kind, and to_text_contains.",
  scorer: ({ output, expected }) => {
    const expectedRelations = expected?.expectedRelations ?? [];
    if (expectedRelations.length === 0) {
      return { score: 1 };
    }

    let matched = 0;
    for (const expectedRelation of expectedRelations) {
      const found = output.extractedRelations.some((relation) => {
        if (relation.fromKind !== expectedRelation.from_kind) return false;
        if (relation.toKind !== expectedRelation.to_kind) return false;
        const normalizedToText = normalizeForSubstring(relation.toText);
        const expectedSubstring = normalizeForSubstring(expectedRelation.to_text_contains);
        return normalizedToText.includes(expectedSubstring);
      });
      if (found) {
        matched += 1;
      }
    }

    return { score: matched / expectedRelations.length };
  },
});
