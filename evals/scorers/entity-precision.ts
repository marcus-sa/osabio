import { createScorer } from "evalite";
import type { GoldenCase, ExtractionEvalOutput } from "../types";
import { nameSimilarity } from "./shared";

export const entityPrecisionScorer = createScorer<GoldenCase, ExtractionEvalOutput, GoldenCase>({
  name: "entity-precision",
  description: "Percent of extracted entities that match expected entities (same kind + name similarity > 0.8).",
  scorer: ({ output, expected }) => {
    const expectedEntities = expected?.expectedEntities ?? [];
    if (output.extractedEntities.length === 0) {
      return { score: expectedEntities.length === 0 ? 1 : 0 };
    }

    let matched = 0;
    for (const entity of output.extractedEntities) {
      const found = expectedEntities.some(
        (candidate: GoldenCase["expectedEntities"][number]) =>
          candidate.kind === entity.kind && nameSimilarity(candidate.text, entity.text) > 0.8,
      );
      if (found) {
        matched += 1;
      }
    }

    return { score: matched / output.extractedEntities.length };
  },
});
