import { createScorer } from "evalite";
import type { GoldenCase, ExtractionEvalOutput } from "../types";
import { matchesExpectedEntity } from "./shared";

export const categoryAccuracyScorer = createScorer<GoldenCase, ExtractionEvalOutput, GoldenCase>({
  name: "category-accuracy",
  description: "Percent of expected entities with expectedCategory whose matched extraction has the correct category.",
  scorer: ({ output, expected }) => {
    const expectedEntities = expected?.expectedEntities ?? [];
    const withCategory = expectedEntities.filter((e) => e.expectedCategory);
    if (withCategory.length === 0) {
      return { score: 1 };
    }

    let matched = 0;
    for (const expectedEntity of withCategory) {
      const found = output.extractedEntities.find((entity) =>
        matchesExpectedEntity(expectedEntity, entity, 0.5),
      );
      if (found && found.category === expectedEntity.expectedCategory) {
        matched += 1;
      }
    }

    return { score: matched / withCategory.length };
  },
});
