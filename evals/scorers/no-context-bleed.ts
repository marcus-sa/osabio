import { createScorer } from "evalite";
import type { GoldenCase, ExtractionEvalOutput } from "../types";
import { normalizeForSubstring } from "./shared";

export const noContextBleedScorer = createScorer<GoldenCase, ExtractionEvalOutput, GoldenCase>({
  name: "no-context-bleed",
  description: "Score 1 when extraction output does not include assistant-context-only phrases for context-seeded cases.",
  scorer: ({ output, expected }) => {
    const forbiddenPhrases = expected.forbiddenContextOnlyPhrases ?? [];
    if (forbiddenPhrases.length === 0) {
      return { score: 1 };
    }

    const normalizedExtracted = output.extractedEntities.map((entity) => normalizeForSubstring(entity.text));
    const matchedForbidden = forbiddenPhrases
      .map((phrase) => normalizeForSubstring(phrase))
      .filter((phrase) => {
        if (phrase.length === 0) {
          return false;
        }

        return normalizedExtracted.some((entityText) => entityText.includes(phrase) || phrase.includes(entityText));
      });

    return {
      score: matchedForbidden.length === 0 ? 1 : 0,
      metadata: matchedForbidden.length === 0 ? undefined : { matchedForbidden },
    };
  },
});
