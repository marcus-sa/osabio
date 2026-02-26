import { createScorer } from "evalite";
import type { GoldenCase, ExtractionEvalOutput } from "../types";
import { isEntityNameMatch } from "./shared";

export const entityRecallScorer = createScorer<GoldenCase, ExtractionEvalOutput, GoldenCase>({
  name: "entity-recall",
  description: "Percent of expected entities present in extraction output (lexical match >= 0.5).",
  scorer: ({ output, expected }) => {
    const expectedEntities = expected?.expectedEntities ?? [];
    if (expectedEntities.length === 0) {
      return { score: 1 };
    }

    let matched = 0;
    for (const expectedEntity of expectedEntities) {
      const found = output.extractedEntities.some(
        (entity) => entity.kind === expectedEntity.kind && isEntityNameMatch(expectedEntity.text, entity.text, 0.5),
      );
      if (found) {
        matched += 1;
      }
    }

    return { score: matched / expectedEntities.length };
  },
});
