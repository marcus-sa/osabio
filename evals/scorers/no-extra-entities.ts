import { createScorer } from "evalite";
import type { GoldenCase, ExtractionEvalOutput } from "../types";
import { isEntityNameMatch } from "./shared";

export const noExtraEntitiesScorer = createScorer<GoldenCase, ExtractionEvalOutput, GoldenCase>({
  name: "no-extra-entities",
  description: "Strict scorer for strict_single cases: requires exact expected set with no extra entities.",
  scorer: ({ output, expected }) => {
    if (expected.intent !== "strict_single") {
      return { score: 1 };
    }

    const expectedEntities = expected.expectedEntities;
    const extractedEntities = output.extractedEntities;
    if (expectedEntities.length !== extractedEntities.length) {
      return { score: 0 };
    }

    const unmatchedExpected = [...expectedEntities];
    for (const entity of extractedEntities) {
      const matchedIndex = unmatchedExpected.findIndex(
        (candidate) => candidate.kind === entity.kind && isEntityNameMatch(candidate.text, entity.text, 0.5),
      );

      if (matchedIndex === -1) {
        return { score: 0 };
      }

      unmatchedExpected.splice(matchedIndex, 1);
    }

    return { score: unmatchedExpected.length === 0 ? 1 : 0 };
  },
});
