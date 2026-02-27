import { createScorer } from "evalite";
import type { GoldenCase, ExtractionEvalOutput } from "../types";

export const forbiddenKindsScorer = createScorer<GoldenCase, ExtractionEvalOutput, GoldenCase>({
  name: "forbidden-kinds",
  description: "Score 1 when extracted entities do not include forbidden kinds for the case.",
  scorer: ({ output, expected }) => {
    const forbiddenKinds = expected.forbiddenExtractedKinds ?? [];
    if (forbiddenKinds.length === 0) {
      return { score: 1 };
    }

    const foundForbiddenKinds = output.extractedEntities
      .map((entity) => entity.kind)
      .filter((kind) => forbiddenKinds.includes(kind as (typeof forbiddenKinds)[number]));

    return {
      score: foundForbiddenKinds.length === 0 ? 1 : 0,
      metadata: foundForbiddenKinds.length === 0 ? undefined : { foundForbiddenKinds },
    };
  },
});
