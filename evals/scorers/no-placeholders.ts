import { createScorer } from "evalite";
import type { GoldenCase, ExtractionEvalOutput } from "../types";
import { isPlaceholderEntityName } from "../../app/src/server/extraction/filtering";

export const noPlaceholdersScorer = createScorer<GoldenCase, ExtractionEvalOutput, GoldenCase>({
  name: "no-placeholders",
  description: "Score 1 when no extracted entity names are placeholders.",
  scorer: ({ output }) => {
    const hasPlaceholder = output.extractedEntities.some((entity) => isPlaceholderEntityName(entity.text));
    return { score: hasPlaceholder ? 0 : 1 };
  },
});
