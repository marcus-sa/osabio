import { createScorer } from "evalite";
import type { GoldenCase, ExtractionEvalOutput } from "../types";
import { matchesExpectedEntity } from "./shared";

export const entityRecallScorer = createScorer<GoldenCase, ExtractionEvalOutput, GoldenCase>({
  name: "entity-recall",
  description: "Percent of expected entities present in extraction output by kind and text/text_contains expectation.",
  scorer: ({ output, expected }) => {
    const expectedEntities = expected?.expectedEntities ?? [];
    if (expectedEntities.length === 0) {
      return { score: 1 };
    }

    let matched = 0;
    for (const expectedEntity of expectedEntities) {
      const found = output.extractedEntities.some((entity) => matchesExpectedEntity(expectedEntity, entity, 0.5));
      if (found) {
        matched += 1;
      }
    }

    return { score: matched / expectedEntities.length };
  },
});
