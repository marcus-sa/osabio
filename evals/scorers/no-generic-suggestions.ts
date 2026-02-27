import { createScorer } from "evalite";
import type { SuggestionGoldenCase, SuggestionsEvalOutput } from "../types";

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const noGenericSuggestionsScorer = createScorer<SuggestionGoldenCase, SuggestionsEvalOutput, SuggestionGoldenCase>({
  name: "no-generic-suggestions",
  description: "Score 1 when case-specific forbidden suggestions are absent.",
  scorer: ({ output, expected }) => {
    const forbidden = (expected.forbiddenSuggestions ?? []).map((value) => normalize(value));
    if (forbidden.length === 0) {
      return { score: 1 };
    }

    const matchedForbidden = output.suggestions.filter((suggestion) => {
      const normalizedSuggestion = normalize(suggestion);
      return forbidden.some((template) =>
        normalizedSuggestion === template || normalizedSuggestion.startsWith(`${template} `)
      );
    });

    return {
      score: matchedForbidden.length === 0 ? 1 : 0,
      metadata: matchedForbidden.length === 0 ? undefined : { matchedForbidden },
    };
  },
});
