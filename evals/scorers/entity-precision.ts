import { createScorer } from "evalite";
import type { GoldenCase, ExtractionEvalOutput } from "../types";
import { matchesExpectedEntity } from "./shared";

export const entityPrecisionScorer = createScorer<GoldenCase, ExtractionEvalOutput, GoldenCase>({
  name: "entity-precision",
  description: "Percent of extracted entities that match expected entities by kind and text/text_contains expectation.",
  scorer: ({ output, expected }) => {
    const expectedEntities = expected?.expectedEntities ?? [];
    if (output.extractedEntities.length === 0) {
      return { score: expectedEntities.length === 0 ? 1 : 0 };
    }

    let matched = 0;
    for (const entity of output.extractedEntities) {
      const found = expectedEntities.some(
        (candidate: GoldenCase["expectedEntities"][number]) => matchesExpectedEntity(candidate, entity, 0.5),
      );
      if (found) {
        matched += 1;
      }
    }

    return { score: matched / output.extractedEntities.length };
  },
});
