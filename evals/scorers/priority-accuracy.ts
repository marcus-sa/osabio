import { createScorer } from "evalite";
import type { GoldenCase, ExtractionEvalOutput } from "../types";
import { matchesExpectedEntity } from "./shared";

export const priorityAccuracyScorer = createScorer<GoldenCase, ExtractionEvalOutput, GoldenCase>({
  name: "priority-accuracy",
  description: "Percent of expected entities with expectedPriority whose matched extraction has the correct priority.",
  scorer: ({ output, expected }) => {
    const expectedEntities = expected?.expectedEntities ?? [];
    const withPriority = expectedEntities.filter((e) => e.expectedPriority);
    if (withPriority.length === 0) {
      return { score: 1 };
    }

    let matched = 0;
    for (const expectedEntity of withPriority) {
      const found = output.extractedEntities.find((entity) =>
        matchesExpectedEntity(expectedEntity, entity, 0.5),
      );
      if (found && found.priority === expectedEntity.expectedPriority) {
        matched += 1;
      }
    }

    return { score: matched / withPriority.length };
  },
});
