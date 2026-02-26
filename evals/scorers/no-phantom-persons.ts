import { createScorer } from "evalite";
import type { GoldenCase, ExtractionEvalOutput } from "../types";

export const noPhantomPersonsScorer = createScorer<GoldenCase, ExtractionEvalOutput, GoldenCase>({
  name: "no-phantom-persons",
  description: "Score 1 when extraction does not create new person nodes.",
  scorer: ({ output }) => ({
    score: output.personCount === output.ownerPersonCount ? 1 : 0,
    metadata: {
      personCount: output.personCount,
      ownerPersonCount: output.ownerPersonCount,
    },
  }),
});
